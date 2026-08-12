import { readdir, readFile, writeFile, mkdir, copyFile, lstat, rm, stat } from "node:fs/promises";
import { existsSync, createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { join, resolve, basename, sep } from "node:path";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { db } from "../../db/index.js";
import { env } from "../../config/env.js";
import { runCommand, ExecError } from "../../utils/exec.js";
import { GDriveService } from "../../services/gdrive.client.js";
import { docker } from "../../services/docker.client.js";
import { parseVhostSummary, applyMaintenanceMode, applyFailoverRewrite } from "./apache.parser.js";
import { parseGuidedFields, applyGuidedFields, buildInitialVhostConfig, GUIDED_FIELD_MODULES } from "./apache.guidedEditor.js";
import type { WebServerService } from "../webserver/webserver.types.js";
import type {
  WebServerStatus,
  VhostSummary,
  VhostDetail,
  ConfigSnapshot,
  CertStatus,
  VhostAccessibility,
  VhostErrorSummary,
  ConfigBackupRun,
  GuidedFormModel,
} from "@pwa-admin/shared";

// Apache requires a .conf suffix in sites-available for a2ensite/apache2ctl
// to recognize the file (Debian's apache2ctl explicitly globs *.conf under
// sites-available for `configtest`/IncludeOptional) — nginx has no such
// requirement. This module always stores/reads vhosts WITH the suffix on
// disk, but strips it for the `name` field shown to the admin, so vhost
// "names" stay visually consistent with nginx's (no ".conf" suffix visible
// anywhere in the UI).
const VHOST_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

function assertValidVhostName(name: string): void {
  if (!VHOST_NAME_RE.test(name) || name.length > 200) {
    throw new Error("invalid_vhost_name");
  }
}

// If the admin explicitly types a name already ending in ".conf" in the
// guided editor's "nom du fichier" field, confFileName/stripConfSuffix
// still round-trip it to the same on-disk file — just displayed without the
// suffix afterward (same as any other name), never a path-confusion bug:
// both functions agree on the same file, only the display identity folds
// the (harmless, redundant) ".conf" the admin typed away.
function confFileName(name: string): string {
  return name.endsWith(".conf") ? name : `${name}.conf`;
}

function stripConfSuffix(fileName: string): string {
  return fileName.endsWith(".conf") ? fileName.slice(0, -".conf".length) : fileName;
}

/**
 * Different Apache setups name per-vhost logs differently (Debian's default
 * vhost template uses `${APACHE_LOG_DIR}/<name>-access.log` /
 * `<name>-error.log`, but hand-written vhosts vary) — try the known
 * conventions before falling back to the shared log with grep filtering.
 * Direct Apache counterpart of nginx.service.ts's resolveVhostLogPath.
 */
export async function resolveVhostLogPath(name: string, type: "access" | "error"): Promise<string | null> {
  const candidates = [
    join(env.APACHE_LOG_DIR, `${name}-${type}.log`),
    join(env.APACHE_LOG_DIR, `${name}_${type}.log`),
    join(env.APACHE_LOG_DIR, `${name}.${type}.log`),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function resolveVhostPath(root: string, name: string): string {
  assertValidVhostName(name);
  const fileName = confFileName(name);
  const normalizedRoot = resolve(root);
  const full = resolve(normalizedRoot, fileName);
  if (full !== normalizedRoot && !full.startsWith(normalizedRoot + "/") && !full.startsWith(normalizedRoot + "\\")) {
    throw new Error("path_traversal_rejected");
  }
  return full;
}

/**
 * Same "sites-enabled may have independently diverged from sites-available"
 * defensive lookup nginx.service.ts's resolveActiveVhostPath does — a2ensite
 * normally symlinks, but a pre-existing hand-managed install could have an
 * independent file there instead, and Apache always loads whatever's
 * physically in sites-enabled.
 */
async function resolveActiveVhostPath(name: string): Promise<string> {
  const enabledPath = resolveVhostPath(env.APACHE_SITES_ENABLED, name);
  if (existsSync(enabledPath)) {
    const stats = await lstat(enabledPath);
    if (!stats.isSymbolicLink()) return enabledPath;
  }
  return resolveVhostPath(env.APACHE_SITES_AVAILABLE, name);
}

function rewriteProxyPassPort(proxyPassTarget: string, newPort: number): string {
  return proxyPassTarget.replace(/:(\d+)(\/|$)/, `:${newPort}$2`);
}

/**
 * Checks `apache2ctl -M` for a module's presence and runs `a2enmod <name>`
 * if it's missing, before writing a directive that depends on it (mod_ssl,
 * mod_headers, mod_deflate, mod_expires — see GUIDED_FIELD_MODULES). Mirrors
 * this app's existing "handle the sysadmin chore for the admin" philosophy
 * (auto snapshot-before-write, auto test-before-reload) rather than refusing
 * with an error the admin would have to SSH in to fix manually — a guided
 * editor that requires manual `a2enmod` defeats the point of being guided.
 * The sudoers rule for a2enmod is scoped to exactly the module names this
 * function ever passes (ssl/headers/deflate/expires), never a wildcard.
 */
async function ensureModuleEnabled(moduleName: string): Promise<void> {
  const { stdout } = await runCommand(env.APACHE_CTL_PATH, ["-M"], { timeoutMs: 5000 }).catch(() => ({ stdout: "" }));
  const enabled = new RegExp(`\\b${moduleName}_module\\b`, "i").test(stdout);
  if (enabled) return;
  await runCommand("sudo", ["a2enmod", moduleName], { timeoutMs: 10_000 });
}

/** Scans a GuidedFormModel for which modules it actually needs given what's
 * toggled on, and ensures each is enabled — called once before
 * applyGuidedFields/buildInitialVhostConfig write anything. */
async function ensureModulesForModel(model: GuidedFormModel): Promise<void> {
  const needed = new Set<string>();
  if (model.sslEnabled) needed.add(GUIDED_FIELD_MODULES.ssl);
  if (Object.values(model.headers).some(Boolean)) needed.add(GUIDED_FIELD_MODULES.headers);
  if (model.gzip.enabled) needed.add(GUIDED_FIELD_MODULES.gzip);
  if (model.locations.cacheStaticAssets) {
    needed.add(GUIDED_FIELD_MODULES.cacheStaticAssets);
    needed.add(GUIDED_FIELD_MODULES.headers);
  }
  for (const moduleName of needed) {
    await ensureModuleEnabled(moduleName);
  }
}

export const ApacheService: WebServerService = {
  engine: "apache",
  logDir: env.APACHE_LOG_DIR,

  async getStatus(): Promise<WebServerStatus> {
    let active = false;
    try {
      const { stdout } = await runCommand("systemctl", ["is-active", "apache2"], { timeoutMs: 5000 });
      active = stdout.trim() === "active";
    } catch {
      active = false;
    }

    let version: string | null = null;
    try {
      const { stdout } = await runCommand(env.APACHE_BINARY_PATH, ["-v"], { timeoutMs: 5000 });
      const match = /Apache\/([\d.]+)/.exec(stdout);
      version = match?.[1] ?? null;
    } catch {
      version = null;
    }

    const test = await this.testConfig();

    return { engine: "apache", active, version, configTestOk: test.ok, configTestOutput: test.output, stubStatus: null };
  },

  async listVhosts(): Promise<VhostSummary[]> {
    let availableFiles: string[] = [];
    try {
      availableFiles = (await readdir(env.APACHE_SITES_AVAILABLE)).filter((f) => f.endsWith(".conf"));
    } catch {
      return [];
    }

    let enabledFiles = new Set<string>();
    try {
      enabledFiles = new Set((await readdir(env.APACHE_SITES_ENABLED)).filter((f) => f.endsWith(".conf")));
    } catch {
      // sites-enabled may not exist on unusual installs
    }

    const results: VhostSummary[] = [];
    for (const fileName of availableFiles) {
      const name = stripConfSuffix(fileName);
      if (!VHOST_NAME_RE.test(name)) continue;
      const path = resolveVhostPath(env.APACHE_SITES_AVAILABLE, name);
      const raw = await readFile(path, "utf8").catch(() => "");
      results.push(parseVhostSummary(name, raw, enabledFiles.has(fileName), this.isInMaintenance(name)));
    }
    return results;
  },

  async getVhostDetail(name: string): Promise<VhostDetail> {
    const path = resolveVhostPath(env.APACHE_SITES_AVAILABLE, name);
    const raw = await readFile(path, "utf8");
    let enabled = false;
    try {
      enabled = (await readdir(env.APACHE_SITES_ENABLED)).includes(confFileName(name));
    } catch {
      enabled = false;
    }
    const summary = parseVhostSummary(name, raw, enabled, this.isInMaintenance(name));
    return { ...summary, rawConfig: raw };
  },

  async enableVhost(name: string): Promise<void> {
    const availablePath = resolveVhostPath(env.APACHE_SITES_AVAILABLE, name);
    if (!existsSync(availablePath)) throw new Error("vhost_not_found");

    // a2ensite itself validates the .conf naming convention and creates the
    // sites-enabled symlink — not hand-rolled `ln -s` (see this module's own
    // top-of-file doc comment for why).
    await runCommand("sudo", ["a2ensite", confFileName(name)], { timeoutMs: 5000 });

    const test = await this.testConfig();
    if (!test.ok) {
      await runCommand("sudo", ["a2dissite", confFileName(name)], { timeoutMs: 5000 }).catch(() => {});
      throw new Error(`apache_test_failed: ${test.output}`);
    }
    await this.reload();
  },

  async disableVhost(name: string): Promise<void> {
    assertValidVhostName(name);
    await runCommand("sudo", ["a2dissite", confFileName(name)], { timeoutMs: 5000 }).catch(() => {});
    const test = await this.testConfig();
    if (!test.ok) throw new Error(`apache_test_failed_after_disable: ${test.output}`);
    await this.reload();
  },

  isInMaintenance(name: string): boolean {
    const row = db.prepare("SELECT 1 FROM vhost_maintenance WHERE vhost_name = ?").get(name);
    return !!row;
  },

  /**
   * Swaps the vhost's DocumentRoot (or comments out ProxyPass/
   * ProxyPassReverse and injects a fallback DocumentRoot) for the
   * maintenance page — see apache.parser.ts's applyMaintenanceMode for the
   * full mechanics and the auth-shadow edge case it handles. Structurally
   * identical snapshot/write/test/revert sequence to
   * NginxService.enableMaintenance, sharing the SAME nginx_config_history/
   * vhost_maintenance tables (both are already engine-agnostic in content —
   * vhost_name + snapshot_path — see the Apache-parity implementation plan
   * for why no table rename was done).
   */
  async enableMaintenance(name: string): Promise<void> {
    if (this.isInMaintenance(name)) return;
    if (this.isSwitchedToDuplicate(name)) throw new Error("vhost_switched_to_duplicate");
    const path = await resolveActiveVhostPath(name);
    if (!existsSync(path)) throw new Error("vhost_not_found");

    await mkdir(env.APACHE_CONFIG_BACKUP_DIR, { recursive: true });
    const snapshotName = `${name}.${Date.now()}.bak`;
    const snapshotPath = join(env.APACHE_CONFIG_BACKUP_DIR, snapshotName);
    await copyFile(path, snapshotPath);
    const snapshotResult = db
      .prepare("INSERT INTO nginx_config_history (vhost_name, snapshot_path) VALUES (?, ?)")
      .run(name, snapshotPath);
    const snapshotId = Number(snapshotResult.lastInsertRowid);

    const original = await readFile(path, "utf8");
    const maintenanceConfig = applyMaintenanceMode(original, env.APACHE_MAINTENANCE_ROOT);

    const tmpPath = join(env.APACHE_CONFIG_BACKUP_DIR, `${name}.maintenance-${Date.now()}`);
    await writeFile(tmpPath, maintenanceConfig, "utf8");
    await runCommand("sudo", ["cp", tmpPath, path], { timeoutMs: 5000 });
    await rm(tmpPath, { force: true });

    const test = await this.testConfig();
    if (!test.ok) {
      const revertTmp = join(env.APACHE_CONFIG_BACKUP_DIR, `${name}.revert-${Date.now()}`);
      await writeFile(revertTmp, original, "utf8");
      await runCommand("sudo", ["cp", revertTmp, path], { timeoutMs: 5000 });
      await rm(revertTmp, { force: true });
      throw new Error(`apache_test_failed: ${test.output}`);
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

    const tmpPath = join(env.APACHE_CONFIG_BACKUP_DIR, `${name}.restore-${Date.now()}`);
    await writeFile(tmpPath, original, "utf8");
    await runCommand("sudo", ["cp", tmpPath, path], { timeoutMs: 5000 });
    await rm(tmpPath, { force: true });

    const test = await this.testConfig();
    if (!test.ok) throw new Error(`apache_test_failed: ${test.output}`);

    db.prepare("DELETE FROM vhost_maintenance WHERE vhost_name = ?").run(name);
    await this.reload();
  },

  isSwitchedToDuplicate(name: string): boolean {
    const row = db.prepare("SELECT 1 FROM vhost_failover WHERE vhost_name = ?").get(name);
    return !!row;
  },

  async switchToDuplicate(name: string): Promise<void> {
    if (this.isSwitchedToDuplicate(name)) return;
    if (this.isInMaintenance(name)) throw new Error("vhost_in_maintenance");

    const duplicateRow = db
      .prepare(
        "SELECT content_path as contentPath, duplicate_port as duplicatePort, duplicate_container_id as duplicateContainerId, status FROM site_duplicates WHERE vhost_name = ?"
      )
      .get(name) as
      | { contentPath: string | null; duplicatePort: number | null; duplicateContainerId: string | null; status: string }
      | undefined;
    if (!duplicateRow) throw new Error("no_duplicate_found");
    if (duplicateRow.status !== "ready") throw new Error("duplicate_not_ready");

    if (duplicateRow.duplicateContainerId) {
      try {
        const container = docker.getContainer(duplicateRow.duplicateContainerId);
        const info = await container.inspect();
        if (!info.State.Running) await container.start();
      } catch (err) {
        throw new Error(`duplicate_container_unavailable: ${(err as Error).message}`);
      }
    }

    const path = await resolveActiveVhostPath(name);
    if (!existsSync(path)) throw new Error("vhost_not_found");

    const original = await readFile(path, "utf8");
    const vhost = parseVhostSummary(name, original, true);

    await mkdir(env.APACHE_CONFIG_BACKUP_DIR, { recursive: true });
    const snapshotName = `${name}.${Date.now()}.bak`;
    const snapshotPath = join(env.APACHE_CONFIG_BACKUP_DIR, snapshotName);
    await copyFile(path, snapshotPath);
    const snapshotResult = db
      .prepare("INSERT INTO nginx_config_history (vhost_name, snapshot_path) VALUES (?, ?)")
      .run(name, snapshotPath);
    const snapshotId = Number(snapshotResult.lastInsertRowid);

    const newProxyPass =
      vhost.proxyPassTarget && duplicateRow.duplicatePort != null
        ? rewriteProxyPassPort(vhost.proxyPassTarget, duplicateRow.duplicatePort)
        : undefined;
    const rewritten = applyFailoverRewrite(original, {
      newRoot: vhost.root && duplicateRow.contentPath ? duplicateRow.contentPath : undefined,
      newProxyPass,
    });

    const tmpPath = join(env.APACHE_CONFIG_BACKUP_DIR, `${name}.failover-${Date.now()}`);
    await writeFile(tmpPath, rewritten, "utf8");
    await runCommand("sudo", ["cp", tmpPath, path], { timeoutMs: 5000 });
    await rm(tmpPath, { force: true });

    const test = await this.testConfig();
    if (!test.ok) {
      const revertTmp = join(env.APACHE_CONFIG_BACKUP_DIR, `${name}.revert-${Date.now()}`);
      await writeFile(revertTmp, original, "utf8");
      await runCommand("sudo", ["cp", revertTmp, path], { timeoutMs: 5000 });
      await rm(revertTmp, { force: true });
      throw new Error(`apache_test_failed: ${test.output}`);
    }

    db.prepare(
      "INSERT INTO vhost_failover (vhost_name, snapshot_id) VALUES (?, ?) ON CONFLICT(vhost_name) DO UPDATE SET snapshot_id = excluded.snapshot_id, switched_at = datetime('now')"
    ).run(name, snapshotId);

    await this.reload();
  },

  async switchToPrimary(name: string): Promise<void> {
    const row = db
      .prepare("SELECT snapshot_id as snapshotId FROM vhost_failover WHERE vhost_name = ?")
      .get(name) as { snapshotId: number } | undefined;
    if (!row) throw new Error("vhost_not_switched_to_duplicate");

    const snapshot = db
      .prepare("SELECT snapshot_path as snapshotPath FROM nginx_config_history WHERE id = ?")
      .get(row.snapshotId) as { snapshotPath: string } | undefined;
    if (!snapshot) throw new Error("snapshot_not_found");

    const original = await readFile(snapshot.snapshotPath, "utf8");
    const path = await resolveActiveVhostPath(name);

    const tmpPath = join(env.APACHE_CONFIG_BACKUP_DIR, `${name}.restore-${Date.now()}`);
    await writeFile(tmpPath, original, "utf8");
    await runCommand("sudo", ["cp", tmpPath, path], { timeoutMs: 5000 });
    await rm(tmpPath, { force: true });

    const test = await this.testConfig();
    if (!test.ok) throw new Error(`apache_test_failed: ${test.output}`);

    db.prepare("DELETE FROM vhost_failover WHERE vhost_name = ?").run(name);
    await this.reload();
  },

  async writeVhostConfig(name: string, content: string): Promise<void> {
    const path = resolveVhostPath(env.APACHE_SITES_AVAILABLE, name);
    if (!existsSync(path)) throw new Error("vhost_not_found");

    await this.snapshotVhost(name);

    const backupContent = await readFile(path, "utf8");
    const tmpPath = join(env.APACHE_CONFIG_BACKUP_DIR, `${name}.candidate-${Date.now()}`);
    await mkdir(env.APACHE_CONFIG_BACKUP_DIR, { recursive: true });
    await writeFile(tmpPath, content, "utf8");
    await runCommand("sudo", ["cp", tmpPath, path], { timeoutMs: 5000 });
    await rm(tmpPath, { force: true });

    const test = await this.testConfig();

    if (!test.ok) {
      const revertTmp = join(env.APACHE_CONFIG_BACKUP_DIR, `${name}.revert-${Date.now()}`);
      await writeFile(revertTmp, backupContent, "utf8");
      await runCommand("sudo", ["cp", revertTmp, path], { timeoutMs: 5000 });
      await rm(revertTmp, { force: true });
      throw new Error(`apache_test_failed: ${test.output}`);
    }

    await this.reload();
  },

  async createVhost(name: string, content: string): Promise<void> {
    const path = resolveVhostPath(env.APACHE_SITES_AVAILABLE, name);
    if (existsSync(path)) throw new Error("vhost_already_exists");

    await mkdir(env.APACHE_CONFIG_BACKUP_DIR, { recursive: true });
    const tmpPath = join(env.APACHE_CONFIG_BACKUP_DIR, `${name}.candidate-${Date.now()}`);
    await writeFile(tmpPath, content, "utf8");
    await runCommand("sudo", ["cp", tmpPath, path], { timeoutMs: 5000 });
    await rm(tmpPath, { force: true });

    const test = await this.testConfig();
    if (!test.ok) {
      await runCommand("sudo", ["rm", "-f", path], { timeoutMs: 5000 }).catch(() => {});
      throw new Error(`apache_test_failed: ${test.output}`);
    }
    // Not enabled (no a2ensite run yet) — Apache never loads this file yet,
    // so no reload is needed here; enableVhost triggers one later.
  },

  async snapshotVhost(name: string): Promise<number | null> {
    const path = resolveVhostPath(env.APACHE_SITES_AVAILABLE, name);
    if (!existsSync(path)) return null;
    await mkdir(env.APACHE_CONFIG_BACKUP_DIR, { recursive: true });
    const snapshotName = `${name}.${Date.now()}.bak`;
    const snapshotPath = join(env.APACHE_CONFIG_BACKUP_DIR, snapshotName);
    await copyFile(path, snapshotPath);
    const result = db
      .prepare("INSERT INTO nginx_config_history (vhost_name, snapshot_path) VALUES (?, ?)")
      .run(name, snapshotPath);
    return Number(result.lastInsertRowid);
  },

  async listVhostHistory(name: string): Promise<ConfigSnapshot[]> {
    return db
      .prepare("SELECT id, vhost_name as vhostName, created_at as createdAt FROM nginx_config_history WHERE vhost_name = ? ORDER BY created_at DESC")
      .all(name) as ConfigSnapshot[];
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
      // sudo: apache2ctl configtest must read every cert referenced in every
      // vhost, including root-only Let's Encrypt files, same reasoning as
      // nginx -t.
      const { stdout, stderr } = await runCommand("sudo", [env.APACHE_CTL_PATH, "configtest"], { timeoutMs: 10000 });
      const output = `${stdout}${stderr}`;
      // apache2ctl configtest prints "Syntax OK" (unlike nginx, which only
      // ever prints to stderr) — check for that marker rather than relying
      // on exit code alone, matching the Apache-parity plan's own note on
      // this engine's differing output convention.
      return { ok: /Syntax OK/i.test(output), output };
    } catch (err) {
      const output = err instanceof ExecError ? `${err.stdout}${err.stderr}` : (err as Error).message;
      return { ok: /Syntax OK/i.test(output), output };
    }
  },

  async reload(): Promise<void> {
    await runCommand("sudo", ["systemctl", "reload", "apache2"], { timeoutMs: 15000 });
  },

  async restart(): Promise<void> {
    await runCommand("sudo", ["systemctl", "restart", "apache2"], { timeoutMs: 20000 });
  },

  async getVhostLogs(name: string, type: "access" | "error", tail = 200): Promise<string> {
    assertValidVhostName(name);
    const path = await resolveVhostLogPath(name, type);
    if (path) {
      const { stdout } = await runCommand("tail", ["-n", String(tail), path], { timeoutMs: 5000 });
      return stdout;
    }
    const sharedPath = join(env.APACHE_LOG_DIR, `${type}.log`);
    if (!existsSync(sharedPath)) return "";
    const { stdout } = await runCommand("grep", [name, sharedPath], { timeoutMs: 5000 }).catch(() => ({
      stdout: "",
    }));
    return stdout.split("\n").slice(-tail).join("\n");
  },

  async getCertStatus(name: string): Promise<CertStatus> {
    const detail = await this.getVhostDetail(name);
    const primaryDomain = detail.serverNames[0];
    const empty: CertStatus = { found: false, issuer: null, subject: null, notAfter: null, daysRemaining: null, source: "none" };
    if (!primaryDomain) return empty;

    const declaredMatch = /^\s*SSLCertificateFile\s+"?([^"#\r\n]+)"?/im.exec(detail.rawConfig);
    const declaredPath = declaredMatch ? declaredMatch[1].trim() : null;
    const certbotPath = join(env.CERTBOT_LIVE_DIR, primaryDomain, "cert.pem");
    const source: CertStatus["source"] = declaredPath ? "manual" : "certbot";
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

  async checkAccessibility(name: string): Promise<VhostAccessibility> {
    const detail = await this.getVhostDetail(name);
    const host = detail.serverNames[0];
    const checkedAt = new Date().toISOString();
    if (!host) {
      return { checkedUrl: null, reachable: false, statusCode: null, latencyMs: null, error: "no_server_name", checkedAt };
    }

    const usesTls = detail.listenPorts.includes(443) || /^\s*SSLEngine\s+on/im.test(detail.rawConfig);
    const port = usesTls ? 443 : detail.listenPorts[0] ?? 80;
    const scheme = usesTls ? "https" : "http";
    const showPort = (usesTls && port !== 443) || (!usesTls && port !== 80);
    const url = `${scheme}://${host}${showPort ? `:${port}` : ""}/`;

    const started = Date.now();
    try {
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

  async getVhostErrors(name: string, windowHours = 24, limit = 50): Promise<VhostErrorSummary> {
    assertValidVhostName(name);
    const path = await resolveVhostLogPath(name, "error");
    const sharedFallback = join(env.APACHE_LOG_DIR, "error.log");
    const targetPath = path ?? (existsSync(sharedFallback) ? sharedFallback : null);
    if (!targetPath) return { recentCount: 0, windowHours, entries: [] };

    const cutoff = Date.now() - windowHours * 3_600_000;
    const entries: { raw: string; timestamp: string | null; ts: number }[] = [];

    // Apache's error log timestamp format ([Sat Aug 10 14:22:01.123456 2026])
    // differs entirely from nginx's (2026/08/10 14:22:01) — a dedicated
    // regex/Date parse, not shared with nginx.service.ts's version.
    const rl = createInterface({ input: createReadStream(targetPath), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!path && !line.includes(name)) continue; // shared log: filter by vhost name
      const match = /^\[(\w+ \w+ \d{1,2} \d{2}:\d{2}:\d{2})(?:\.\d+)? (\d{4})\]/.exec(line);
      const ts = match ? new Date(`${match[1]} ${match[2]}`).getTime() : Date.now();
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

  async backupConfig(targets: ("local" | "gdrive")[]): Promise<ConfigBackupRun> {
    const runId = `apache-cfg-${Date.now()}`;
    const startedAt = new Date().toISOString();
    const destDir = join(env.BACKUP_LOCAL_ROOT, "apache-config");
    await mkdir(destDir, { recursive: true });
    const archivePath = join(destDir, `${runId}.tar.gz`);

    try {
      const sitesAvailableDir = resolve(env.APACHE_SITES_AVAILABLE);
      const parentDir = resolve(sitesAvailableDir, "..");
      const apacheConfPath = join(parentDir, "apache2.conf");
      const tarArgs = ["tar", "czf", archivePath, "-C", parentDir, basename(sitesAvailableDir)];
      if (existsSync(apacheConfPath)) tarArgs.push("apache2.conf");

      await runCommand("sudo", tarArgs, { timeoutMs: 60_000 });
      await runCommand("sudo", ["chown", env.SERVICE_USER, archivePath], { timeoutMs: 5000 }).catch(() => {});

      const stats = await stat(archivePath);

      let driveFileId: string | null = null;
      if (targets.includes("gdrive") && GDriveService.isEnabled()) {
        const uploaded = await GDriveService.uploadBackupFile(archivePath, "paths", "apache-config");
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

  async restoreConfig(archivePath: string): Promise<void> {
    const sitesAvailableDir = resolve(env.APACHE_SITES_AVAILABLE);
    const parentDir = resolve(sitesAvailableDir, "..");

    const stagingDir = join(env.BACKUP_LOCAL_ROOT, "apache-config");
    await mkdir(stagingDir, { recursive: true });
    const revertArchive = join(stagingDir, `pre-restore-${Date.now()}.tar.gz`);
    await runCommand("sudo", ["tar", "czf", revertArchive, "-C", parentDir, basename(sitesAvailableDir)], {
      timeoutMs: 60_000,
    });

    await runCommand("sudo", ["tar", "xzf", archivePath, "-C", parentDir], { timeoutMs: 60_000 });

    const test = await this.testConfig();
    if (!test.ok) {
      await runCommand("sudo", ["tar", "xzf", revertArchive, "-C", parentDir], { timeoutMs: 60_000 }).catch(() => {});
      await rm(revertArchive, { force: true }).catch(() => {});
      throw new Error(`apache_test_failed: ${test.output}`);
    }

    await rm(revertArchive, { force: true }).catch(() => {});
    await this.reload();
  },

  async resolveCertPaths(name: string): Promise<{ domain: string; source: "certbot" | "manual"; paths: string[] } | null> {
    const detail = await this.getVhostDetail(name);
    const primaryDomain = detail.serverNames[0];
    if (!primaryDomain) return null;

    const certMatch = /^\s*SSLCertificateFile\s+"?([^"#\r\n]+)"?/im.exec(detail.rawConfig);
    const keyMatch = /^\s*SSLCertificateKeyFile\s+"?([^"#\r\n]+)"?/im.exec(detail.rawConfig);
    const declaredCert = certMatch ? certMatch[1].trim() : null;
    const declaredKey = keyMatch ? keyMatch[1].trim() : null;

    const certbotLiveDir = join(env.CERTBOT_LIVE_DIR, primaryDomain);
    const certbotArchiveDir = join(resolve(env.CERTBOT_LIVE_DIR, ".."), "archive", primaryDomain);
    const isCertbotPath = (p: string | null) => p != null && p.startsWith(env.CERTBOT_LIVE_DIR);

    const certFileExists = async (certPath: string) =>
      runCommand("sudo", ["openssl", "x509", "-in", certPath, "-noout", "-enddate", "-issuer", "-subject"], {
        timeoutMs: 5000,
      }).then(
        () => true,
        () => false
      );

    if (!declaredCert || isCertbotPath(declaredCert)) {
      const certbotCertFile = join(certbotLiveDir, "cert.pem");
      if (!(await certFileExists(certbotCertFile))) return null;
      return { domain: primaryDomain, source: "certbot", paths: [certbotLiveDir, certbotArchiveDir] };
    }
    if (!(await certFileExists(declaredCert))) return null;
    const manualPaths = [declaredCert, declaredKey].filter((p): p is string => !!p);
    return { domain: primaryDomain, source: "manual", paths: manualPaths };
  },

  async restoreCertArchive(archivePath: string): Promise<void> {
    await runCommand("sudo", ["tar", "xzf", archivePath, "-C", "/"], { timeoutMs: 30_000 });
  },

  async checkCertPathExists(path: string): Promise<boolean> {
    const resolved = resolve(path);
    const allowedRoots = ["/etc/letsencrypt/", "/etc/ssl/", env.APACHE_MANAGED_CERTS_DIR + sep];
    if (!allowedRoots.some((root) => resolved.startsWith(root))) return false;
    if (resolved.startsWith(env.APACHE_MANAGED_CERTS_DIR + sep)) return existsSync(resolved);
    return runCommand("sudo", ["test", "-f", resolved], { timeoutMs: 5000 }).then(
      () => true,
      () => false
    );
  },

  async saveManagedCert(
    vhostName: string,
    certPemPath: string,
    keyPemPath: string
  ): Promise<{ certPath: string; keyPath: string }> {
    assertValidVhostName(vhostName);
    await runCommand("openssl", ["x509", "-in", certPemPath, "-noout"], { timeoutMs: 5000 }).catch(() => {
      throw new Error("invalid_certificate_pem");
    });
    await runCommand("openssl", ["pkey", "-in", keyPemPath, "-noout"], { timeoutMs: 5000 }).catch(async () => {
      await runCommand("openssl", ["rsa", "-in", keyPemPath, "-noout"], { timeoutMs: 5000 }).catch(() => {
        throw new Error("invalid_private_key_pem");
      });
    });

    const destDir = join(env.APACHE_MANAGED_CERTS_DIR, vhostName);
    await mkdir(destDir, { recursive: true });
    const certPath = join(destDir, "fullchain.pem");
    const keyPath = join(destDir, "privkey.pem");
    await copyFile(certPemPath, certPath);
    await copyFile(keyPemPath, keyPath);
    return { certPath, keyPath };
  },

  parseGuidedFields,
  async applyGuidedFields(rawConfig: string, model: GuidedFormModel): Promise<string> {
    await ensureModulesForModel(model);
    return applyGuidedFields(rawConfig, model);
  },
  async buildInitialVhostConfig(model: GuidedFormModel & { serverName: string; listenPort: number }): Promise<string> {
    await ensureModulesForModel(model);
    return buildInitialVhostConfig(model);
  },

  resolveVhostLogPath,
};
