import { lstat, readdir, rm, rmdir, statfs, unlink } from "node:fs/promises";
import type { Stats } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { env } from "../../config/env.js";
import { docker } from "../../services/docker.client.js";
import { runCommand } from "../../utils/exec.js";
import { BackupHistoryModel } from "../../db/models/backup.js";
import type {
  CleanupCategory,
  CleanupCategoryId,
  CleanupFolderSize,
  CleanupItem,
  CleanupRunResponse,
  CleanupRunResult,
  CleanupScan,
} from "@pwa-admin/shared";

/**
 * Server cleanup. Two strict phases: scan() only reads; run() removes only the
 * categories the admin picked, and re-derives every candidate itself — it never
 * trusts a list of paths coming from the client. Deliberately NOT included:
 * installed packages, old kernels, Docker volumes, stopped containers, rotated
 * system logs — each of those can break a running server or lose data, so they
 * stay a manual decision.
 */

const APT_CACHE_DIR = "/var/cache/apt/archives";
const VAR_TMP = "/var/tmp";
const JOURNAL_KEEP = "14d"; // must match the sudoers rule for `journalctl --vacuum-time=14d`
const TMP_MAX_AGE_MS = 7 * 86_400_000;
const APP_TEMP_MAX_AGE_MS = 2 * 3_600_000;
// Staging folders the app creates under the local backup root; everything in them is
// disposable once old enough (a backup in progress keeps touching its files).
const APP_TEMP_DIRS = ["_tmp-enc", "_tmp-usb-upload", "_tmp-drive-upload"];
const MAX_WALK_ENTRIES = 50_000;
const SAMPLE = 8;
const OLD_BACKUP_SAMPLE = 50;
const LC = { LC_ALL: "C" };

let running = false;

const exists = (path: string) => lstat(path).then(() => true, () => false);

function parseDu(out: string): number | null {
  const n = Number(out.trim().split(/\s+/)[0]);
  return Number.isFinite(n) ? n : null;
}

/** `du` exits non-zero on subfolders it can't read but still prints the total it could. */
async function duBytes(path: string): Promise<number | null> {
  try {
    const { stdout } = await runCommand("du", ["-sb", path], { timeoutMs: 120_000, env: LC });
    return parseDu(stdout);
  } catch (err) {
    return parseDu((err as { stdout?: string }).stdout ?? "");
  }
}

/** "1.2G" / "512M" / "3.4GB" → bytes. `base` is 1024 for journalctl/apt, 1000 for docker. */
function parseSize(value: string, unit: string, base: 1000 | 1024): number {
  const power = { "": 0, K: 1, M: 2, G: 3, T: 4 }[unit.toUpperCase().replace(/I?B$/, "")] ?? 0;
  return Math.round(Number(value) * base ** power);
}

async function* walkFiles(dir: string, budget: { left: number }): AsyncGenerator<{ path: string; st: Stats }> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (budget.left-- <= 0) return;
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      yield* walkFiles(path, budget);
      continue;
    }
    if (!entry.isFile()) continue;
    try {
      yield { path, st: await lstat(path) };
    } catch {
      // vanished between readdir and lstat
    }
  }
}

function category(
  id: CleanupCategoryId,
  risk: "safe" | "review",
  partial: Partial<CleanupCategory> = {}
): CleanupCategory {
  return {
    id,
    risk,
    available: true,
    sizeBytes: null,
    sizeIsUpperBound: false,
    itemCount: null,
    items: [],
    scanError: null,
    ...partial,
  };
}

const largestFirst = (a: CleanupItem, b: CleanupItem) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0);

// ---- scanners -------------------------------------------------------------------

async function scanAptCache(): Promise<CleanupCategory> {
  if (!(await exists(APT_CACHE_DIR))) return category("apt-cache", "safe", { available: false });
  const items: CleanupItem[] = [];
  let count = 0;
  for await (const { path, st } of walkFiles(APT_CACHE_DIR, { left: MAX_WALK_ENTRIES })) {
    if (!path.endsWith(".deb")) continue;
    count++;
    items.push({ label: path.slice(APT_CACHE_DIR.length + 1), sizeBytes: st.size });
  }
  return category("apt-cache", "safe", {
    sizeBytes: await duBytes(APT_CACHE_DIR),
    itemCount: count,
    items: items.sort(largestFirst).slice(0, SAMPLE),
  });
}

