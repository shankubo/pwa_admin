import { readdir, readFile, writeFile, mkdir, copyFile, lstat, rm, stat } from "node:fs/promises";
import { existsSync, createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { join, resolve, basename } from "node:path";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { db } from "../../db/index.js";
import { env } from "../../config/env.js";
import { runCommand, ExecError } from "../../utils/exec.js";
import { GDriveService } from "../../services/gdrive.client.js";
import { parseVhostSummary, applyMaintenanceMode } from "./nginx.parser.js";
import type {
  NginxStatus,
  NginxVhostSummary,
  NginxVhostDetail,
  NginxConfigSnapshot,
  NginxCertStatus,
  NginxVhostAccessibility,
  NginxVhostErrorSummary,
  NginxConfigBackupRun,
} from "@pwa-admin/shared";

const VHOST_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

function assertValidVhostName(name: string): void {
  if (!VHOST_NAME_RE.test(name) || name.length > 200) {
    throw new Error("invalid_vhost_name");
  }
}

/**
 * Different nginx setups name per-vhost logs differently (e.g. `name.access.log`
 * vs `name_access.log`). Try the known conventions before falling back to the
 * shared log with grep filtering.
 */
export async function resolveVhostLogPath(name: string, type: "access" | "error"): Promise<string | null> {
  const candidates = [
    join(env.NGINX_LOG_DIR, `${name}.${type}.log`),
    join(env.NGINX_LOG_DIR, `${name}_${type}.log`),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Resolves a vhost name against the configured root and verifies it doesn't escape it. */
function resolveVhostPath(root: string, name: string): string {
  assertValidVhostName(name);
  const normalizedRoot = resolve(root);
  const full = resolve(normalizedRoot, name);
  if (full !== normalizedRoot && !full.startsWith(normalizedRoot + "/") && !full.startsWith(normalizedRoot + "\\")) {
    throw new Error("path_traversal_rejected");
  }
  return full;
}

/**
 * Most vhosts in sites-enabled are symlinks back to sites-available (the
 * assumption enableVhost/disableVhost rely on), but some pre-date this app
 * and are independent regular files whose content has since diverged —
 * nginx always loads sites-enabled, so THAT'S the file that must be edited
 * for the change to have any real effect. Falls back to sites-available
 * when sites-enabled has no entry (vhost is currently disabled).
 */
async function resolveActiveVhostPath(name: string): Promise<string> {
  const enabledPath = resolveVhostPath(env.NGINX_SITES_ENABLED, name);
  if (existsSync(enabledPath)) {
    const stats = await lstat(enabledPath);
    if (!stats.isSymbolicLink()) return enabledPath;
  }
  return resolveVhostPath(env.NGINX_SITES_AVAILABLE, name);
}

export const NginxService = {
  async getStatus(): Promise<NginxStatus> {
    let active = false;
    try {
      const { stdout } = await runCommand("systemctl", ["is-active", "nginx"], { timeoutMs: 5000 });
      active = stdout.trim() === "active";
    } catch {
      active = false;
    }

    let version: string | null = null;
    try {
      const { stderr } = await runCommand(env.NGINX_BINARY_PATH, ["-v"], { timeoutMs: 5000 });
      const match = /nginx\/([\d.]+)/.exec(stderr);
      version = match?.[1] ?? null;
    } catch {
      version = null;
    }

    const test = await this.testConfig();

    return { active, version, configTestOk: test.ok, configTestOutput: test.output, stubStatus: null };
  },

  async listVhosts(): Promise<NginxVhostSummary[]> {
    let availableFiles: string[] = [];
    try {
      availableFiles = await readdir(env.NGINX_SITES_AVAILABLE);
    } catch {
      return [];
    }

    let enabledFiles = new Set<string>();
    try {
      enabledFiles = new Set(await readdir(env.NGINX_SITES_ENABLED));
    } catch {
      // sites-enabled may not exist on conf.d-style layouts
    }

    const results: NginxVhostSummary[] = [];
    for (const name of availableFiles) {
      if (!VHOST_NAME_RE.test(name)) continue;
      const path = resolveVhostPath(env.NGINX_SITES_AVAILABLE, name);
      const raw = await readFile(path, "utf8").catch(() => "");
      results.push(parseVhostSummary(name, raw, enabledFiles.has(name), this.isInMaintenance(name)));
    }
    return results;
  },

  async getVhostDetail(name: string): Promise<NginxVhostDetail> {
    const path = resolveVhostPath(env.NGINX_SITES_AVAILABLE, name);
    const raw = await readFile(path, "utf8");
    let enabled = false;
    try {
      enabled = (await readdir(env.NGINX_SITES_ENABLED)).includes(name);
    } catch {
      enabled = false;
    }
    const summary = parseVhostSummary(name, raw, enabled, this.isInMaintenance(name));
    return { ...summary, rawConfig: raw };
  },

  async enableVhost(name: string): Promise<void> {
    const availablePath = resolveVhostPath(env.NGINX_SITES_AVAILABLE, name);
    const enabledPath = resolveVhostPath(env.NGINX_SITES_ENABLED, name);
    if (!existsSync(availablePath)) throw new Error("vhost_not_found");

    // /etc/nginx is root-owned on Debian; the service runs as a non-root admin
    // user, so every write here goes through sudo with fixed argv commands
    // (never a shell string) rather than Node's fs API.
    if (!existsSync(enabledPath)) {
      await runCommand("sudo", ["ln", "-s", availablePath, enabledPath], { timeoutMs: 5000 });
    }

    const test = await this.testConfig();
    if (!test.ok) {
      await runCommand("sudo", ["rm", "-f", enabledPath], { timeoutMs: 5000 }).catch(() => {});
      throw new Error(`nginx_test_failed: ${test.output}`);
    }
    await this.reload();
  },

  async disableVhost(name: string): Promise<void> {
    const enabledPath = resolveVhostPath(env.NGINX_SITES_ENABLED, name);
    if (existsSync(enabledPath)) {
      const stats = await lstat(enabledPath);
      if (!stats.isSymbolicLink()) throw new Error("refusing_to_remove_non_symlink");
      await runCommand("sudo", ["rm", "-f", enabledPath], { timeoutMs: 5000 });
    }
    const test = await this.testConfig();
    if (!test.ok) throw new Error(`nginx_test_failed_after_disable: ${test.output}`);
    await this.reload();
  },

  isInMaintenance(name: string): boolean {
    const row = db.prepare("SELECT 1 FROM vhost_maintenance WHERE vhost_name = ?").get(name);
    return !!row;
  },

  /**
   * Swaps every `location` block in the vhost's HTTPS server blocks for a
   * static maintenance page, keeping `listen`/`server_name`/`ssl_*` intact so
   * the site's own certificate keeps terminating TLS. The pre-maintenance
   * snapshot id is tracked so disableMaintenance() restores exactly that,
   * not just "the most recent snapshot" (which writeVhostConfig also creates).
   *
   * Edits sites-enabled directly rather than sites-available: some vhosts
   * predate this app and have an independent (diverged) file in
   * sites-enabled instead of a symlink — nginx only ever loads that one, so
   * editing sites-available for those would silently do nothing.
   */
  async enableMaintenance(name: string): Promise<void> {
    if (this.isInMaintenance(name)) return;
    const path = await resolveActiveVhostPath(name);
    if (!existsSync(path)) throw new Error("vhost_not_found");

    await mkdir(env.NGINX_CONFIG_BACKUP_DIR, { recursive: true });
    const snapshotName = `${name}.${Date.now()}.bak`;
    const snapshotPath = join(env.NGINX_CONFIG_BACKUP_DIR, snapshotName);
    await copyFile(path, snapshotPath);
    const snapshotResult = db
      .prepare("INSERT INTO nginx_config_history (vhost_name, snapshot_path) VALUES (?, ?)")
      .run(name, snapshotPath);
    const snapshotId = Number(snapshotResult.lastInsertRowid);

    const original = await readFile(path, "utf8");
    const maintenanceConfig = applyMaintenanceMode(original, env.NGINX_MAINTENANCE_ROOT);

    await mkdir(env.NGINX_CONFIG_BACKUP_DIR, { recursive: true });
    const tmpPath = join(env.NGINX_CONFIG_BACKUP_DIR, `${name}.maintenance-${Date.now()}`);
    await writeFile(tmpPath, maintenanceConfig, "utf8");
    await runCommand("sudo", ["cp", tmpPath, path], { timeoutMs: 5000 });
    await rm(tmpPath, { force: true });

    const test = await this.testConfig();
    if (!test.ok) {
      const revertTmp = join(env.NGINX_CONFIG_BACKUP_DIR, `${name}.revert-${Date.now()}`);
      await writeFile(revertTmp, original, "utf8");
      await runCommand("sudo", ["cp", revertTmp, path], { timeoutMs: 5000 });
      await rm(revertTmp, { force: true });
      throw new Error(`nginx_test_failed: ${test.output}`);
    }

    db.prepare(
      "INSERT INTO vhost_maintenance (vhost_name, snapshot_id) VALUES (?, ?) ON CONFLICT(vhost_name) DO UPDATE SET snapshot_id = excluded.snapshot_id, enabled_at = datetime('now')"
    ).run(name, snapshotId);

    await this.reload();
  },

  async disableMaintenance(name: string): Promise<void> {
    const row = db
      .prepare("SELECT snapshot_id as snapshotId FROM vhost_maintenance WHERE vhost_name = ?")
      .get(name) as { snapshotId: number } | undefined;
    if (!row) throw new Error("vhost_not_in_maintenance");

    const snapshot = db
      .prepare("SELECT snapshot_path as snapshotPath FROM nginx_config_history WHERE id = ?")
      .get(row.snapshotId) as { snapshotPath: string } | undefined;
    if (!snapshot) throw new Error("snapshot_not_found");

    const original = await readFile(snapshot.snapshotPath, "utf8");
    const path = await resolveActiveVhostPath(name);

    const tmpPath = join(env.NGINX_CONFIG_BACKUP_DIR, `${name}.restore-${Date.now()}`);
    await writeFile(tmpPath, original, "utf8");
    await runCommand("sudo", ["cp", tmpPath, path], { timeoutMs: 5000 });
    await rm(tmpPath, { force: true });

    const test = await this.testConfig();
    if (!test.ok) throw new Error(`nginx_test_failed: ${test.output}`);

    db.prepare("DELETE FROM vhost_maintenance WHERE vhost_name = ?").run(name);
    await this.reload();
  },

  async writeVhostConfig(name: string, content: string): Promise<void> {
    const path = resolveVhostPath(env.NGINX_SITES_AVAILABLE, name);
    if (!existsSync(path)) throw new Error("vhost_not_found");

    await this.snapshotVhost(name);

    // Validate the candidate content in place before touching the real file:
    // write via a temp file the service user CAN write, then sudo-copy it over
    // the root-owned target, test, and restore from the just-made snapshot if invalid.
    const backupContent = await readFile(path, "utf8");
    const tmpPath = join(env.NGINX_CONFIG_BACKUP_DIR, `${name}.candidate-${Date.now()}`);
    await mkdir(env.NGINX_CONFIG_BACKUP_DIR, { recursive: true });
    await writeFile(tmpPath, content, "utf8");
    await runCommand("sudo", ["cp", tmpPath, path], { timeoutMs: 5000 });
    await rm(tmpPath, { force: true });

    const test = await this.testConfig();

    if (!test.ok) {
      const revertTmp = join(env.NGINX_CONFIG_BACKUP_DIR, `${name}.revert-${Date.now()}`);
      await writeFile(revertTmp, backupContent, "utf8");
      await runCommand("sudo", ["cp", revertTmp, path], { timeoutMs: 5000 });
      await rm(revertTmp, { force: true });
      throw new Error(`nginx_test_failed: ${test.output}`);
    }

    await this.reload();
  },

  async snapshotVhost(name: string): Promise<number | null> {
    const path = resolveVhostPath(env.NGINX_SITES_AVAILABLE, name);
    if (!existsSync(path)) return null;
    await mkdir(env.NGINX_CONFIG_BACKUP_DIR, { recursive: true });
    const snapshotName = `${name}.${Date.now()}.bak`;
    const snapshotPath = join(env.NGINX_CONFIG_BACKUP_DIR, snapshotName);
    await copyFile(path, snapshotPath);
    const result = db
      .prepare("INSERT INTO nginx_config_history (vhost_name, snapshot_path) VALUES (?, ?)")
      .run(name, snapshotPath);
    return Number(result.lastInsertRowid);
  },

  async listVhostHistory(name: string): Promise<NginxConfigSnapshot[]> {
    return db
      .prepare("SELECT id, vhost_name as vhostName, created_at as createdAt FROM nginx_config_history WHERE vhost_name = ? ORDER BY created_at DESC")
      .all(name) as NginxConfigSnapshot[];
  },

  async restoreSnapshot(name: string, snapshotId: number): Promise<void> {
    const row = db
      .prepare("SELECT snapshot_path FROM nginx_config_history WHERE id = ? AND vhost_name = ?")
      .get(snapshotId, name) as { snapshot_path: string } | undefined;
    if (!row) throw new Error("snapshot_not_found");
    const content = await readFile(row.snapshot_path, "utf8");
    await this.writeVhostConfig(name, content);
  },

  async testConfig(): Promise<{ ok: boolean; output: string }> {
    try {
      // sudo: nginx -t must read every cert referenced in every vhost, including
      // Let's Encrypt files that are root-only (0600), so a non-root check fails
      // with a permission error rather than a real config error.
      const { stderr } = await runCommand("sudo", [env.NGINX_BINARY_PATH, "-t"], { timeoutMs: 10000 });
      return { ok: true, output: stderr };
    } catch (err) {
      return { ok: false, output: err instanceof ExecError ? err.stderr : (err as Error).message };
    }
  },

  async reload(): Promise<void> {
    await runCommand("sudo", ["systemctl", "reload", "nginx"], { timeoutMs: 15000 });
  },

  async restart(): Promise<void> {
    await runCommand("sudo", ["systemctl", "restart", "nginx"], { timeoutMs: 20000 });
  },

  async getVhostLogs(name: string, type: "access" | "error", tail = 200): Promise<string> {
    assertValidVhostName(name);
    const path = await resolveVhostLogPath(name, type);
    if (path) {
      const { stdout } = await runCommand("tail", ["-n", String(tail), path], { timeoutMs: 5000 });
      return stdout;
    }
    // Fall back to grep-filtering the shared nginx log by server_name if no
    // per-vhost log file is configured under any known naming convention.
    const sharedPath = join(env.NGINX_LOG_DIR, `${type}.log`);
    if (!existsSync(sharedPath)) return "";
    const { stdout } = await runCommand("grep", [name, sharedPath], { timeoutMs: 5000 }).catch(() => ({
      stdout: "",
    }));
    return stdout.split("\n").slice(-tail).join("\n");
  },

  async getCertStatus(name: string): Promise<NginxCertStatus> {
    const detail = await this.getVhostDetail(name);
    const primaryDomain = detail.serverNames[0];
    const empty: NginxCertStatus = { found: false, issuer: null, subject: null, notAfter: null, daysRemaining: null, source: "none" };
    if (!primaryDomain) return empty;

    // Prefer whatever cert the vhost's own `ssl_certificate` directive points
    // to (Cloudflare Origin certs, manually-issued certs, etc.) — falling back
    // to the Certbot convention path only if the vhost doesn't declare one
    // directly. Reading these files (often root-only, e.g. /etc/ssl/private)
    // requires the same sudo elevation as `nginx -t`.
    const declaredMatch = /^\s*ssl_certificate\s+([^;]+);/m.exec(detail.rawConfig);
    const declaredPath = declaredMatch ? declaredMatch[1].trim() : null;
    const certbotPath = join(env.CERTBOT_LIVE_DIR, primaryDomain, "cert.pem");
    const source: NginxCertStatus["source"] = declaredPath ? "manual" : "certbot";
    const certPath = declaredPath ?? certbotPath;

    try {
      const { stdout } = await runCommand(
        "sudo",
        ["openssl", "x509", "-in", certPath, "-noout", "-enddate", "-issuer", "-subject"],
        { timeoutMs: 5000 }
      );
      const notAfterMatch = /notAfter=(.+)/.exec(stdout);
      const issuerMatch = /issuer=(.+)/.exec(stdout);
      const subjectMatch = /subject=(.+)/.exec(stdout);
      const notAfter = notAfterMatch ? new Date(notAfterMatch[1]).toISOString() : null;
      const daysRemaining = notAfter
        ? Math.round((new Date(notAfter).getTime() - Date.now()) / 86_400_000)
        : null;
      return {
        found: true,
        issuer: issuerMatch?.[1] ?? null,
        subject: subjectMatch?.[1] ?? null,
        notAfter,
        daysRemaining,
        source: source === "manual" && issuerMatch?.[1]?.includes("Let's Encrypt") ? "certbot" : source,
      };
    } catch {
      // If the declared path failed (e.g. relative/unusual path resolution),
      // still try the Certbot convention path as a last resort.
      if (declaredPath) {
        try {
          const { stdout } = await runCommand(
            "sudo",
            ["openssl", "x509", "-in", certbotPath, "-noout", "-enddate", "-issuer", "-subject"],
            { timeoutMs: 5000 }
          );
          const notAfterMatch = /notAfter=(.+)/.exec(stdout);
          const issuerMatch = /issuer=(.+)/.exec(stdout);
          const subjectMatch = /subject=(.+)/.exec(stdout);
          const notAfter = notAfterMatch ? new Date(notAfterMatch[1]).toISOString() : null;
          const daysRemaining = notAfter
            ? Math.round((new Date(notAfter).getTime() - Date.now()) / 86_400_000)
            : null;
          return {
            found: true,
            issuer: issuerMatch?.[1] ?? null,
            subject: subjectMatch?.[1] ?? null,
            notAfter,
            daysRemaining,
            source: "certbot",
          };
        } catch {
          return empty;
        }
      }
      return empty;
    }
  },

  /**
   * Tests real HTTP reachability of a vhost by requesting its primary
   * server_name on the port it listens on (443 if any listen directive
   * references TLS/443, else the first configured port). Self-signed/expired
   * certs are accepted here — this checks "does the site respond", not cert
   * trust (cert validity is reported separately by getCertStatus).
   */
  async checkAccessibility(name: string): Promise<NginxVhostAccessibility> {
    const detail = await this.getVhostDetail(name);
    const host = detail.serverNames[0];
    const checkedAt = new Date().toISOString();
    if (!host) {
      return { checkedUrl: null, reachable: false, statusCode: null, latencyMs: null, error: "no_server_name", checkedAt };
    }

    const usesTls = /listen\s+[^;]*(443|ssl)/i.test(detail.rawConfig);
    const port = usesTls ? 443 : detail.listenPorts[0] ?? 80;
    const scheme = usesTls ? "https" : "http";
    const showPort = (usesTls && port !== 443) || (!usesTls && port !== 80);
    const url = `${scheme}://${host}${showPort ? `:${port}` : ""}/`;

    const started = Date.now();
    try {
      // Self-signed/expired certs are accepted (mirrors `curl -k`) since this
      // checks "does the site respond", not cert trust — getCertStatus covers that.
      const statusCode = await new Promise<number>((res, reject) => {
        const transport = usesTls ? httpsRequest : httpRequest;
        const req = transport(
          { hostname: host, port, path: "/", method: "GET", timeout: 8000, rejectUnauthorized: false },
          (response) => {
            response.resume();
            res(response.statusCode ?? 0);
          }
        );
        req.on("timeout", () => req.destroy(new Error("timeout")));
        req.on("error", reject);
        req.end();
      });
      return {
        checkedUrl: url,
        reachable: true,
        statusCode,
        latencyMs: Date.now() - started,
        error: null,
        checkedAt,
      };
    } catch (err) {
      return {
        checkedUrl: url,
        reachable: false,
        statusCode: null,
        latencyMs: Date.now() - started,
        error: (err as Error).message,
        checkedAt,
      };
    }
  },

  async getVhostErrors(name: string, windowHours = 24, limit = 50): Promise<NginxVhostErrorSummary> {
    assertValidVhostName(name);
    const path = await resolveVhostLogPath(name, "error");
    const sharedFallback = join(env.NGINX_LOG_DIR, "error.log");
    const targetPath = path ?? (existsSync(sharedFallback) ? sharedFallback : null);
    if (!targetPath) return { recentCount: 0, windowHours, entries: [] };

    const cutoff = Date.now() - windowHours * 3_600_000;
    const entries: { raw: string; timestamp: string | null; ts: number }[] = [];

    const rl = createInterface({ input: createReadStream(targetPath), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!path && !line.includes(name)) continue; // shared log: filter by vhost name
      const match = /^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2})/.exec(line);
      const ts = match ? new Date(match[1].replace("/", "-").replace("/", "-")).getTime() : Date.now();
      if (ts < cutoff) continue;
      entries.push({ raw: line, timestamp: match ? new Date(ts).toISOString() : null, ts });
    }
    rl.close();

    entries.sort((a, b) => b.ts - a.ts);
    const recent = entries.slice(0, limit);
    return {
      recentCount: entries.length,
      windowHours,
      entries: recent.map(({ raw, timestamp }) => ({ raw, timestamp })),
    };
  },

  /**
   * Backs up the whole Nginx config tree (sites-available + nginx.conf, if
   * present) as a single tarball, stored locally and optionally uploaded to
   * Drive — mirrors the pattern used by BackupService for volumes/paths.
   */
  async backupConfig(targets: ("local" | "gdrive")[]): Promise<NginxConfigBackupRun> {
    const runId = `nginx-cfg-${Date.now()}`;
    const startedAt = new Date().toISOString();
    const destDir = join(env.BACKUP_LOCAL_ROOT, "nginx-config");
    await mkdir(destDir, { recursive: true });
    const archivePath = join(destDir, `${runId}.tar.gz`);

    try {
      const sitesAvailableDir = resolve(env.NGINX_SITES_AVAILABLE);
      const parentDir = resolve(sitesAvailableDir, "..");
      const nginxConfPath = join(parentDir, "nginx.conf");
      const tarArgs = ["tar", "czf", archivePath, "-C", parentDir, basename(sitesAvailableDir)];
      if (existsSync(nginxConfPath)) tarArgs.push("nginx.conf");

      await runCommand("sudo", tarArgs, { timeoutMs: 60_000 });
      await runCommand("sudo", ["chown", process.env.USER ?? "shan", archivePath], { timeoutMs: 5000 }).catch(() => {});

      const stats = await stat(archivePath);

      let driveFileId: string | null = null;
      if (targets.includes("gdrive") && GDriveService.isEnabled()) {
        const uploaded = await GDriveService.uploadBackupFile(archivePath, "paths", "nginx-config");
        driveFileId = uploaded.fileId;
      }

      if (!targets.includes("local")) {
        await rm(archivePath, { force: true });
      }

      return {
        runId,
        status: "success",
        sizeBytes: stats.size,
        driveFileId,
        error: null,
        startedAt,
        finishedAt: new Date().toISOString(),
      };
    } catch (err) {
      await rm(archivePath, { force: true }).catch(() => {});
      return {
        runId,
        status: "failed",
        sizeBytes: null,
        driveFileId: null,
        error: (err as Error).message,
        startedAt,
        finishedAt: new Date().toISOString(),
      };
    }
  },
};
