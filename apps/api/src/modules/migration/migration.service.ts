import { randomUUID, createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile, copyFile } from "node:fs/promises";
import { createReadStream as createReadStreamFs, readFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { hostname } from "node:os";
import { fileURLToPath } from "node:url";
import si from "systeminformation";
import { docker } from "../../services/docker.client.js";
import { runCommand, isValidLinuxUsername } from "../../utils/exec.js";
import { UsbBackupService } from "../../services/usbBackup.client.js";
import { GDriveService } from "../../services/gdrive.client.js";
import { registerChannel } from "../../services/wsHub.js";
import { OsService } from "../os/os.service.js";
import { BackupService } from "../backup/backup.service.js";
import { DbBackupService } from "../dbbackup/dbbackup.service.js";
import { webServer } from "../webserver/webserver.registry.js";
import { HardwareService } from "../hardware/hardware.service.js";
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
  MigrationManifestFileEntry,
  MigrationManifestFileList,
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
    certTarget?: MigrationManifestItem["certTarget"];
    wifiProfile?: MigrationManifestItem["wifiProfile"];
  }>
): Promise<MigrationManifestItem> {
  const defaults = {
    containerConfig: null,
    applicationPaths: null,
    applicationDbArchivePath: null,
    databaseTarget: null,
    volumeTarget: null,
    certTarget: null,
    wifiProfile: null,
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
  const label = webServer().engine === "apache" ? "Configuration Apache (vhosts)" : "Configuration Nginx (vhosts)";
  return captureItem(manifestId, "nginx-config", label, async () => {
    const run = await webServer().backupConfig(["local"]);
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

/** One "tls-cert" item per vhost that actually has a resolvable certificate —
 * a vhost with no TLS (plain HTTP redirect-only, or terminated upstream of
 * this box) yields no item rather than a failed one, since there's nothing
 * to capture. See WebServerService.resolveCertPaths for the certbot-vs-manual
 * path resolution this relies on. */
async function captureTlsCert(manifestId: string, usbRoot: string, vhostName: string): Promise<MigrationManifestItem | null> {
  const resolved = await webServer().resolveCertPaths(vhostName);
  if (!resolved) return null;
  return captureItem(manifestId, "tls-cert", `Certificat TLS (${resolved.domain})`, async () => {
    // Sudo tar always writes to this service's own fixed staging dir first
    // (same "never point a sudo rule at an arbitrary/USB-mounted
    // destination" pattern captureNginxConfig/backupConfig already use) —
    // the USB copy below is a plain unprivileged file copy, both sides
    // already service-user-owned by that point.
    const stagingDir = join(env.BACKUP_LOCAL_ROOT, "tls-certs");
    await mkdir(stagingDir, { recursive: true });
    const fileName = `${resolved.domain.replace(/[^a-zA-Z0-9._-]/g, "_")}-${Date.now()}.tar.gz`;
    const localPath = join(stagingDir, fileName);
    // -C / with each path made relative to / — restore extracts back onto
    // these exact absolute locations (see restoreCertArchive), which is why
    // every path here must already be absolute (both certbot and manually
    // declared ssl_certificate paths always are).
    const relPaths = resolved.paths.map((p) => p.replace(/^\/+/, ""));
    await runCommand("sudo", ["tar", "czf", localPath, "-C", "/", ...relPaths], { timeoutMs: 30_000 });
    await runCommand("sudo", ["chown", env.SERVICE_USER, localPath], { timeoutMs: 5000 }).catch(() => {});

    const destDir = join(usbRoot, "tls-certs");
    await mkdir(destDir, { recursive: true });
    const destPath = join(destDir, fileName);
    await copyFile(localPath, destPath);
    const stats = await stat(destPath);
    return {
      sourceRunId: null,
      archiveRelPath: destPath,
      sizeBytes: stats.size,
      certTarget: { vhostName, domain: resolved.domain, source: resolved.source, restorePaths: resolved.paths },
    };
  });
}

/** Only captured when this machine reports at least one saved Wi-Fi
 * connection profile — most servers are wired-only, and nmcli returning
 * nothing isn't a failure worth recording as one. */
async function captureWifiConfig(manifestId: string, usbRoot: string): Promise<MigrationManifestItem | null> {
  const names = await HardwareService.listSavedWifiConnections();
  if (names.length === 0) return null;
  return captureItem(manifestId, "wifi-config", "Connexions Wi-Fi enregistrées", async () => {
    const stagingDir = join(env.BACKUP_LOCAL_ROOT, "wifi-config");
    await mkdir(stagingDir, { recursive: true });
    const fileName = `wifi-connections-${Date.now()}.tar.gz`;
    const localPath = join(stagingDir, fileName);
    await HardwareService.backupWifiConnections(localPath);
    await runCommand("sudo", ["chown", env.SERVICE_USER, localPath], { timeoutMs: 5000 }).catch(() => {});

    const destDir = join(usbRoot, "wifi-config");
    await mkdir(destDir, { recursive: true });
    const destPath = join(destDir, fileName);
    await copyFile(localPath, destPath);
    const stats = await stat(destPath);
    return { sourceRunId: null, archiveRelPath: destPath, sizeBytes: stats.size, wifiProfile: { connectionNames: names } };
  });
}

export const MigrationService = {
  /**
   * Kicks off a whole-server snapshot in the background and returns
   * immediately — capturing every container image, volume, database, and app
   * can take a long time, so the frontend polls/subscribes rather than
   * holding one HTTP request open (same shape as SiteDuplicateService).
   *
   * includeDuplicates (default false): a `<name>-duplicate` container is a
   * manual-failover clone SiteDuplicateService keeps running permanently
   * alongside its original (see siteDuplicate.service.ts) — capturing BOTH
   * by default would double the image/volume/DB work for content that's
   * already identical to its original at snapshot time, for a container
   * whose only purpose is a same-server fallback, not something a restore
   * onto a NEW server needs a second copy of. Left as an explicit opt-in
   * per admin request rather than silently excluded with no way back in.
   */
  async captureSnapshot(includeDuplicates = false): Promise<{ manifestId: string }> {
    const manifestId = randomUUID();
    const scope: MigrationManifestScope = { type: "server" };
    MigrationSnapshotModel.createRun(manifestId, scope);

    runCaptureSnapshot(manifestId, scope, { includeDuplicates }).catch((err) => {
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

    // includeDuplicates is a server-wide-scan concern (see captureSnapshot's
    // own doc comment) — a site-scoped capture already targets one specific
    // vhost's linked container explicitly via findLinkedContainer, never
    // sweeping every container on the box, so there's nothing for this flag
    // to opt in or out of here.
    runCaptureSnapshot(manifestId, scope, { includeDuplicates: false }).catch((err) => {
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

  /**
   * Reads every manifest.json already written to a USB drive — ground truth
   * independent of the local migration_snapshots table, same "browse what's
   * actually there" principle as UsbBackupService.browseArchives.
   *
   * Deliberately scans EVERY BACKUP/<hostname>/migration/ folder on the
   * drive, not just this machine's own hostname slug — a migration snapshot
   * is captured with the OLD server's hostname (which the new/replacement
   * server, by definition, doesn't share), so restricting this to
   * currentHostnameSlug() would make a disaster-recovery restore invisible
   * on the exact machine it's meant to be restored onto.
   *
   * Deliberately does NOT filter on detectDrives()'s isBackupConfigured —
   * that flag only reflects whether THIS machine's own BACKUP/<thisHost>
   * folder exists, which is never true yet on a genuinely blank replacement
   * server (the whole point of this scan). Every USB-mounted drive is
   * scanned directly for a BACKUP/ tree instead.
   */
  async listManifestsOnUsb(): Promise<MigrationManifest[]> {
    const drives = await UsbBackupService.detectDrives();
    const manifests: MigrationManifest[] = [];
    for (const drive of drives) {
      const backupRootParent = dirname(drive.backupRoot); // <mountpoint>/BACKUP
      let hostSlugs: string[];
      try {
        hostSlugs = (await readdir(backupRootParent, { withFileTypes: true }))
          .filter((e) => e.isDirectory())
          .map((e) => e.name);
      } catch {
        continue;
      }
      for (const hostSlug of hostSlugs) {
        const migrationDir = join(backupRootParent, hostSlug, "migration");
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
  async restoreFromManifest(
    manifestId: string,
    options: { includeOsPackages: boolean; excludedLabels?: string[]; selectedPackageNames?: string[] }
  ): Promise<{ restoreId: string }> {
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
      } else if (item.category === "tls-cert" && item.certTarget && item.archiveRelPath) {
        items.push(await planReplaceLine(item, "tls-cert", item.certTarget.domain, item.archiveRelPath));
      } else if (item.category === "wifi-config" && item.archiveRelPath) {
        items.push(await planReplaceLine(item, "wifi-config", "system-connections", item.archiveRelPath));
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

  /**
   * Flattens a manifest's items into one row per downloadable archive, for
   * the Restore confirmation screen's "voir les fichiers" export panel — a
   * manual-SSH alternative to the app's own restore flow, so the admin can
   * download the exact same archives the automated restore would use and
   * apply them by hand. Read-only, no restore side effects.
   */
  async listManifestFiles(manifestId: string): Promise<MigrationManifestFileList> {
    const manifest = (await this.listManifestsOnUsb()).find((m) => m.manifestId === manifestId);
    if (!manifest) throw new Error("manifest_not_found_on_usb");
    return { manifestId, usbRoot: manifest.usbRoot, files: flattenManifestFiles(manifest).map(({ path, ...entry }) => entry) };
  },

  /**
   * Resolves a client-supplied fileId back to the real (absolute)
   * filesystem path it refers to, for the download route — the client is
   * NEVER trusted to round-trip a raw archiveRelPath itself (see
   * MigrationManifestFileEntry's doc comment). This re-derives the exact
   * same fileId/path pairs listManifestFiles is built from, from the
   * manifest's CURRENT items, and matches against those — a pure in-memory
   * lookup against server-derived data, so there's no separate
   * path-construction/traversal surface to guard.
   */
  async resolveManifestFileId(manifestId: string, fileId: string): Promise<string> {
    const manifest = (await this.listManifestsOnUsb()).find((m) => m.manifestId === manifestId);
    if (!manifest) throw new Error("manifest_not_found_on_usb");
    const match = flattenManifestFiles(manifest).find((f) => f.fileId === fileId);
    if (!match) throw new Error("file_not_in_manifest");
    return match.path;
  },

  /**
   * Uploads one manifest file (already on USB) to Google Drive on demand —
   * the "Voir les fichiers" export panel's Drive counterpart to its existing
   * download button, for an admin who wants an off-USB copy of a specific
   * migration archive without uploading the whole snapshot. No local
   * tracking of "already uploaded" (unlike backup_history's driveFileId) —
   * migration files aren't rows in a table, they're derived fresh from
   * manifest.json every call, so this simply re-uploads each time it's
   * invoked rather than persisting state that has nowhere to live.
   */
  async uploadManifestFileToDrive(manifestId: string, fileId: string): Promise<{ driveFileId: string }> {
    const path = await this.resolveManifestFileId(manifestId, fileId);
    const { fileId: driveFileId } = await GDriveService.uploadBackupFile(path, "apps", `migration-${manifestId}`);
    return { driveFileId };
  },
};

function flattenManifestFiles(manifest: MigrationManifest): (MigrationManifestFileEntry & { path: string })[] {
  const files: (MigrationManifestFileEntry & { path: string })[] = [];
  manifest.items.forEach((item, itemIndex) => {
    if (item.status !== "success") return;

    if (item.applicationPaths || item.applicationDbArchivePath) {
      for (const [pathIndex, { path, usbArchivePath }] of (item.applicationPaths ?? []).entries()) {
        files.push({
          fileId: `${itemIndex}:path:${pathIndex}`,
          category: item.category,
          label: item.label,
          destinationPath: path,
          sizeBytes: null,
          path: usbArchivePath,
        });
      }
      if (item.applicationDbArchivePath) {
        files.push({
          fileId: `${itemIndex}:db`,
          category: item.category,
          label: `${item.label} (base de données)`,
          destinationPath: null,
          sizeBytes: null,
          path: item.applicationDbArchivePath,
        });
      }
    } else if (item.archiveRelPath) {
      files.push({
        fileId: `${itemIndex}`,
        category: item.category,
        label: item.label,
        destinationPath: null,
        sizeBytes: item.sizeBytes,
        path: item.archiveRelPath,
      });
    }
  });
  return files;
}

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

async function captureServerItems(
  manifestId: string,
  usbRoot: string,
  includeDuplicates: boolean
): Promise<MigrationManifestItem[]> {
  const items: MigrationManifestItem[] = [];

  items.push(await captureOsPackages(manifestId, usbRoot));

  const containers = await docker.listContainers({ all: false });
  for (const c of containers) {
    const containerName = c.Names[0]?.replace(/^\//, "") ?? c.Id.slice(0, 12);
    // A "<name>-duplicate" container is SiteDuplicateService's permanent
    // manual-failover clone (see captureSnapshot's own doc comment) — its
    // image/config is identical to its original at snapshot time, so
    // skipping it here (unless the admin explicitly opted in) avoids
    // doubling capture time/USB space for a same-server-only fallback
    // artifact a fresh-server restore has no use for.
    if (!includeDuplicates && containerName.endsWith("-duplicate")) continue;
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

  const vhosts = await webServer().listVhosts();
  for (const vhost of vhosts) {
    const certItem = await captureTlsCert(manifestId, usbRoot, vhost.name);
    if (certItem) items.push(certItem);
  }

  const wifiItem = await captureWifiConfig(manifestId, usbRoot);
  if (wifiItem) items.push(wifiItem);

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

  const vhost = await webServer().getVhostDetail(vhostName);
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

  const certItem = await captureTlsCert(manifestId, usbRoot, vhostName);
  if (certItem) items.push(certItem);

  return items;
}

async function runCaptureSnapshot(
  manifestId: string,
  scope: MigrationManifestScope,
  options: { includeDuplicates: boolean }
): Promise<void> {
  const usbRoot = await usbRootFor(manifestId);
  await mkdir(usbRoot, { recursive: true });

  const items: MigrationManifestItem[] =
    scope.type === "server"
      ? await captureServerItems(manifestId, usbRoot, options.includeDuplicates)
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
  await writeFile(join(usbRoot, "migrate.sh"), buildMigrateScript(manifest), { mode: 0o755 });

  const anyFailed = items.some((i) => i.status === "failed");
  const finalStatus = anyFailed ? "partial" : "success";
  MigrationSnapshotModel.complete(manifestId, { status: finalStatus, manifest });
  publishProgress(manifestId, { done: true, status: finalStatus });
}

/**
 * Generates a standalone script written INTO this exact manifest's own USB
 * folder (migration/<manifestId>/migrate.sh) — the admin's requested "just
 * start it over SSH" path, distinct from deploy/bootstrap-fresh-server.sh
 * (a generic script fetched from git, which still has to interactively find
 * the USB drive and locate a manifest by hand). This one is pre-bound to a
 * single manifestId and needs no interaction beyond the USB mountpoint
 * itself.
 *
 * Deliberately requires running from a real file path (USB physically
 * plugged into the new machine, or the migration folder copied over first) —
 * NOT piped through `ssh ... 'bash -s' < migrate.sh`. A script read from
 * stdin has no reliable $0/BASH_SOURCE to locate its own directory (it
 * resolves to "bash", not a real path), which would silently break the
 * manifest.json/bootstrap-fresh-server.sh lookups below. The supported "over
 * SSH" shape is instead: `ssh user@newhost bash /mnt/usb/.../migrate.sh
 * <APP_DIR> <SERVICE_USER>` — the path is still passed as a real argv, so
 * $0 resolves correctly even though the shell itself is remote.
 */
function buildMigrateScript(manifest: MigrationManifest): string {
  const scopeLabel =
    manifest.scope.type === "site" ? `site "${manifest.scope.siteName}"` : "serveur complet";
  return `#!/usr/bin/env bash
set -euo pipefail

# Script de migration auto-genere pour l'instantane ${manifest.manifestId}
# (${scopeLabel}, capture le ${manifest.createdAt} depuis "${manifest.hostname}",
# ${manifest.osDistro} ${manifest.osRelease}).
#
# A executer directement sur la NOUVELLE machine, disque USB contenant ce
# dossier deja branche — en console locale, ou a distance par SSH SANS pipe
# stdin (le script doit garder un vrai chemin de fichier pour se localiser) :
#   ssh <utilisateur>@<nouvelle-machine> bash "/chemin/vers/migrate.sh" <APP_DIR> <SERVICE_USER>
#
# Ne fait qu'appeler bootstrap-fresh-server.sh (clone/build pwa-admin, audit +
# installation des dependances manquantes avec confirmation unique, config
# Tailscale) puis laisse pwa-admin restaurer LUI-MEME cet instantane precis
# (Restore > Migration serveur) une fois demarre — jamais de logique de
# restauration dupliquee ici.

if [ -z "${'$'}{BASH_SOURCE[0]:-}" ] || [ "${'$'}{BASH_SOURCE[0]}" = "bash" ]; then
  echo "Ce script doit etre execute depuis un vrai chemin de fichier (pas via un pipe stdin)." >&2
  echo "Exemple : ssh <utilisateur>@<nouvelle-machine> bash \\"/chemin/vers/migrate.sh\\" <APP_DIR> <SERVICE_USER>" >&2
  exit 1
fi

APP_DIR="${'$'}{1:?Usage: migrate.sh <APP_DIR> <SERVICE_USER> [--authkey KEY]}"
SERVICE_USER="${'$'}{2:?Usage: migrate.sh <APP_DIR> <SERVICE_USER> [--authkey KEY]}"
shift 2 || true

SCRIPT_DIR="$(cd "$(dirname "${'$'}{BASH_SOURCE[0]}")" && pwd)"
MANIFEST_ID="${manifest.manifestId}"

echo "== Migration ${manifest.manifestId} (${scopeLabel}) vers ${'$'}{APP_DIR} =="
echo "Ce script va installer/mettre a jour pwa-admin sur cette machine, puis"
echo "vous devrez terminer la restauration depuis l'interface (Restore >"
echo "Migration serveur > cet instantane) une fois pwa-admin demarre."
echo ""

if [ ! -f "${'$'}{SCRIPT_DIR}/manifest.json" ]; then
  echo "manifest.json introuvable a cote de ce script (${'$'}{SCRIPT_DIR}) — le dossier de migration a-t-il ete deplace/copie en partie ?" >&2
  exit 1
fi

BOOTSTRAP="${'$'}{SCRIPT_DIR}/bootstrap-fresh-server.sh"
if [ ! -f "$BOOTSTRAP" ]; then
  # Le dossier de migration ne contient que manifest.json + les archives —
  # bootstrap-fresh-server.sh vit dans le depot git, telecharge ici au besoin
  # pour que ce script reste utilisable seul, sans avoir clone le repo au prealable.
  echo "Telechargement de bootstrap-fresh-server.sh depuis le depot pwa_admin..."
  curl -fsSL "https://raw.githubusercontent.com/shankubo/pwa_admin/master/deploy/bootstrap-fresh-server.sh" -o "$BOOTSTRAP"
  chmod +x "$BOOTSTRAP"
fi

echo "Point de montage USB attendu par bootstrap-fresh-server.sh : $(cd "${'$'}{SCRIPT_DIR}/../../.." && pwd)"
echo "(dossier contenant BACKUP/${manifest.hostname}/migration/${manifest.manifestId}/)"
echo ""

exec "$BOOTSTRAP" "$APP_DIR" "$SERVICE_USER" "$@"
`;
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

const homeOwnersEnsured = new Set<string>();

/**
 * An Application's bind-mount path (e.g. /home/shan/myapp/data) implies an OS
 * user ("shan") that owned it on the OLD server. On a truly blank new server
 * that account doesn't exist yet — `tar -C <path>` fails outright if the
 * directory's never been created, and even if it were pre-created, files
 * would restore under a UID with no matching name, breaking that admin's own
 * login on the new box. This creates the missing account (system user, home
 * dir matching the path's /home/<user> segment, locked password — the admin
 * sets one manually afterward same as any fresh account) BEFORE the archive
 * is extracted, so ownership and the login itself both come back identical.
 * Only acts on /home/<user>/... paths — anything else (e.g. /var/www/...) is
 * already owned by root or a service account created earlier in this same
 * restore (nginx/docker/etc), not an individual admin login.
 */
async function ensureHomeOwnerExists(targetPath: string): Promise<void> {
  const match = /^\/home\/([^/]+)/.exec(targetPath);
  if (!match) return;
  const username = match[1];
  if (!isValidLinuxUsername(username) || homeOwnersEnsured.has(username)) return;

  const exists = await runCommand("id", [username], { timeoutMs: 5000 }).then(
    () => true,
    () => false
  );
  if (exists) {
    homeOwnersEnsured.add(username);
    return;
  }

  // Only marked "ensured" once useradd is confirmed to have actually
  // succeeded — a failed attempt must stay retryable on a later
  // ensureHomeOwnerExists call (same restore retry, or a different manifest
  // referencing the same username) rather than permanently poisoning this
  // module-level cache for the rest of the process lifetime.
  await runCommand(
    "sudo",
    ["useradd", "--system", "--create-home", "--home-dir", `/home/${username}`, "--shell", "/usr/sbin/nologin", username],
    { timeoutMs: 10_000 }
  );
  homeOwnersEnsured.add(username);
}

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
  options: { includeOsPackages: boolean; excludedLabels?: string[]; selectedPackageNames?: string[] }
): Promise<void> {
  const results: MigrationRestoreResults = [];
  const excluded = new Set(options.excludedLabels ?? []);

  // Item-level selection: the admin can uncheck any individual item on the
  // confirmation screen (a specific container image, a specific Application,
  // etc.) — excluded ones are recorded as "skipped" rather than silently
  // vanishing from the results list, same as the checksum-based
  // already-up-to-date skip above.
  const byCategory = (category: MigrationManifestItem["category"]) =>
    manifest.items.filter((i) => i.category === category && i.status === "success" && !excluded.has(i.label));

  for (const item of manifest.items) {
    if (item.status === "success" && excluded.has(item.label)) {
      results.push({ category: item.category, label: `${item.label} (non sélectionné)`, status: "skipped", error: null });
    }
  }

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
    // Package-level selection: when the admin has checked only some
    // packages on the confirmation screen, selectedPackageNames restricts
    // installOrUpgradePackages to exactly that subset — undefined means
    // "everything in the manifest", preserving the previous all-or-nothing
    // behavior for callers that don't send a selection.
    const selectedPackages = options.selectedPackageNames ? new Set(options.selectedPackageNames) : null;
    for (const item of byCategory("os-packages")) {
      await restoreItem(restoreId, results, item.category, item.label, async () => {
        if (!item.archiveRelPath) throw new Error("no_archive_path");
        const packages = JSON.parse(await readFile(item.archiveRelPath, "utf8")) as {
          name: string;
          version: string;
        }[];
        const targets = selectedPackages ? packages.filter((p) => selectedPackages.has(p.name)) : packages;
        if (targets.length === 0) throw new RestoreSkipped();
        const outcome = await OsService.installOrUpgradePackages(
          targets.map((p) => ({ name: p.name, version: p.version }))
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

  // Certs are restored BEFORE nginx-config so the config's own ssl_certificate
  // paths already resolve to real files by the time restoreConfig's own
  // `nginx -t` runs — restoring in the opposite order would make every
  // TLS vhost fail that test and trigger the config's revert-on-failure path.
  for (const item of byCategory("tls-cert")) {
    await restoreItem(restoreId, results, item.category, item.label, async () => {
      if (!item.archiveRelPath || !item.certTarget) throw new Error("no_archive_or_target");
      const { ran } = await restoreIfChanged("tls-cert", item.certTarget.domain, item.archiveRelPath, async () => {
        // Same staging rationale as the nginx-config/application-path
        // restores below — the sudo tar rule is scoped to this fixed local
        // dir, never an arbitrary USB path.
        const destDir = join(env.BACKUP_LOCAL_ROOT, "tls-certs");
        await mkdir(destDir, { recursive: true });
        const localPath = join(destDir, `migration-restore-${Date.now()}.tar.gz`);
        await copyFile(item.archiveRelPath!, localPath);
        await webServer().restoreCertArchive(localPath);
      });
      if (!ran) throw new RestoreSkipped();
    });
  }

  for (const item of byCategory("wifi-config")) {
    await restoreItem(restoreId, results, item.category, item.label, async () => {
      if (!item.archiveRelPath) throw new Error("no_archive_path");
      const { ran } = await restoreIfChanged("wifi-config", "system-connections", item.archiveRelPath, async () => {
        const destDir = join(env.BACKUP_LOCAL_ROOT, "wifi-config");
        await mkdir(destDir, { recursive: true });
        const localPath = join(destDir, `migration-restore-${Date.now()}.tar.gz`);
        await copyFile(item.archiveRelPath!, localPath);
        await HardwareService.restoreWifiConnections(localPath);
      });
      if (!ran) throw new RestoreSkipped();
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
        await webServer().restoreConfig(localPath);
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
            await ensureHomeOwnerExists(path);
            const destDir = join(env.BACKUP_LOCAL_ROOT, "paths", basename(path));
            await mkdir(destDir, { recursive: true });
            const localPath = join(destDir, basename(usbArchivePath));
            await copyFile(usbArchivePath, localPath);
            // sudo mkdir is only needed (and only sudoers-scoped) for paths
            // under /home/<user> that ensureHomeOwnerExists may have just
            // created the owner for — everything else (e.g. /var/www/...) is
            // an existing, already-managed path by the time an Application
            // restore reaches it, same assumption the pre-existing rsync
            // restore rule above makes.
            if (/^\/home\//.test(path)) {
              await runCommand("sudo", ["mkdir", "-p", path], { timeoutMs: 10_000 });
            } else {
              await mkdir(path, { recursive: true }).catch(() => {});
            }
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