async function scanJournal(): Promise<CleanupCategory> {
  try {
    const { stdout } = await runCommand("sudo", ["/usr/bin/journalctl", "--disk-usage"], { env: LC, timeoutMs: 15_000 });
    const m = stdout.match(/take up ([\d.]+)([KMGT]?)/i);
    return category("journal", "review", {
      sizeBytes: m ? parseSize(m[1], m[2], 1024) : null,
      // Only what is older than JOURNAL_KEEP goes: the real gain is lower.
      sizeIsUpperBound: true,
    });
  } catch {
    return category("journal", "review", { scanError: "journal_unreadable" });
  }
}

async function scanDocker(): Promise<CleanupCategory[]> {
  let df: any;
  try {
    df = await docker.df();
  } catch {
    return [
      category("docker-dangling-images", "safe", { available: false }),
      category("docker-build-cache", "safe", { available: false }),
    ];
  }

  const dangling = ((df?.Images ?? []) as any[]).filter(
    (i) =>
      (!i.RepoTags || i.RepoTags.length === 0 || i.RepoTags.every((t: string) => t === "<none>:<none>")) &&
      (i.Containers ?? 0) <= 0
  );
  const images = category("docker-dangling-images", "safe", {
    sizeBytes: dangling.reduce((sum, i) => sum + (i.Size ?? 0), 0),
    sizeIsUpperBound: true, // layers shared with other images are not freed
    itemCount: dangling.length,
    items: dangling
      .map((i): CleanupItem => ({ label: String(i.Id ?? "").replace("sha256:", "").slice(0, 12), sizeBytes: i.Size ?? null }))
      .sort(largestFirst)
      .slice(0, SAMPLE),
  });

  const unusedCache = ((df?.BuildCache ?? []) as any[]).filter((b) => !b.InUse);
  const cache = category("docker-build-cache", "safe", {
    sizeBytes: unusedCache.reduce((sum, b) => sum + (b.Size ?? 0), 0),
    sizeIsUpperBound: true,
    itemCount: unusedCache.length,
  });

  return [images, cache];
}

async function scanNpmCache(): Promise<CleanupCategory> {
  const dir = join(homedir(), ".npm", "_cacache");
  if (!(await exists(dir))) return category("npm-cache", "safe", { available: false });
  return category("npm-cache", "safe", { sizeBytes: await duBytes(dir) });
}

async function collectAppTemp(): Promise<{ path: string; size: number }[]> {
  const cutoff = Date.now() - APP_TEMP_MAX_AGE_MS;
  const found: { path: string; size: number }[] = [];
  for (const name of APP_TEMP_DIRS) {
    for await (const { path, st } of walkFiles(join(env.BACKUP_LOCAL_ROOT, name), { left: MAX_WALK_ENTRIES })) {
      if (st.mtimeMs < cutoff) found.push({ path, size: st.size });
    }
  }
  return found;
}

async function scanAppTemp(): Promise<CleanupCategory> {
  const files = await collectAppTemp();
  return category("app-temp", "safe", {
    sizeBytes: files.reduce((s, f) => s + f.size, 0),
    itemCount: files.length,
    items: files
      .map((f): CleanupItem => ({ label: f.path.slice(resolve(env.BACKUP_LOCAL_ROOT).length + 1), sizeBytes: f.size }))
      .sort(largestFirst)
      .slice(0, SAMPLE),
  });
}

async function collectOwnTmp(): Promise<{ path: string; size: number }[]> {
  const uid = process.getuid?.();
  if (uid === undefined) return [];
  const cutoff = Date.now() - TMP_MAX_AGE_MS;
  const found: { path: string; size: number }[] = [];
  const budget = { left: MAX_WALK_ENTRIES };
  for (const dir of new Set([tmpdir(), VAR_TMP])) {
    for await (const { path, st } of walkFiles(dir, budget)) {
      // Only the service account's own files, and only ones neither written nor read for a week.
      if (st.uid === uid && Math.max(st.mtimeMs, st.atimeMs) < cutoff) found.push({ path, size: st.size });
    }
  }
  return found;
}

async function scanOwnTmp(): Promise<CleanupCategory> {
  if (process.getuid?.() === undefined) return category("tmp-owned", "safe", { available: false });
  const files = await collectOwnTmp();
  return category("tmp-owned", "safe", {
    sizeBytes: files.reduce((s, f) => s + f.size, 0),
    itemCount: files.length,
    items: files
      .map((f): CleanupItem => ({ label: f.path, sizeBytes: f.size }))
      .sort(largestFirst)
      .slice(0, SAMPLE),
  });
}

interface OldBackup {
  runId: string;
  label: string;
  startedAt: string;
  path: string;
  size: number;
  hasExternalCopy: boolean;
}

