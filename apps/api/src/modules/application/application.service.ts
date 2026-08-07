import { mkdir, stat, readdir, rm } from "node:fs/promises";
import { join, basename } from "node:path";
import { env } from "../../config/env.js";
import { runCommand } from "../../utils/exec.js";
import { AppBackupRunModel, ApplicationModel, type ApplicationRow } from "../../db/models/application.js";
import { GDriveService } from "../../services/gdrive.client.js";
import { DbBackupService } from "../dbbackup/dbbackup.service.js";
import { BackupService } from "../backup/backup.service.js";
import type { AppBackupRunKind, BackupTarget } from "@pwa-admin-pi/shared";

function appSnapshotRoot(appName: string): string {
  return join(env.BACKUP_LOCAL_ROOT, "apps", appName);
}

function timestampSlug(): string {
  return new Date().toISOString().replace(/:/g, "-");
}

async function dirSize(path: string): Promise<number> {
  let total = 0;
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) total += await dirSize(full);
    else total += (await stat(full)).size.valueOf();
  }
  return total;
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
      if (app.db_location === "docker" || app.db_location === "native") {
        // DB is always a full dump, even inside a "partial" app run — dumps are
        // cheap relative to file trees and there's no simple incremental dump
        // path without configuring binlog replication.
        const dbRunId = await DbBackupService.dump(app.db_location, app.db_ref!, targets);
        const { BackupHistoryModel } = await import("../../db/models/backup.js");
        const dbRun = BackupHistoryModel.findByRunId(dbRunId);
        dbDumpPath = dbRun?.file_path ?? undefined;
        dbDriveFileId = dbRun?.drive_file_id ?? undefined;
      }

      const sizeBytes = await dirSize(snapshotDir);

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
      if (targets.includes("gdrive") && GDriveService.isEnabled()) {
        AppBackupRunModel.setDriveUploadStatus(runId, "pending");
        this.uploadSnapshotToDrive(app, runId, snapshotDir, paths).catch(() => {});
      }

      return runId;
    } catch (err) {
      AppBackupRunModel.complete(runId, { status: "failed", error: (err as Error).message });
      throw err;
    }
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
        await runCommand("sudo", ["chown", process.env.USER ?? "shan", archivePath], { timeoutMs: 5_000 }).catch(
          () => {}
        );

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
