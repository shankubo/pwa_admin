import { randomUUID, createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile, copyFile } from "node:fs/promises";
import { createReadStream as createReadStreamFs, readFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { hostname } from "node:os";
import { fileURLToPath } from "node:url";
import si from "systeminformation";
import { docker } from "../../services/docker.client.js";
import { runCommand } from "../../utils/exec.js";
import { UsbBackupService } from "../../services/usbBackup.client.js";
import { registerChannel } from "../../services/wsHub.js";
import { OsService } from "../os/os.service.js";
import { BackupService } from "../backup/backup.service.js";
import { DbBackupService } from "../dbbackup/dbbackup.service.js";
import { NginxService } from "../nginx/nginx.service.js";
import { ApplicationService } from "../application/application.service.js";
import { ApplicationModel, AppBackupRunModel, type ApplicationRow } from "../../db/models/application.js";
import { findLinkedContainer } from "../sites/siteDuplicate.service.js";
import { env } from "../../config/env.js";
import { MigrationSnapshotModel, MigrationRestoreModel, MigrationRestoredArchiveModel } from "../../db/models/migration.js";
import { BackupHistoryModel } from "../../db/models/backup.js";
import type {
  MigrationManifest,
  MigrationManifestItem,
  MigrationManifestScope,
  MigrationApplicationPathArchive,
  MigrationRestoreItemResult,
  MigrationContainerConfig,
  MigrationDatabaseTarget,
  MigrationRestorePlan,
  MigrationPlanPackageLine,
  MigrationPlanItemLine,
} from "@pwa-admin/shared";

type MigrationRestoreResults = MigrationRestoreItemResult[];

const __dirname = dirname(fileURLToPath(import.meta.url));

function readPwaAdminVersion(): string {
  try {
    const pkgPath = join(__dirname, "..", "..", "..", "..", "..", "package.json");
    return (JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string }).version ?? "unknown";
  } catch {
    return "unknown";
  }
}

// Same per-key pusher-set pattern as AptJobRunner's "os.upgrade" channel —
// one channel handles progress for every snapshot run, keyed by manifestId.
const snapshotPushers = new Map<string, Set<(data: unknown) => void>>();

registerChannel("migration.snapshot", (params, push) => {
  const manifestId = params.manifestId as string;
  let set = snapshotPushers.get(manifestId);
  if (!set) {
    set = new Set();
    snapshotPushers.set(manifestId, set);
  }
  set.add(push);
  return () => {
    set!.delete(push);
    if (set!.size === 0) snapshotPushers.delete(manifestId);
  };
});

function publishProgress(manifestId: string, data: unknown): void {
  const set = snapshotPushers.get(manifestId);
  if (set) for (const push of set) push(data);
}

// Separate pusher map (own channel "migration.restore") for the restore
// side — a restore run is keyed by its own restoreId, distinct from the
// manifestId it restores from, so a manifest can be restored more than once
// (e.g. a first partial attempt, then a retry) without progress from an
// earlier run leaking into a later one.
const restorePushers = new Map<string, Set<(data: unknown) => void>>();

registerChannel("migration.restore", (params, push) => {
  const restoreId = params.restoreId as string;
  let set = restorePushers.get(restoreId);
  if (!set) {
    set = new Set();
    restorePushers.set(restoreId, set);
  }
  set.add(push);
  return () => {
    set!.delete(push);
    if (set!.size === 0) restorePushers.delete(restoreId);
  };
});

function publishRestoreProgress(restoreId: string, data: unknown): void {
  const set = restorePushers.get(restoreId);
  if (set) for (const push of set) push(data);
}

/** Runs one capture step, tolerating failure — a single failed DB/volume/app
 * must not abort the whole snapshot, since the point is the most complete
 * instantaneous picture possible, not an all-or-nothing transaction. */
async function captureItem(
  manifestId: string,
  category: MigrationManifestItem["category"],
  label: string,
  fn: () => Promise<{
    sourceRunId: string | null;
    archiveRelPath: string | null;
    sizeBytes: number | null;
    containerConfig?: MigrationManifestItem["containerConfig"];
    applicationPaths?: MigrationManifestItem["applicationPaths"];
    applicationDbArchivePath?: MigrationManifestItem["applicationDbArchivePath"];
    databaseTarget?: MigrationManifestItem["databaseTarget"];
    volumeTarget?: MigrationManifestItem["volumeTarget"];
  }>
): Promise<MigrationManifestItem> {
  const defaults = {
    containerConfig: null,
    applicationPaths: null,
    applicationDbArchivePath: null,
    databaseTarget: null,
    volumeTarget: null,
  } as const;
  try {
    const result = await fn();
    const item: MigrationManifestItem = { category, label, status: "success", error: null, ...defaults, ...result };
    publishProgress(manifestId, { item });
    return item;
  } catch (err) {
    const item: MigrationManifestItem = {
      category,
      label,
      sourceRunId: null,
      archiveRelPath: null,
      sizeBytes: null,
      ...defaults,
      status: "failed",
      error: (err as Error).message,
    };
    publishProgress(manifestId, { item });
    return item;
  }
}

/** Captures the docker.createContainer()-shaped config a from-scratch
 * restore needs — see MigrationContainerConfig's doc comment for why this
 * can't be re-derived from a live inspect() during restore on a blank server. */
