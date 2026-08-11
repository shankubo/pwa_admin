import { mkdir, stat, readdir, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { join, basename } from "node:path";
import { createGzip } from "node:zlib";
import { env } from "../../config/env.js";
import { runCommand } from "../../utils/exec.js";
import { dirSize } from "../../utils/dirSize.js";
import { docker } from "../../services/docker.client.js";
import { AppBackupRunModel, ApplicationModel, type ApplicationRow } from "../../db/models/application.js";
import { GDriveService } from "../../services/gdrive.client.js";
import { UsbBackupService } from "../../services/usbBackup.client.js";
import { DbBackupService } from "../dbbackup/dbbackup.service.js";
import { BackupService } from "../backup/backup.service.js";
import type { AppBackupRunKind, BackupTarget } from "@pwa-admin/shared";

function appSnapshotRoot(appName: string): string {
  return join(env.BACKUP_LOCAL_ROOT, "apps", appName);
}

function timestampSlug(): string {
  return new Date().toISOString().replace(/:/g, "-");
}

/** Parses rsync's itemize-changes output to count files actually transferred
 * (as opposed to hardlinked from --link-dest because they were unchanged). */
function countChangedFiles(rsyncStdout: string): number {
  return rsyncStdout
    .split("\n")
    .filter((line) => /^[<>ch]/.test(line)) // itemized-change lines start with a transfer/change indicator
    .length;
}

export const ApplicationService = {
  async runBackup(app: ApplicationRow, kind: AppBackupRunKind): Promise<string> {
    const targets = JSON.parse(app.targets) as BackupTarget[];
    const paths = JSON.parse(app.paths) as string[];
    const volumeNames = JSON.parse(app.volume_names ?? "[]") as string[];
    const root = appSnapshotRoot(app.name);
    await mkdir(root, { recursive: true });

    const snapshotDir = join(root, `${kind}-${timestampSlug()}`);
    const runId = AppBackupRunModel.createRun({ appId: app.id, kind, snapshotDir });

    const start = Date.now();
    try {
      // Full runs start a fresh hardlink chain (no --link-dest); partial runs
      // link against the most recent snapshot so unchanged files cost no extra
      // disk. Either way this is the *only* mechanism — "full" vs "partial" is
      // otherwise the same rsync-based snapshot, just with or without the
      // link-dest optimization.
      const previous =
        kind === "partial"
          ? (await this.findLatestSnapshotDir(app.name))
          : null;

      let totalChanged = 0;
      for (const sourcePath of paths) {
        const label = basename(sourcePath);
        const destPath = join(snapshotDir, label);
        await mkdir(destPath, { recursive: true });

        const args = ["-a", "--itemize-changes"];
        if (previous) {
          const prevPathForLabel = join(previous, label);
          args.push(`--link-dest=${prevPathForLabel}`);
        }
        args.push(`${sourcePath}/`, destPath);

        // sudo: bind-mount sources are frequently owned by container-internal
        // uids/gids the admin service user can't read directly.
        const { stdout } = await runCommand("sudo", ["rsync", ...args], { timeoutMs: 600_000 });
        totalChanged += countChangedFiles(stdout);
      }

      let dbDumpPath: string | undefined;
      let dbDriveFileId: string | undefined;
      let dbSizeBytes = 0;
      if (app.db_location === "docker" || app.db_location === "native") {
        // DB is always a full dump, even inside a "partial" app run — dumps are
        // cheap relative to file trees and there's no simple incremental dump
        // path without configuring binlog replication. dumpDocker/dumpNative
        // already handle the gdrive/usb legs themselves (same `targets`), so
        // there's no need to re-upload/re-copy the dump file below — only its
        // size needs folding into this app run's total.
        const dbRunId = await DbBackupService.dump(app.db_location, app.db_ref!, targets);
        const { BackupHistoryModel } = await import("../../db/models/backup.js");
        const dbRun = BackupHistoryModel.findByRunId(dbRunId);
        dbDumpPath = dbRun?.file_path ?? undefined;
        dbDriveFileId = dbRun?.drive_file_id ?? undefined;
        dbSizeBytes = dbRun?.size_bytes ?? 0;
      }

      // Named Docker volumes (as opposed to bind-mount paths) — each already
      // has its own full tar/gdrive/usb pipeline via BackupService.backupVolume,
      // same rationale as the DB dump above: run it and fold in the size,
      // don't duplicate the tar/upload logic here.
      let volumesSizeBytes = 0;
      for (const volumeName of volumeNames) {
        const volumeRunId = await BackupService.backupVolume(volumeName, targets);
        const { BackupHistoryModel } = await import("../../db/models/backup.js");
        const volumeRun = BackupHistoryModel.findByRunId(volumeRunId);
        volumesSizeBytes += volumeRun?.size_bytes ?? 0;
      }

      // Container images — full runs only. Unlike files/volumes, an image
      // doesn't change incrementally between runs (it's replaced wholesale on
      // redeploy), and a `docker save` of a multi-hundred-MB image on every
      // partial run (e.g. daily) would be wasted disk/time for no benefit:
      // the image is byte-identical until the next deploy.
      let imagesSizeBytes = 0;
      const containerNames = JSON.parse(app.container_names) as string[];
      if (kind === "full") {
        for (const containerName of containerNames) {
          const imageRunId = await this.backupContainerImage(containerName, targets).catch(() => null);
          if (!imageRunId) continue;
          const { BackupHistoryModel } = await import("../../db/models/backup.js");
          const imageRun = BackupHistoryModel.findByRunId(imageRunId);
          imagesSizeBytes += imageRun?.size_bytes ?? 0;
        }
      }

      const sizeBytes = (await dirSize(snapshotDir)) + dbSizeBytes + volumesSizeBytes + imagesSizeBytes;

      AppBackupRunModel.complete(runId, {
        status: "success",
        dbDumpPath,
        dbDriveFileId,
        filesChanged: totalChanged,
        sizeBytes,
      });

      await this.applyRetention(app);

      // The local backup is already "success" at this point — the (possibly
      // multi-GB) Drive upload of the file snapshot runs afterward, tracked
      // separately via drive_upload_status, so a slow/failed upload never
      // blocks or misrepresents the local backup's own success. Set "pending"
      // synchronously so the UI reflects the intent to upload immediately,
      // before the (fire-and-forget) tar/upload work actually starts.
      if (paths.length > 0 && targets.includes("gdrive") && GDriveService.isEnabled()) {
        AppBackupRunModel.setDriveUploadStatus(runId, "pending");
        this.uploadSnapshotToDrive(app, runId, snapshotDir, paths).catch(() => {});
      }

      // Same rationale as the Drive leg above: don't block the (already
      // "success") local backup on a possibly multi-GB USB copy. Unlike Drive,
      // "no drive plugged in" is an expected, frequent case here, not a config
      // gate, so availability is only checked once the async job starts.
      if (targets.includes("usb")) {
        AppBackupRunModel.setUsbCopyStatus(runId, "pending");
        this.copySnapshotToUsb(app, runId, snapshotDir, paths).catch(() => {});
      }

      return runId;
    } catch (err) {
      AppBackupRunModel.complete(runId, { status: "failed", error: (err as Error).message });
      throw err;
    }
  },

  /**
   * Exports a container's image (`docker save` equivalent) so the app can be
   * fully recreated even if the source image is later lost — rebuilt from a
   * different commit, removed by image pruning, or the box is rebuilt from
   * scratch. Complements the volume/DB backups above, which only cover data,
   * not the code+runtime that reads it.
   */
  async backupContainerImage(containerName: string, targets: BackupTarget[]): Promise<string> {
    const container = docker.getContainer(containerName);
    const info = await container.inspect();
    const imageRef = info.Config.Image;

    const { BackupHistoryModel } = await import("../../db/models/backup.js");
    const runId = BackupHistoryModel.createRun({
      jobId: null,
      type: "backup",
      sourceType: "image",
      sourceRef: containerName,
      target: targets[0] ?? "local",
    });

    const start = Date.now();
    try {
      const destDir = join(env.BACKUP_LOCAL_ROOT, "images", containerName);
      await mkdir(destDir, { recursive: true });
      const fileName = `${timestampSlug()}.tar.gz`;
      const filePath = join(destDir, fileName);

      const image = docker.getImage(imageRef);
      const stream = await image.get();
      const gzip = createGzip();
      const out = createWriteStream(filePath);

      await new Promise<void>((resolve, reject) => {
        stream.pipe(gzip).pipe(out);
        out.on("finish", resolve);
        out.on("error", reject);
        stream.on("error", reject);
      });

      const stats = await stat(filePath);
      const { createHash } = await import("node:crypto");
      const { readFile } = await import("node:fs/promises");
      const checksum = createHash("sha256").update(await readFile(filePath)).digest("hex");

      let driveFileId: string | undefined;
      if (targets.includes("gdrive") && GDriveService.isEnabled()) {
        const uploaded = await GDriveService.uploadBackupFile(filePath, "apps", `image-${containerName}`);
        const verified = await GDriveService.verifyUpload(uploaded.fileId, stats.size);
        if (verified) driveFileId = uploaded.fileId;
      }

      let usbPath: string | undefined;
      if (targets.includes("usb")) {
        try {
          if (await UsbBackupService.isAvailable()) {
            const copied = await UsbBackupService.copyBackupFile(filePath, "paths", `image-${containerName}`);
            usbPath = copied.usbPath;
          }
        } catch {
          // Same rationale as elsewhere: don't fail the whole run over the USB leg.
        }
      }

      BackupHistoryModel.complete(runId, {
        status: "success",
        filePath,
        sizeBytes: stats.size,
        checksumSha256: checksum,
        driveFileId,
        usbPath,
        durationMs: Date.now() - start,
      });

      await BackupService.applyRetention("image", containerName);
      return runId;
    } catch (err) {
      BackupHistoryModel.complete(runId, {
        status: "failed",
        error: (err as Error).message,
        durationMs: Date.now() - start,
      });
      throw err;
    }
  },

  /**
   * Restores a container from a saved image archive (`docker load` +
   * recreate). The container is stopped/removed and recreated from the
   * loaded image with the same name/config it had at inspect time — volumes
   * and networks it was attached to are preserved since they're referenced
   * by name, not recreated here.
   */
  async restoreContainerImage(containerName: string, runId: string): Promise<void> {
    const { BackupHistoryModel } = await import("../../db/models/backup.js");
    const run = BackupHistoryModel.findByRunId(runId);
    if (!run || !run.file_path) throw new Error("backup_run_not_found");

    const container = docker.getContainer(containerName);
    const info = await container.inspect();
    const previousConfig = info;

    const { createReadStream } = await import("node:fs");
    const { createGunzip } = await import("node:zlib");
    const gunzip = createGunzip();
    const tarStream = createReadStream(run.file_path).pipe(gunzip);
    const loadStream = await docker.loadImage(tarStream);
    await new Promise<void>((resolve, reject) => {
      docker.modem.followProgress(loadStream, (err: Error | null) => (err ? reject(err) : resolve()));
    });

    const wasRunning = previousConfig.State.Running;

    // Create the replacement under a temporary name FIRST, before touching the
    // live container — if createContainer throws (bad config, name clash,
    // etc.), the original container is untouched and the app stays up. This
    // works even when the container publishes a host port (e.g. ima-app on
    // 3000): create() alone doesn't bind the port, only start() does, and the
    // old container isn't stopped until after create() has already succeeded.
    const tempName = `${containerName}-restore-${Date.now()}`;
    const recreated = await docker.createContainer({
      name: tempName,
      Image: previousConfig.Config.Image,
      Env: previousConfig.Config.Env,
      Cmd: previousConfig.Config.Cmd,
      Entrypoint: previousConfig.Config.Entrypoint,
      ExposedPorts: previousConfig.Config.ExposedPorts,
      Labels: previousConfig.Config.Labels,
      HostConfig: previousConfig.HostConfig,
      NetworkingConfig: {
        EndpointsConfig: previousConfig.NetworkSettings.Networks,
      },
    });

    await container.stop().catch(() => {});
    await container.remove();
    await recreated.rename({ name: containerName });

    if (wasRunning) await recreated.start();
  },

  /**
   * Compresses each path in the snapshot to its own tar.gz and uploads it to
   * Drive, updating drive_upload_status/progress as it goes so the UI can show
   * real advancement instead of a run that silently never reaches Drive.
   */
  async uploadSnapshotToDrive(
    app: ApplicationRow,
    runId: string,
    snapshotDir: string,
    paths: string[]
  ): Promise<void> {
    const tmpDir = join(env.BACKUP_LOCAL_ROOT, "_tmp-drive-upload");
    await mkdir(tmpDir, { recursive: true });

    const fileIds: string[] = [];
    try {
      for (let i = 0; i < paths.length; i++) {
        const label = basename(paths[i]);
        const snapshotPathDir = join(snapshotDir, label);
        const archivePath = join(tmpDir, `${runId}-${label}.tar.gz`);

        // tar has no easy built-in progress reporting, so this phase shows as
        // an indeterminate "compressing" state rather than a percentage — large
        // path trees can spend several minutes here before any upload begins,
        // and a stuck-looking 0% upload bar would be more confusing than an
        // honest "compressing, no ETA" indicator.
        const pathBaseProgress = Math.round((i / paths.length) * 100);
        AppBackupRunModel.setDriveUploadStatus(runId, "compressing", { progressPct: pathBaseProgress });

        // sudo: snapshot contents may carry container-internal ownership the
        // admin service user can't read directly (mirrors the bind-mount tar
        // rules already granted for the plain path-backup module).
        await runCommand("sudo", ["tar", "czf", archivePath, "-C", snapshotPathDir, "."], {
          timeoutMs: 600_000,
        });
        // Ownership handoff so the Node process can stream the archive itself.
        await runCommand("sudo", ["chown", env.SERVICE_USER, archivePath], { timeoutMs: 5_000 }).catch(() => {});

        const pathProgressSpan = 100 / paths.length;
        AppBackupRunModel.setDriveUploadStatus(runId, "uploading", { progressPct: pathBaseProgress });

        const uploaded = await GDriveService.uploadBackupFile(archivePath, "apps", app.name, (uploadedBytes, totalBytes) => {
          const withinPathPct = totalBytes > 0 ? uploadedBytes / totalBytes : 0;
          const overallPct = Math.min(99, Math.round(pathBaseProgress + withinPathPct * pathProgressSpan));
          AppBackupRunModel.setDriveUploadStatus(runId, "uploading", { progressPct: overallPct });
        });

        fileIds.push(uploaded.fileId);
        await rm(archivePath, { force: true });
      }

      AppBackupRunModel.setDriveUploadStatus(runId, "success", { progressPct: 100, fileIds });
    } catch (err) {
      AppBackupRunModel.setDriveUploadStatus(runId, "failed", { error: (err as Error).message });
    }
  },

  /**
   * USB counterpart to uploadSnapshotToDrive: compresses each path in the
   * snapshot to its own tar.gz and copies it onto the detected USB drive,
   * updating usb_copy_status/progress as it goes. Runs after the Drive leg
   * (if any) rather than in parallel, since both share the same sudo tar of
   * the snapshot directory and running them concurrently would just contend
   * for the same disk I/O.
   */
  async copySnapshotToUsb(
    app: ApplicationRow,
    runId: string,
    snapshotDir: string,
    paths: string[]
  ): Promise<void> {
    // No file paths to compress (a DB-only app, e.g.) — the DB dump's own USB
    // copy (via DbBackupService.dump above) already covers this run's USB
    // leg, so there's nothing left to do here. "none" (rather than "success"
    // with an empty list) avoids implying a copy happened when it didn't.
    if (paths.length === 0) {
      AppBackupRunModel.setUsbCopyStatus(runId, "none");
      return;
    }

    if (!(await UsbBackupService.isAvailable())) {
      AppBackupRunModel.setUsbCopyStatus(runId, "none");
      return;
    }

    const tmpDir = join(env.BACKUP_LOCAL_ROOT, "_tmp-usb-upload");
    await mkdir(tmpDir, { recursive: true });

    const usbPaths: string[] = [];
    try {
      for (let i = 0; i < paths.length; i++) {
        const label = basename(paths[i]);
        const snapshotPathDir = join(snapshotDir, label);
        const archivePath = join(tmpDir, `${runId}-${label}.tar.gz`);

        const pathBaseProgress = Math.round((i / paths.length) * 100);
        AppBackupRunModel.setUsbCopyStatus(runId, "compressing", { progressPct: pathBaseProgress });

        await runCommand("sudo", ["tar", "czf", archivePath, "-C", snapshotPathDir, "."], {
          timeoutMs: 600_000,
        });
        await runCommand("sudo", ["chown", env.SERVICE_USER, archivePath], { timeoutMs: 5_000 }).catch(() => {});

        AppBackupRunModel.setUsbCopyStatus(runId, "uploading", { progressPct: pathBaseProgress });
        const copied = await UsbBackupService.copyBackupFile(archivePath, "paths", `${app.name}-${label}`);
        usbPaths.push(copied.usbPath);
        await rm(archivePath, { force: true });
      }

      AppBackupRunModel.setUsbCopyStatus(runId, "success", { progressPct: 100, paths: usbPaths });
    } catch (err) {
      AppBackupRunModel.setUsbCopyStatus(runId, "failed", { error: (err as Error).message });
    }
  },

  async findLatestSnapshotDir(appName: string): Promise<string | null> {
    const root = appSnapshotRoot(appName);
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      return null;
    }
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
    if (dirs.length === 0) return null;
    return join(root, dirs[dirs.length - 1]);
  },

  async restore(app: ApplicationRow, runId: string): Promise<void> {
    const run = AppBackupRunModel.findByRunId(runId);
    if (!run) throw new Error("app_backup_run_not_found");

    const paths = JSON.parse(app.paths) as string[];

    // Pre-restore safety snapshot — always taken, not skippable.
    await this.runBackup(app, "partial").catch(() => {});

    for (const sourcePath of paths) {
      const label = basename(sourcePath);
      const snapshotPath = join(run.snapshot_dir, label);
      if (!(await stat(snapshotPath).catch(() => null))) continue;
      // Mirror the snapshot back over the live directory. --delete makes this a
      // true point-in-time restore (removes files created after the snapshot).
      await runCommand("sudo", ["rsync", "-a", "--delete", `${snapshotPath}/`, sourcePath], {
        timeoutMs: 600_000,
      });
    }

    if (run.db_dump_path && (app.db_location === "docker" || app.db_location === "native")) {
      // Re-uses the DB restore path keyed by the dump's own backup_history run,
      // found via the file path recorded alongside this app run.
      const { BackupHistoryModel } = await import("../../db/models/backup.js");
      const dbHistoryRow = BackupHistoryModel.list(500).find((r) => r.file_path === run.db_dump_path);
      if (dbHistoryRow) {
        await DbBackupService.restore(app.db_location, app.db_ref!, dbHistoryRow.run_id);
      }
    }

    // Named Docker volumes are NOT restored here: unlike paths/db, this app
    // run doesn't record which backup_history volume run(s) it triggered, so
    // there's no reliable way to pick the matching archive automatically.
    // Restore a volume from the Docker > Volumes screen instead, picking the
    // archive with the closest timestamp to this app run's startedAt.
  },

  async applyRetention(app: ApplicationRow): Promise<void> {
    const root = appSnapshotRoot(app.name);
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      return;
    }

    const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
    const cutoffIdx = Math.max(0, dirs.length - (app.retention_min_copies ?? 3));
    const cutoffDate = Date.now() - (app.retention_days ?? 30) * 86_400_000;

    for (let i = 0; i < cutoffIdx; i++) {
      const dirPath = join(root, dirs[i]);
      const stats = await stat(dirPath).catch(() => null);
      if (stats && stats.mtimeMs < cutoffDate) {
        // sudo: snapshot contents may include files with container-internal
        // ownership that the admin service user can't unlink directly.
        await runCommand("sudo", ["rm", "-rf", dirPath], { timeoutMs: 60_000 }).catch(() => {});
      }
    }
  },
};

export { ApplicationModel };