/** Local backups older than `days`, always keeping the newest `minCopies` successful
 * runs of each source. Only files that still exist under the local backup root. */
async function collectOldBackups(days: number): Promise<OldBackup[]> {
  const root = resolve(env.BACKUP_LOCAL_ROOT);
  const cutoff = Date.now() - days * 86_400_000;
  const keep = env.BACKUP_RETENTION_MIN_COPIES;

  const bySource = new Map<string, ReturnType<typeof BackupHistoryModel.listSuccessfulBackups>>();
  for (const row of BackupHistoryModel.listSuccessfulBackups()) {
    const key = `${row.source_type}|${row.source_ref}`;
    bySource.set(key, [...(bySource.get(key) ?? []), row]);
  }

  const result: OldBackup[] = [];
  for (const rows of bySource.values()) {
    // listSuccessfulBackups is newest first; the first `keep` are protected.
    for (const row of rows.slice(keep)) {
      if (Date.parse(row.started_at.replace(" ", "T") + "Z") >= cutoff) continue;
      const abs = resolve(row.file_path!);
      if (!abs.startsWith(root + sep)) continue; // e.g. an archive read straight from a USB drive
      let st: Stats;
      try {
        st = await lstat(abs);
      } catch {
        continue; // already gone (retention)
      }
      if (!st.isFile()) continue;
      result.push({
        runId: row.run_id,
        label: `${row.source_type}:${row.source_ref}`,
        startedAt: row.started_at,
        path: abs,
        size: st.size,
        hasExternalCopy: Boolean(row.usb_path || row.drive_file_id),
      });
    }
  }
  return result;
}

async function scanOldBackups(days: number): Promise<CleanupCategory> {
  const old = await collectOldBackups(days);
  return category("old-backups", "review", {
    sizeBytes: old.reduce((s, b) => s + b.size, 0),
    itemCount: old.length,
    items: old
      .map((b): CleanupItem => ({ label: b.label, sizeBytes: b.size, detail: b.startedAt }))
      .sort(largestFirst)
      .slice(0, OLD_BACKUP_SAMPLE),
  });
}

async function localBackupBreakdown(): Promise<CleanupFolderSize[]> {
  let entries;
  try {
    entries = await readdir(env.BACKUP_LOCAL_ROOT, { withFileTypes: true });
  } catch {
    return [];
  }
  const sizes = await Promise.all(
    entries
      .filter((e) => e.isDirectory())
      .map(async (e) => ({ name: e.name, sizeBytes: (await duBytes(join(env.BACKUP_LOCAL_ROOT, e.name))) ?? 0 }))
  );
  return sizes.filter((s) => s.sizeBytes > 0).sort((a, b) => b.sizeBytes - a.sizeBytes);
}

async function diskInfo() {
  const s = await statfs("/");
  const total = s.blocks * s.bsize;
  const free = s.bavail * s.bsize;
  return { path: "/", totalBytes: total, freeBytes: free, usedPct: total > 0 ? Math.round((1 - s.bfree / s.blocks) * 100) : 0 };
}

// ---- cleaners -------------------------------------------------------------------

async function deleteFiles(files: { path: string; size: number }[]): Promise<{ freed: number; failed: number }> {
  let freed = 0;
  let failed = 0;
  for (const f of files) {
    try {
      await unlink(f.path);
      freed += f.size;
    } catch {
      failed++;
    }
  }
  return { freed, failed };
}

/** Best-effort removal of folders left empty, never above `stopAt`. */
async function pruneEmptyDirs(start: string, stopAt: string): Promise<void> {
  let dir = start;
  while (dir.startsWith(stopAt + sep) && dir !== stopAt) {
    try {
      await rmdir(dir); // fails if not empty, which is exactly when we stop
    } catch {
      return;
    }
    dir = dirname(dir);
  }
}

const reclaimedFromDocker = (out: string): number | null => {
  const m = out.match(/(?:reclaimed space|Total):\s*([\d.]+)\s*([kKMGT]?B)/);
  return m ? parseSize(m[1], m[2], 1000) : null;
};