async function captureContainerConfig(containerId: string, containerName: string): Promise<MigrationManifestItem["containerConfig"]> {
  const info = await docker.getContainer(containerId).inspect();
  return {
    containerName,
    image: info.Config.Image,
    env: info.Config.Env ?? [],
    cmd: Array.isArray(info.Config.Cmd) ? info.Config.Cmd : info.Config.Cmd ? [info.Config.Cmd] : null,
    entrypoint: Array.isArray(info.Config.Entrypoint)
      ? info.Config.Entrypoint
      : info.Config.Entrypoint
        ? [info.Config.Entrypoint]
        : null,
    exposedPorts: info.Config.ExposedPorts ?? {},
    labels: info.Config.Labels ?? {},
    hostConfig: info.HostConfig,
    wasRunning: info.State.Running,
  };
}

/**
 * A migration snapshot must be a fully self-contained, independently
 * deletable folder on the USB drive — never mixed into the shared
 * BACKUP/<hostname>/{volumes,paths,db}/ tree the day-to-day Backups screen
 * also writes to (those are subject to their own, unrelated retention
 * cleanup, and a migration folder disappearing because an ordinary backup's
 * retention policy pruned it would be a nasty surprise for a disaster-
 * recovery artifact). Each existing capture function (backupVolume/dump/
 * backupContainerImage) still writes its own local archive + its own
 * standard-category USB copy exactly as it always has — this copies that
 * SAME local archive a second time into migration/<manifestId>/<category>/
 * so the manifest never references anything outside its own folder.
 */
async function copyIntoMigrationRoot(
  runId: string,
  usbRoot: string,
  category: string,
  label: string
): Promise<string | null> {
  const localPath = BackupHistoryModel.findByRunId(runId)?.file_path;
  if (!localPath) return null;
  const destDir = join(usbRoot, category, label);
  await mkdir(destDir, { recursive: true });
  const destPath = join(destDir, basename(localPath));
  await copyFile(localPath, destPath);
  return destPath;
}

/** ApplicationService.runBackup fires its USB copy leg fire-and-forget
 * (copySnapshotToUsb(...).catch(() => {})) so the local backup itself isn't
 * blocked on a possibly multi-GB USB write — but a migration snapshot IS the
 * USB copy, so this polls app_backup_runs.usb_copy_status until it leaves
 * "pending"/"compressing"/"uploading" before the manifest is written, rather
 * than racing it and capturing an empty usbPaths list. */
async function waitForAppUsbCopy(runId: string, timeoutMs = 600_000): Promise<void> {
  const start = Date.now();
  for (;;) {
    const run = AppBackupRunModel.findByRunId(runId);
    if (!run) throw new Error("app_backup_run_not_found");
    if (!["pending", "compressing", "uploading"].includes(run.usb_copy_status)) return;
    if (Date.now() - start > timeoutMs) throw new Error("usb_copy_timed_out");
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function usbRootFor(manifestId: string): Promise<string> {
  const drives = (await UsbBackupService.detectDrives()).filter((d) => d.isBackupConfigured);
  if (drives.length === 0) throw new Error("no_usb_backup_drive_configured");
  return join(drives[0].backupRoot, "migration", manifestId);
}

async function captureOsPackages(manifestId: string, usbRoot: string): Promise<MigrationManifestItem> {
  return captureItem(manifestId, "os-packages", "Paquets systeme (dpkg)", async () => {
    const packages = await OsService.listInstalledPackages();
    await mkdir(usbRoot, { recursive: true });
    const destPath = join(usbRoot, "os-packages.json");
    const json = JSON.stringify(packages, null, 2);
    await writeFile(destPath, json);
    return { sourceRunId: null, archiveRelPath: destPath, sizeBytes: json.length };
  });
}

async function capturePwaAdminConfig(manifestId: string, usbRoot: string): Promise<MigrationManifestItem> {
  return captureItem(manifestId, "pwa-admin-config", "Configuration pwa-admin (.env + secrets/)", async () => {
    const destDir = join(usbRoot, "pwa-admin-config");
    await mkdir(destDir, { recursive: true });
    const destPath = join(destDir, `pwa-admin-config-${Date.now()}.tar.gz`);
    // Only .env and secrets/ — never Tailscale certs, which are bound to the
    // old machine's Tailscale identity and are never portable to a new one.
    // No sudo needed: APP_DIR/.env and APP_DIR/secrets are owned by this
    // same service user (see install.sh's chown), and the USB mountpoint
    // itself is owned by the service user too (backup-usb-mount.sh) — unlike
    // captureNginxConfig's /etc/nginx source or the bind-mount tars
    // elsewhere, there's no ownership boundary to cross here.
    await runCommand("tar", ["czf", destPath, "-C", env.APP_DIR, ".env", "secrets"], { timeoutMs: 30_000 });
    const stats = await stat(destPath);
    return { sourceRunId: null, archiveRelPath: destPath, sizeBytes: stats.size };
  });
}

async function captureNginxConfig(manifestId: string, usbRoot: string): Promise<MigrationManifestItem> {
  return captureItem(manifestId, "nginx-config", "Configuration Nginx (vhosts)", async () => {
    const run = await NginxService.backupConfig(["local"]);
    if (run.status === "failed") throw new Error(run.error ?? "nginx_config_backup_failed");
    // backupConfig doesn't return the archive path — it's deterministic from
    // the runId it generates (`nginx-cfg-<ts>`), same layout it writes to.
    const localPath = join(env.BACKUP_LOCAL_ROOT, "nginx-config", `${run.runId}.tar.gz`);
    const destDir = join(usbRoot, "nginx-config");
    await mkdir(destDir, { recursive: true });
    const destPath = join(destDir, basename(localPath));
    await copyFile(localPath, destPath);
    return { sourceRunId: run.runId, archiveRelPath: destPath, sizeBytes: run.sizeBytes };
  });
}

export const MigrationService = {
  /**
   * Kicks off a whole-server snapshot in the background and returns
   * immediately — capturing every container image, volume, database, and app
   * can take a long time, so the frontend polls/subscribes rather than
   * holding one HTTP request open (same shape as SiteDuplicateService).
   */
  async captureSnapshot(): Promise<{ manifestId: string }> {
    const manifestId = randomUUID();
    const scope: MigrationManifestScope = { type: "server" };
    MigrationSnapshotModel.createRun(manifestId, scope);

    runCaptureSnapshot(manifestId, scope).catch((err) => {
      MigrationSnapshotModel.complete(manifestId, { status: "failed", error: (err as Error).message });
      publishProgress(manifestId, { done: true, status: "failed", error: (err as Error).message });
    });

    return { manifestId };
  },

  /**
   * Same capture pipeline as captureSnapshot, scoped to one vhost's linked
   * container/volumes/database/nginx-config — the "Migration" button next to
   * "Dupliquer" on a Sites card. Never includes os-packages (a Docker site's
   * dependencies travel inside its own image) or pwa-admin-config (server-wide
   * only).
   */
  async captureSiteSnapshot(vhostName: string): Promise<{ manifestId: string }> {
    const manifestId = randomUUID();
    const scope: MigrationManifestScope = { type: "site", siteName: vhostName };
    MigrationSnapshotModel.createRun(manifestId, scope);

    runCaptureSnapshot(manifestId, scope).catch((err) => {
      MigrationSnapshotModel.complete(manifestId, { status: "failed", error: (err as Error).message });
      publishProgress(manifestId, { done: true, status: "failed", error: (err as Error).message });
    });

    return { manifestId };
  },

  getSnapshotStatus(manifestId: string) {
    return MigrationSnapshotModel.findByManifestId(manifestId);
  },

  listSnapshots() {
    return MigrationSnapshotModel.list();
  },

  /** Reads every manifest.json already written to the configured USB drive —
   * ground truth independent of the local migration_snapshots table, same
   * "browse what's actually there" principle as UsbBackupService.browseArchives. */
  async listManifestsOnUsb(): Promise<MigrationManifest[]> {
    const drives = (await UsbBackupService.detectDrives()).filter((d) => d.isBackupConfigured);
    const manifests: MigrationManifest[] = [];
    for (const drive of drives) {
      const migrationDir = join(drive.backupRoot, "migration");
      let manifestIds: string[];
      try {
        manifestIds = (await readdir(migrationDir, { withFileTypes: true }))
          .filter((e) => e.isDirectory())
          .map((e) => e.name);
      } catch {
        continue;
      }
      for (const id of manifestIds) {
        try {
          const raw = await readFile(join(migrationDir, id, "manifest.json"), "utf8");
          manifests.push(JSON.parse(raw) as MigrationManifest);
        } catch {
          // manifest.json missing/corrupt (snapshot interrupted before it was
          // written) — skip rather than fail the whole listing.
        }
      }
    }
    return manifests.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  /**
   * Orchestrates a full restore from a previously captured manifest — the
   * server-side counterpart to Restore.tsx's "Migration serveur" flow.
   * Kicks off in the background and returns immediately (same shape as
   * captureSnapshot); the frontend follows progress via WS channel
   * "migration.restore" keyed by the returned restoreId. Every item is
   * restored through the SAME functions the rest of the app already uses for
   * normal (same-server) restores — this is an orchestrator, not a new
   * restore engine.
   */
  async restoreFromManifest(manifestId: string, options: { includeOsPackages: boolean }): Promise<{ restoreId: string }> {
    const manifest = (await this.listManifestsOnUsb()).find((m) => m.manifestId === manifestId);
    if (!manifest) throw new Error("manifest_not_found_on_usb");

    const restoreId = randomUUID();
    MigrationRestoreModel.createRun(restoreId, manifestId, options.includeOsPackages);

    runRestoreFromManifest(restoreId, manifest, options).catch((err) => {
      MigrationRestoreModel.complete(restoreId, { status: "failed", error: (err as Error).message });
      publishRestoreProgress(restoreId, { done: true, status: "failed", error: (err as Error).message });
    });

    return { restoreId };
  },

  getRestoreStatus(restoreId: string) {
    return MigrationRestoreModel.findByRestoreId(restoreId);
  },

  listRestores() {
    return MigrationRestoreModel.list();
  },

  /**
   * Pre-flight dry-run: inspects the CURRENT state of this server (installed
   * packages, what's already been restored from this exact manifest before)
   * and reports what restoreFromManifest would do, without changing
   * anything. Shown to the admin before the typed-RESTORE confirmation, so
   * nothing is modified until they've seen the actual plan. Reuses the exact
   * same target-kind/name keys and checksum comparison restoreIfChanged
   * uses during the real restore, so the plan and the actual run never
   * disagree about what counts as "unchanged".
   */
  async planRestore(manifestId: string): Promise<MigrationRestorePlan> {
    const manifest = (await this.listManifestsOnUsb()).find((m) => m.manifestId === manifestId);
    if (!manifest) throw new Error("manifest_not_found_on_usb");

    const currentOsInfo = await OsService.getInfo();
    const osMatch = currentOsInfo.distro === manifest.osDistro && currentOsInfo.release === manifest.osRelease;

    const packages: MigrationPlanPackageLine[] = [];
    const osPackagesItem = manifest.items.find((i) => i.category === "os-packages" && i.status === "success");
    if (osPackagesItem?.archiveRelPath) {
      try {
        const declared = JSON.parse(await readFile(osPackagesItem.archiveRelPath, "utf8")) as {
          name: string;
          version: string;
        }[];
        const installedByName = new Map((await OsService.listInstalledPackages()).map((p) => [p.name, p.version]));
        for (const pkg of declared) {
          const currentVersion = installedByName.get(pkg.name) ?? null;
          packages.push({
            name: pkg.name,
            currentVersion,
            manifestVersion: pkg.version,
            action: currentVersion == null ? "install" : currentVersion === pkg.version ? "up-to-date" : "upgrade",
          });
        }
      } catch {
        // os-packages.json unreadable (USB unplugged mid-check, corrupt
        // file) — plan still returns, just without a package breakdown.
      }
    }

    const items: MigrationPlanItemLine[] = [];
    for (const item of manifest.items) {
      if (item.status !== "success") continue;
      if (item.category === "os-packages" || item.category === "pwa-admin-config") continue;

      if (item.category === "docker-image" && item.containerConfig && item.archiveRelPath) {
        items.push(await planReplaceLine(item, "docker-image", item.containerConfig.containerName, item.archiveRelPath));
      } else if (item.category === "docker-volume" && item.volumeTarget && item.archiveRelPath) {
        items.push(await planReplaceLine(item, "docker-volume", item.volumeTarget.volumeName, item.archiveRelPath));
      } else if (item.category === "nginx-config" && item.archiveRelPath) {
        items.push(await planReplaceLine(item, "nginx-config", "server", item.archiveRelPath));
      } else if (item.category === "database") {
        items.push({ category: item.category, label: item.label, action: "restore", detail: null });
      } else if (item.category === "application") {
        const lines: string[] = [];
        if (item.applicationDbArchivePath) {
          const appName = item.label.replace(/^Application /, "");
          const changed = await wouldChange("application-db", appName, item.applicationDbArchivePath);
          lines.push(`base de données : ${changed ? "restaurer" : "déjà à jour"}`);
        }
        for (const { path, usbArchivePath } of item.applicationPaths ?? []) {
          const changed = await wouldChange("application-path", path, usbArchivePath);
          lines.push(`${path} : ${changed ? "remplacer" : "déjà à jour"}`);
        }
        const anyChange =
          (item.applicationDbArchivePath ? lines[0]?.endsWith("restaurer") : false) ||
          lines.slice(item.applicationDbArchivePath ? 1 : 0).some((l) => l.endsWith("remplacer"));
        items.push({
          category: item.category,
          label: item.label,
          action: anyChange ? "replace" : "skip-unchanged",
          detail: lines.join(" · ") || null,
        });
      }
    }

    return {
      manifestId,
      osMatch,
      currentOsDistro: currentOsInfo.distro,
      currentOsRelease: currentOsInfo.release,
      manifestOsDistro: manifest.osDistro,
      manifestOsRelease: manifest.osRelease,
      packages,
      items,
    };
  },
};

async function wouldChange(targetKind: string, targetName: string, archivePath: string): Promise<boolean> {
  const checksum = await sha256OfFile(archivePath);
  return MigrationRestoredArchiveModel.getChecksum(targetKind, targetName) !== checksum;
}

async function planReplaceLine(
  item: MigrationManifestItem,
  targetKind: string,
  targetName: string,
  archivePath: string
): Promise<MigrationPlanItemLine> {
  const changed = await wouldChange(targetKind, targetName, archivePath);
  return {
    category: item.category,
    label: item.label,
    action: changed ? "replace" : "skip-unchanged",
    detail: changed ? null : "archive identique déjà restaurée",
  };
}

async function captureServerItems(manifestId: string, usbRoot: string): Promise<MigrationManifestItem[]> {
  const items: MigrationManifestItem[] = [];

  items.push(await captureOsPackages(manifestId, usbRoot));

  const containers = await docker.listContainers({ all: false });
  for (const c of containers) {
    const containerName = c.Names[0]?.replace(/^\//, "") ?? c.Id.slice(0, 12);
    items.push(
      await captureItem(manifestId, "docker-image", `Image du conteneur ${containerName}`, async () => {
        const [runId, containerConfig] = await Promise.all([
          ApplicationService.backupContainerImage(containerName, ["usb"]),
          captureContainerConfig(c.Id, containerName),
        ]);
        const archiveRelPath = await copyIntoMigrationRoot(runId, usbRoot, "docker-images", containerName);
        return { sourceRunId: runId, archiveRelPath, sizeBytes: null, containerConfig };
      })
    );
  }

  const { Volumes } = await docker.listVolumes();
  for (const v of Volumes ?? []) {
    items.push(
      await captureItem(manifestId, "docker-volume", `Volume ${v.Name}`, async () => {
        const runId = await BackupService.backupVolume(v.Name, ["usb"]);
        const archiveRelPath = await copyIntoMigrationRoot(runId, usbRoot, "docker-volumes", v.Name);
        return { sourceRunId: runId, archiveRelPath, sizeBytes: null, volumeTarget: { volumeName: v.Name } };
      })
    );
  }

  const databases = await DbBackupService.detect();
  for (const dbInfo of databases) {
    items.push(
      await captureItem(manifestId, "database", `Base de donnees ${dbInfo.displayName}`, async () => {
        const runId = await DbBackupService.dump(dbInfo.location, dbInfo.ref, ["usb"]);
        const archiveRelPath = await copyIntoMigrationRoot(runId, usbRoot, "databases", dbInfo.ref);
        // dbInfo.displayName is the container name for location=docker (same
        // convention as everywhere else — see DbBackupService.detect) or the
        // systemd service name for location=native, either of which is what
        // restore needs — never the raw Docker container ID in dbInfo.ref,
        // which won't exist as-is on the new server (see MigrationDatabaseTarget).
        return {
          sourceRunId: runId,
          archiveRelPath,
          sizeBytes: null,
          databaseTarget: { location: dbInfo.location, containerNameOrService: dbInfo.displayName },
        };
      })
    );
  }

  items.push(await captureNginxConfig(manifestId, usbRoot));

  for (const app of ApplicationModel.list()) {
    items.push(await captureApplication(manifestId, usbRoot, app));
  }

  items.push(await capturePwaAdminConfig(manifestId, usbRoot));

  return items;
}

async function captureApplication(manifestId: string, usbRoot: string, app: ApplicationRow): Promise<MigrationManifestItem> {
  return captureItem(manifestId, "application", `Application ${app.name}`, async () => {
    // runBackup only fires the USB copy leg (and only moves usb_copy_status
    // off its "none" default) when app.targets includes "usb" — the
    // Application's own day-to-day backup target choice, unrelated to
    // whether THIS particular run is for a migration snapshot. A migration
    // capture must always reach USB regardless of that setting, or
    // waitForAppUsbCopy below sees "none" and returns immediately with an
    // empty usbPaths — silently dropping this app's files from the
    // snapshot. Force "usb" into the targets for this one call via a
    // shallow copy, without touching the Application's persisted row.
    const existingTargets = JSON.parse(app.targets) as string[];
    const appWithUsbTarget: ApplicationRow = existingTargets.includes("usb")
      ? app
      : { ...app, targets: JSON.stringify([...existingTargets, "usb"]) };
    const runId = await ApplicationService.runBackup(appWithUsbTarget, "full");
    const paths = JSON.parse(app.paths) as string[];

    let applicationPaths: MigrationManifestItem["applicationPaths"] = null;
    if (paths.length > 0) {
      await waitForAppUsbCopy(runId);
      const run = AppBackupRunModel.findByRunId(runId);
      const usbPaths = run?.usb_paths ? (JSON.parse(run.usb_paths) as string[]) : [];
      // copySnapshotToUsb writes one archive per path, in the same order as
      // `paths` — zip them back together positionally, then copy each into
      // the self-contained migration folder (never reference the shared
      // BACKUP/<hostname>/apps/ tree directly).
      const destDir = join(usbRoot, "applications", app.name);
      await mkdir(destDir, { recursive: true });
      const zipped: MigrationApplicationPathArchive[] = [];
      for (let i = 0; i < paths.length; i++) {
        if (!usbPaths[i]) continue;
        const destPath = join(destDir, basename(usbPaths[i]));
        await copyFile(usbPaths[i], destPath);
        zipped.push({ path: paths[i], usbArchivePath: destPath });
      }
      applicationPaths = zipped;
    }

    let applicationDbArchivePath: string | null = null;
    const run = AppBackupRunModel.findByRunId(runId);
    if (run?.db_dump_path) {
      const dbRow = BackupHistoryModel.list(500).find((r) => r.file_path === run.db_dump_path);
      applicationDbArchivePath = dbRow
        ? await copyIntoMigrationRoot(dbRow.run_id, usbRoot, "applications", `${app.name}-db`)
        : null;
    }

    return { sourceRunId: runId, archiveRelPath: null, sizeBytes: null, applicationPaths, applicationDbArchivePath };
  });
}

/**
 * Scoped to one vhost's linked container. Never captures os-packages (a
 * Docker container's system dependencies already travel inside its own image
 * via the docker-image item below — see the "capture ciblee par site" design
 * note) or pwa-admin-config (server-wide only). For a site with no linked
 * Docker container (a native Node.js/PM2 site), there's nothing to snapshot
 * here today — capturing native-site dependencies requires an admin-declared
 * package list, not auto-detection, and isn't implemented in this phase.
 */
async function captureSiteItems(manifestId: string, usbRoot: string, vhostName: string): Promise<MigrationManifestItem[]> {
  const items: MigrationManifestItem[] = [];

  const vhost = await NginxService.getVhostDetail(vhostName);
  const linkedContainer = await findLinkedContainer(vhost.proxyPassTarget);

  if (linkedContainer) {
    items.push(
      await captureItem(manifestId, "docker-image", `Image du conteneur ${linkedContainer.name}`, async () => {
        const [runId, containerConfig] = await Promise.all([
          ApplicationService.backupContainerImage(linkedContainer.name, ["usb"]),
          captureContainerConfig(linkedContainer.id, linkedContainer.name),
        ]);
        const archiveRelPath = await copyIntoMigrationRoot(runId, usbRoot, "docker-images", linkedContainer.name);
        return { sourceRunId: runId, archiveRelPath, sizeBytes: null, containerConfig };
      })
    );

    const info = await docker.getContainer(linkedContainer.id).inspect();
    for (const m of info.Mounts ?? []) {
      if (m.Type === "volume" && m.Name) {
        const volumeName = m.Name;
        items.push(
          await captureItem(manifestId, "docker-volume", `Volume ${volumeName}`, async () => {
            const runId = await BackupService.backupVolume(volumeName, ["usb"]);
            const archiveRelPath = await copyIntoMigrationRoot(runId, usbRoot, "docker-volumes", volumeName);
            return { sourceRunId: runId, archiveRelPath, sizeBytes: null, volumeTarget: { volumeName } };
          })
        );
      }
    }

    const app = ApplicationModel.list().find((a) => JSON.parse(a.container_names).includes(linkedContainer.name));
    if (app?.db_location && app.db_ref) {
      const location = app.db_location as "docker" | "native";
      const ref = app.db_ref;
      items.push(
        await captureItem(manifestId, "database", `Base de donnees (${app.name})`, async () => {
          const runId = await DbBackupService.dump(location, ref, ["usb"]);
          const archiveRelPath = await copyIntoMigrationRoot(runId, usbRoot, "databases", ref);
          // Same rationale as captureServerItems's database loop — resolve to
          // a container NAME (stable-by-name across a recreate), not the raw
          // container ID stored in db_ref, which is meaningless on a new server.
          const containerNameOrService =
            location === "docker"
              ? (await docker.getContainer(ref).inspect()).Name.replace(/^\//, "")
              : ref;
          return { sourceRunId: runId, archiveRelPath, sizeBytes: null, databaseTarget: { location, containerNameOrService } };
        })
      );
    }
  }

  items.push(await captureNginxConfig(manifestId, usbRoot));

  return items;
}

async function runCaptureSnapshot(manifestId: string, scope: MigrationManifestScope): Promise<void> {
  const usbRoot = await usbRootFor(manifestId);
  await mkdir(usbRoot, { recursive: true });

  const items: MigrationManifestItem[] =
    scope.type === "server"
      ? await captureServerItems(manifestId, usbRoot)
      : await captureSiteItems(manifestId, usbRoot, scope.siteName);

  const osInfo = await si.osInfo();
  const manifest: MigrationManifest = {
    manifestId,
    hostname: hostname(),
    createdAt: new Date().toISOString(),
    pwaAdminVersion: readPwaAdminVersion(),
    osDistro: osInfo.distro,
    osRelease: osInfo.release,
    scope,
    items,
    usbRoot,
  };

  await writeFile(join(usbRoot, "manifest.json"), JSON.stringify(manifest, null, 2));

  const anyFailed = items.some((i) => i.status === "failed");
  const finalStatus = anyFailed ? "partial" : "success";
  MigrationSnapshotModel.complete(manifestId, { status: finalStatus, manifest });
  publishProgress(manifestId, { done: true, status: finalStatus });
}

/** Registers a fresh backup_history row pointing directly at a manifest
 * item's archive on the (still-mounted) USB drive, then returns its runId —
 * the exact same "treat a USB archive as if it were a normal local backup"
 * trick POST /backups/usb/archives/import already uses, letting every
 * existing restore function (which all read backup_history.file_path by
 * runId) work unmodified against an archive that only exists on this
 * migration's own USB folder. */
function registerUsbArchiveAsRun(
  archivePath: string,
  sourceType: "volume" | "db" | "path" | "image",
  sourceRef: string
): string {
  const runId = BackupHistoryModel.createRun({ jobId: null, type: "backup", sourceType, sourceRef, target: "usb" });
  BackupHistoryModel.complete(runId, { status: "success", filePath: archivePath, usbPath: archivePath });
  return runId;
}

/** Thrown by a restoreItem callback to signal "already up to date, nothing
 * to do" (see restoreIfChanged) — distinct from a real failure so the item
 * is recorded as "skipped", not "failed". */
class RestoreSkipped extends Error {}

async function restoreItem(
  restoreId: string,
  results: MigrationRestoreResults,
  category: MigrationManifestItem["category"],
  label: string,
  fn: () => Promise<void>
): Promise<void> {
  try {
    await fn();
    results.push({ category, label, status: "success", error: null });
  } catch (err) {
    if (err instanceof RestoreSkipped) {
      results.push({ category, label: `${label} (déjà à jour, ignoré)`, status: "skipped", error: null });
    } else {
      results.push({ category, label, status: "failed", error: (err as Error).message });
    }
  }
  publishRestoreProgress(restoreId, { items: results });
}

async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStreamFs(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve());
    stream.on("error", reject);
  });
  return hash.digest("hex");
}

/**
 * Idempotence guard for a restore step: if this exact archive (by checksum)
 * was already applied to this exact target on a previous run of this
 * manifest, skip re-applying it — covers the realistic "restore was retried
 * after a partial failure" case without needing to hash/compare live
 * container/volume state (expensive, and not meaningfully comparable for an
 * opaque Docker volume). Returns true if the step ran, false if skipped.
 */
async function restoreIfChanged(
  targetKind: string,
  targetName: string,
  archivePath: string,
  apply: () => Promise<void>
): Promise<{ ran: boolean }> {
  const checksum = await sha256OfFile(archivePath);
  const previous = MigrationRestoredArchiveModel.getChecksum(targetKind, targetName);
  if (previous === checksum) return { ran: false };
  await apply();
  MigrationRestoredArchiveModel.setChecksum(targetKind, targetName, checksum);
  return { ran: true };
}

async function runRestoreFromManifest(
  restoreId: string,
  manifest: MigrationManifest,
  options: { includeOsPackages: boolean }
): Promise<void> {
  const results: MigrationRestoreResults = [];

  const byCategory = (category: MigrationManifestItem["category"]) =>
    manifest.items.filter((i) => i.category === category && i.status === "success");

  // OS distro/release mismatch is never a hard stop — package NAMES rarely
  // differ between Debian/Ubuntu point releases for the base packages this
  // app deals with, and OsService.installOrUpgradePackages already falls
  // back gracefully when an exact pinned VERSION isn't available. Surfaced
  // as an informational, non-failing result so the admin sees it in the
  // restore log without it blocking anything.
  const currentOsInfo = await OsService.getInfo();
  if (currentOsInfo.distro !== manifest.osDistro || currentOsInfo.release !== manifest.osRelease) {
    results.push({
      category: "os-packages",
      label: `OS différent : instantané pris sur ${manifest.osDistro} ${manifest.osRelease}, ce serveur est ${currentOsInfo.distro} ${currentOsInfo.release} — les paquets seront installés en best-effort`,
      status: "skipped",
      error: null,
    });
    publishRestoreProgress(restoreId, { items: results });
  }

  // Imposed order, not arbitrary: each step needs the previous one's
  // real-world effect already in place — containers must exist before their
  // volumes/DBs can be restored into them, and Applications may depend on
  // any/all of the above.
  if (options.includeOsPackages) {
    for (const item of byCategory("os-packages")) {
      await restoreItem(restoreId, results, item.category, item.label, async () => {
        if (!item.archiveRelPath) throw new Error("no_archive_path");
        const packages = JSON.parse(await readFile(item.archiveRelPath, "utf8")) as {
          name: string;
          version: string;
        }[];
        const outcome = await OsService.installOrUpgradePackages(
          packages.map((p) => ({ name: p.name, version: p.version }))
        );
        if (outcome.failed.length > 0) {
          throw new Error(
            `${outcome.failed.length} paquet(s) en échec: ${outcome.failed.map((f) => f.name).join(", ")}`
          );
        }
      });
    }
  }

  const containersToStart: string[] = [];
  for (const item of byCategory("docker-image")) {
    await restoreItem(restoreId, results, item.category, item.label, async () => {
      if (!item.archiveRelPath || !item.containerConfig) throw new Error("no_archive_or_config");
      if (item.containerConfig.wasRunning) containersToStart.push(item.containerConfig.containerName);
      const { ran } = await restoreIfChanged(
        "docker-image",
        item.containerConfig.containerName,
        item.archiveRelPath,
        () => createContainerFromManifest(item.archiveRelPath!, item.containerConfig!)
      );
      if (!ran) throw new RestoreSkipped();
    });
  }

  for (const item of byCategory("docker-volume")) {
    await restoreItem(restoreId, results, item.category, item.label, async () => {
      if (!item.archiveRelPath || !item.volumeTarget) throw new Error("no_archive_or_target");
      const { ran } = await restoreIfChanged(
        "docker-volume",
        item.volumeTarget.volumeName,
        item.archiveRelPath,
        () => BackupService.restoreVolume(item.volumeTarget!.volumeName, item.archiveRelPath!)
      );
      if (!ran) throw new RestoreSkipped();
    });
  }

  // Start recreated containers only now, after their volumes (if any) have
  // been filled with real data — see createContainerFromManifest's doc
  // comment for the corruption risk this ordering avoids.
  await startContainersIfNeeded(containersToStart);

  for (const item of byCategory("database")) {
    await restoreItem(restoreId, results, item.category, item.label, async () => {
      if (!item.archiveRelPath || !item.databaseTarget) throw new Error("no_archive_or_target");
      await restoreDatabaseFromManifest(item.archiveRelPath, item.databaseTarget);
    });
  }

  for (const item of byCategory("nginx-config")) {
    await restoreItem(restoreId, results, item.category, item.label, async () => {
      if (!item.archiveRelPath) throw new Error("no_archive_path");
      const { ran } = await restoreIfChanged("nginx-config", "server", item.archiveRelPath, async () => {
        // The nginx-config sudo restore rule is scoped to
        // BACKUP_LOCAL_ROOT/nginx-config/ — never an arbitrary USB path — so
        // the USB archive is copied into that staging dir first (plain
        // unprivileged copy, both sides service-user-owned).
        const destDir = join(env.BACKUP_LOCAL_ROOT, "nginx-config");
        await mkdir(destDir, { recursive: true });
        const localPath = join(destDir, `migration-restore-${Date.now()}.tar.gz`);
        await copyFile(item.archiveRelPath!, localPath);
        await NginxService.restoreConfig(localPath);
      });
      if (!ran) throw new RestoreSkipped();
    });
  }

  for (const item of byCategory("application")) {
    await restoreItem(restoreId, results, item.category, item.label, async () => {
      let anyChanged = false;

      if (item.applicationDbArchivePath) {
        // Nothing else in this codebase restores an Application's own
        // db_location/db_ref from a manifest alone — the Application row
        // itself must already exist (admin recreates it via the
        // Applications screen, same prerequisite the plan calls out), so
        // its db_location/db_ref are read from there rather than guessed.
        const appName = item.label.replace(/^Application /, "");
        const app = ApplicationModel.list().find((a) => a.name === appName);
        if (app?.db_location && app.db_ref) {
          const containerNameOrService =
            app.db_location === "docker"
              ? (await docker.getContainer(app.db_ref).inspect()).Name.replace(/^\//, "")
              : app.db_ref;
          const { ran } = await restoreIfChanged(
            "application-db",
            appName,
            item.applicationDbArchivePath,
            () =>
              restoreDatabaseFromManifest(item.applicationDbArchivePath!, {
                location: app.db_location as "docker" | "native",
                containerNameOrService,
              })
          );
          if (ran) anyChanged = true;
        }
      }
      if (item.applicationPaths) {
        for (const { path, usbArchivePath } of item.applicationPaths) {
          const { ran } = await restoreIfChanged("application-path", path, usbArchivePath, async () => {
            // Same reasoning as the nginx-config restore above — the
            // bind-mount restore sudo rule is scoped to
            // BACKUP_LOCAL_ROOT/paths/*/*.tar.gz, never an arbitrary USB
            // path, so stage a local copy first.
            const destDir = join(env.BACKUP_LOCAL_ROOT, "paths", basename(path));
            await mkdir(destDir, { recursive: true });
            const localPath = join(destDir, basename(usbArchivePath));
            await copyFile(usbArchivePath, localPath);
            await runCommand("sudo", ["tar", "xzf", localPath, "-C", path], { timeoutMs: 600_000 });
          });
          if (ran) anyChanged = true;
        }
      }

      if (!anyChanged) throw new RestoreSkipped();
    });
  }

  MigrationRestoreModel.setItems(restoreId, results);
  const anyFailed = results.some((r) => r.status === "failed");
  const finalStatus = results.length === 0 ? "success" : anyFailed ? (results.some((r) => r.status === "success") ? "partial" : "failed") : "success";
  MigrationRestoreModel.complete(restoreId, { status: finalStatus });
  publishRestoreProgress(restoreId, { done: true, status: finalStatus, items: results });
}

/**
 * Fresh-server counterpart to ApplicationService.restoreContainerImage's
 * "safe recreate" pattern — that function requires the container to already
 * exist (it inspects it before recreating), which is never true on a blank
 * server. This loads the image tar then calls docker.createContainer()
 * directly from the config captured at snapshot time, with no live
 * container to read from. If a container with this name already exists
 * (e.g. a retried restore), it's removed first — same reasoning as
 * siteDuplicate.service.ts's cloneContainerAsDuplicate.
 *
 * Deliberately does NOT start the container even if it was running at
 * capture time — a DB engine started against a freshly created (empty)
 * named volume can run its own first-boot init (initdb, permission fixups)
 * before the docker-volume restore step gets a chance to extract the real
 * data over that same volume, risking corruption or a container that never
 * sees the restored data. Starting is deferred to startContainersIfNeeded,
 * called only after every docker-volume item has been restored.
 */
async function createContainerFromManifest(archivePath: string, config: MigrationContainerConfig): Promise<void> {
  const { createReadStream } = await import("node:fs");
  const { createGunzip } = await import("node:zlib");
  const gunzip = createGunzip();
  const tarStream = createReadStream(archivePath).pipe(gunzip);
  const loadStream = await docker.loadImage(tarStream);
  await new Promise<void>((resolve, reject) => {
    docker.modem.followProgress(loadStream, (err: Error | null) => (err ? reject(err) : resolve()));
  });

  const existing = docker.getContainer(config.containerName);
  await existing.remove({ force: true }).catch(() => {});

  await docker.createContainer({
    name: config.containerName,
    Image: config.image,
    Env: config.env,
    Cmd: config.cmd ?? undefined,
    Entrypoint: config.entrypoint ?? undefined,
    ExposedPorts: config.exposedPorts,
    Labels: config.labels,
    HostConfig: config.hostConfig as any,
  });
}

/** Starts every recreated container that was running at capture time — run
 * once, after docker-volume restore has filled in real data, so a DB engine
 * (or any stateful process) never boots against an empty freshly-created
 * volume. See createContainerFromManifest's doc comment for the failure
 * this ordering avoids. */
async function startContainersIfNeeded(containerNames: string[]): Promise<void> {
  for (const name of containerNames) {
    try {
      const container = docker.getContainer(name);
      const info = await container.inspect();
      if (!info.State.Running) await container.start();
    } catch {
      // Container missing/already handled elsewhere — the docker-image
      // item itself already reported its own success/failure; a start
      // failure here is surfaced by the caller's own try/catch instead.
    }
  }
}

/** Resolves a captured MigrationDatabaseTarget to the ref DbBackupService.restore
 * actually needs on THIS server — a native ref (systemd service name) is used
 * as-is, but a docker ref must be re-resolved from container NAME to this
 * server's freshly assigned container ID (see MigrationDatabaseTarget's doc
 * comment for why the old ID is never reusable). */
async function restoreDatabaseFromManifest(archivePath: string, target: MigrationDatabaseTarget): Promise<void> {
  let ref = target.containerNameOrService;
  if (target.location === "docker") {
    const info = await docker.getContainer(target.containerNameOrService).inspect();
    ref = info.Id;
  }
  const runId = registerUsbArchiveAsRun(archivePath, "db", target.containerNameOrService);
  await DbBackupService.restore(target.location, ref, runId);
}