async function runOne(id: CleanupCategoryId, days: number): Promise<CleanupRunResult> {
  try {
    switch (id) {
      case "apt-cache": {
        const before = (await duBytes(APT_CACHE_DIR)) ?? 0;
        await runCommand("sudo", ["/usr/bin/apt-get", "clean"], { env: LC, timeoutMs: 60_000 });
        const after = (await duBytes(APT_CACHE_DIR)) ?? 0;
        return { id, ok: true, freedBytes: Math.max(0, before - after), message: null };
      }

      case "journal": {
        const { stdout, stderr } = await runCommand("sudo", ["/usr/bin/journalctl", `--vacuum-time=${JOURNAL_KEEP}`], {
          env: LC,
          timeoutMs: 120_000,
        });
        let freed = 0;
        for (const m of `${stdout}\n${stderr}`.matchAll(/freed ([\d.]+)\s*([KMGT]?)B?/gi)) freed += parseSize(m[1], m[2], 1024);
        return { id, ok: true, freedBytes: freed, message: null };
      }

      case "docker-dangling-images": {
        const { stdout } = await runCommand("docker", ["image", "prune", "-f"], { env: LC, timeoutMs: 120_000 });
        return { id, ok: true, freedBytes: reclaimedFromDocker(stdout), message: null };
      }

      case "docker-build-cache": {
        const { stdout } = await runCommand("docker", ["builder", "prune", "-f"], { env: LC, timeoutMs: 120_000 });
        return { id, ok: true, freedBytes: reclaimedFromDocker(stdout), message: null };
      }

      case "npm-cache": {
        const dir = join(homedir(), ".npm", "_cacache");
        const before = (await duBytes(dir)) ?? 0;
        await rm(dir, { recursive: true, force: true });
        return { id, ok: true, freedBytes: before, message: null };
      }

      case "app-temp": {
        const { freed, failed } = await deleteFiles(await collectAppTemp());
        for (const name of APP_TEMP_DIRS) {
          const dir = join(env.BACKUP_LOCAL_ROOT, name);
          // Empty subfolders only; the staging folders themselves are recreated on demand.
          await pruneEmptyDirsUnder(dir);
        }
        return { id, ok: failed === 0, freedBytes: freed, message: failed ? `${failed}_failed` : null };
      }

      case "tmp-owned": {
        const { freed, failed } = await deleteFiles(await collectOwnTmp());
        return { id, ok: failed === 0, freedBytes: freed, message: failed ? `${failed}_failed` : null };
      }

      case "old-backups": {
        const old = await collectOldBackups(days);
        const root = resolve(env.BACKUP_LOCAL_ROOT);
        let freed = 0;
        let failed = 0;
        for (const b of old) {
          try {
            await unlink(b.path);
            freed += b.size;
          } catch {
            failed++;
            continue;
          }
          // The run is only forgotten when no USB/Drive copy remains; otherwise it stays
          // in the history as an external-only backup.
          if (!b.hasExternalCopy) BackupHistoryModel.deleteByRunId(b.runId);
          await pruneEmptyDirs(dirname(b.path), root);
        }
        return { id, ok: failed === 0, freedBytes: freed, message: failed ? `${failed}_failed` : null };
      }
    }
  } catch (err) {
    return { id, ok: false, freedBytes: null, message: (err as Error).message };
  }
}

/** Removes folders left empty under one of the app's staging folders. */
async function pruneEmptyDirsUnder(dir: string): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sub = join(dir, entry.name);
    await pruneEmptyDirsUnder(sub);
    await rmdir(sub).catch(() => {});
  }
}

const ORDER: CleanupCategoryId[] = [
  "app-temp",
  "tmp-owned",
  "npm-cache",
  "docker-dangling-images",
  "docker-build-cache",
  "apt-cache",
  "journal",
  "old-backups",
];

export const CleanupService = {
  async scan(backupDays: number): Promise<CleanupScan> {
    const [disk, aptCache, journal, docker_, npm, appTemp, ownTmp, oldBackups, localBackups] = await Promise.all([
      diskInfo(),
      scanAptCache(),
      scanJournal(),
      scanDocker(),
      scanNpmCache(),
      scanAppTemp(),
      scanOwnTmp(),
      scanOldBackups(backupDays),
      localBackupBreakdown(),
    ]);
    return {
      scannedAt: new Date().toISOString(),
      disk,
      backupDays,
      backupMinCopies: env.BACKUP_RETENTION_MIN_COPIES,
      categories: [appTemp, ownTmp, npm, ...docker_, aptCache, journal, oldBackups],
      localBackups,
    };
  },

  async run(ids: CleanupCategoryId[], backupDays: number): Promise<CleanupRunResponse> {
    if (running) throw new Error("cleanup_already_running");
    running = true;
    try {
      const before = (await diskInfo()).freeBytes;
      const results: CleanupRunResult[] = [];
      for (const id of ORDER.filter((c) => ids.includes(c))) results.push(await runOne(id, backupDays));
      return { results, freeBytesBefore: before, freeBytesAfter: (await diskInfo()).freeBytes };
    } finally {
      running = false;
    }
  },
};
