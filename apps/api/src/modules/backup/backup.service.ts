import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat, unlink, readdir } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import { docker } from "../../services/docker.client.js";
import { env } from "../../config/env.js";
import { BackupHistoryModel, BackupJobModel } from "../../db/models/backup.js";
import { GDriveService } from "../../services/gdrive.client.js";
import { UsbBackupService } from "../../services/usbBackup.client.js";
import { runCommand } from "../../utils/exec.js";
import type {
  BackupSourceType,
  BackupTarget,
  DetectedBindMount,
  DetectedVolumeMount,
  GDriveComparisonResult,
  OrphanDriveFile,
  DriveVerificationEntry,
  UsbBackupArchive,
} from "@pwa-admin/shared";

function timestampSlug(): string {
  return new Date().toISOString().replace(/:/g, "-");
}

const HELPER_IMAGE = "alpine:3.20";
let helperImagePulled = false;

/** Ensures the throwaway helper image used for volume backup/restore is present locally. */
async function ensureHelperImage(): Promise<void> {
  if (helperImagePulled) return;
  const images = await docker.listImages({ filters: JSON.stringify({ reference: [HELPER_IMAGE] }) });
  if (images.length === 0) {
    await new Promise<void>((resolve, reject) => {
      docker.pull(HELPER_IMAGE, (err: Error | null, stream: NodeJS.ReadableStream) => {
        if (err) return reject(err);
        docker.modem.followProgress(stream, (followErr: Error | null) =>
          followErr ? reject(followErr) : resolve()
        );
      });
    });
  }
  helperImagePulled = true;
}

async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve());
    stream.on("error", reject);
  });
  return hash.digest("hex");
}

export const BackupService = {
  /**
   * Lists host filesystem paths bind-mounted into running containers — data
   * living directly on the Pi's disk rather than in a named Docker volume, and
   * therefore invisible to `docker volume ls` / the volume backup path above.
   */
  async detectBindMounts(): Promise<DetectedBindMount[]> {
    const containers = await docker.listContainers({ all: false });
    const mounts: DetectedBindMount[] = [];
    for (const c of containers) {
      const containerName = c.Names[0]?.replace(/^\//, "") ?? c.Id.slice(0, 12);
      const info = await docker.getContainer(c.Id).inspect();
      for (const m of info.Mounts ?? []) {
        if (m.Type === "bind" && m.Source !== "/var/run/docker.sock") {
          mounts.push({ containerName, hostPath: m.Source, containerPath: m.Destination });
        }
      }
    }
    return mounts;
  },

  /** Same idea as detectBindMounts, but for named Docker volumes — a
   * container using a managed volume rather than a host directory has no
   * entry in detectBindMounts, only here. */
  async detectVolumeMounts(): Promise<DetectedVolumeMount[]> {
    const containers = await docker.listContainers({ all: false });
    const mounts: DetectedVolumeMount[] = [];
    for (const c of containers) {
      const containerName = c.Names[0]?.replace(/^\//, "") ?? c.Id.slice(0, 12);
      const info = await docker.getContainer(c.Id).inspect();
      for (const m of info.Mounts ?? []) {
        if (m.Type === "volume" && m.Name) {
          mounts.push({ containerName, volumeName: m.Name, containerPath: m.Destination });
        }
      }
    }
    return mounts;
  },

  /**
   * Backs up an arbitrary host directory via a direct `tar` (no throwaway
   * container needed — unlike named volumes, bind-mount paths already live on
   * the host filesystem the Node process/sudo can reach). The path must match
   * one of `detectBindMounts()`'s currently live entries, checked by the route
   * handler before this is ever called, so this never tars an arbitrary
   * admin-supplied path.
   */
  async backupPath(hostPath: string, targets: BackupTarget[]): Promise<string> {
    const label = basename(resolve(hostPath));
    const runId = BackupHistoryModel.createRun({
      jobId: null,
      type: "backup",
      sourceType: "path",
      sourceRef: hostPath,
      target: targets[0] ?? "local",
    });

    const start = Date.now();
    try {
      const destDir = join(env.BACKUP_LOCAL_ROOT, "paths", label);
      await mkdir(destDir, { recursive: true });
      const archiveName = `${timestampSlug()}.tar.gz`;
      const archivePath = join(destDir, archiveName);

      // sudo: bind-mount sources are frequently owned by container-internal
      // uids/gids that the admin service user can't read directly.
      await runCommand("sudo", ["tar", "czf", archivePath, "-C", hostPath, "."], { timeoutMs: 300_000 });

      const stats = await stat(archivePath);
      const checksum = await sha256OfFile(archivePath);

      let driveFileId: string | undefined;
      if (targets.includes("gdrive") && GDriveService.isEnabled()) {
        const uploaded = await GDriveService.uploadBackupFile(archivePath, "paths", label);
        const verified = await GDriveService.verifyUpload(uploaded.fileId, stats.size);
        if (verified) driveFileId = uploaded.fileId;
      }

      let usbPath: string | undefined;
      if (targets.includes("usb")) {
        try {
          if (await UsbBackupService.isAvailable()) {
            const copied = await UsbBackupService.copyBackupFile(archivePath, "paths", label);
            usbPath = copied.usbPath;
          }
          // else: no drive plugged in right now — silently skip this target,
          // the run still succeeds via local (and possibly gdrive) above.
        } catch {
          // Copy started but failed partway (disk full, unplugged mid-copy) —
          // don't fail the whole run over the USB leg specifically.
        }
      }

      BackupHistoryModel.complete(runId, {
        status: "success",
        filePath: archivePath,
        sizeBytes: stats.size,
        checksumSha256: checksum,
        driveFileId,
        usbPath,
        durationMs: Date.now() - start,
      });

      await this.applyRetention("path", label);
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

  async backupVolume(volumeName: string, targets: BackupTarget[]): Promise<string> {
    const runId = BackupHistoryModel.createRun({
      jobId: null,
      type: "backup",
      sourceType: "volume",
      sourceRef: volumeName,
      target: targets[0] ?? "local",
    });

    const start = Date.now();
    try {
      const destDir = join(env.BACKUP_LOCAL_ROOT, "volumes", volumeName);
      await mkdir(destDir, { recursive: true });
      const archiveName = `${timestampSlug()}.tar.gz`;
      const archivePath = join(destDir, archiveName);

      await ensureHelperImage();

      // Throwaway alpine container: mounts the target volume + backup root, tars the volume
      // contents, then is auto-removed. Avoids the Node process needing raw FS access to
      // arbitrary Docker-managed volume paths.
      await docker.run(
        "alpine:3.20",
        ["tar", "czf", `/backup-out/${archiveName}`, "-C", "/source", "."],
        [],
        {
          HostConfig: {
            AutoRemove: true,
            Binds: [`${volumeName}:/source:ro`, `${destDir}:/backup-out`],
          },
        }
      );

      const stats = await stat(archivePath);
      const checksum = await sha256OfFile(archivePath);

      let driveFileId: string | undefined;
      if (targets.includes("gdrive") && GDriveService.isEnabled()) {
        const uploaded = await GDriveService.uploadBackupFile(archivePath, "volumes", volumeName);
        const verified = await GDriveService.verifyUpload(uploaded.fileId, stats.size);
        if (verified) driveFileId = uploaded.fileId;
      }

      let usbPath: string | undefined;
      if (targets.includes("usb")) {
        try {
          if (await UsbBackupService.isAvailable()) {
            const copied = await UsbBackupService.copyBackupFile(archivePath, "volumes", volumeName);
            usbPath = copied.usbPath;
          }
        } catch {
          // Copy started but failed partway (disk full, unplugged mid-copy) —
          // don't fail the whole run over the USB leg specifically.
        }
      }

      BackupHistoryModel.complete(runId, {
        status: "success",
        filePath: archivePath,
        sizeBytes: stats.size,
        checksumSha256: checksum,
        driveFileId,
        usbPath,
        durationMs: Date.now() - start,
      });

      await this.applyRetention("volume", volumeName);
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

  async restoreVolume(volumeName: string, archivePath: string): Promise<void> {
    await ensureHelperImage();
    await docker.run("alpine:3.20", ["tar", "xzf", `/backup-in/${archivePath.split("/").pop()}`, "-C", "/target"], [], {
      HostConfig: {
        AutoRemove: true,
        Binds: [`${volumeName}:/target`, `${archivePath.split("/").slice(0, -1).join("/")}:/backup-in:ro`],
      },
    });
  },

  /** Restores a bind-mount path backup by extracting the archive back over the
   * live directory. hostPath must be a currently-detected bind mount, validated
   * by the route handler before this is called — never an admin-typed path. */
  async restorePath(hostPath: string, archivePath: string): Promise<void> {
    await runCommand("sudo", ["tar", "xzf", archivePath, "-C", hostPath], { timeoutMs: 300_000 });
  },

  async applyRetention(sourceType: BackupSourceType, sourceRef: string): Promise<void> {
    const subDir =
      sourceType === "volume" ? "volumes" : sourceType === "path" ? "paths" : sourceType === "image" ? "images" : "db";
    const dir = join(env.BACKUP_LOCAL_ROOT, subDir, sourceRef);

    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      return;
    }

    const withStats = await Promise.all(
      files.map(async (f) => {
        const path = join(dir, f);
        const s = await stat(path);
        return { path, mtime: s.mtimeMs };
      })
    );
    withStats.sort((a, b) => b.mtime - a.mtime);

    const cutoff = Date.now() - env.BACKUP_RETENTION_DAYS * 86_400_000;
    const toDelete = withStats
      .slice(env.BACKUP_RETENTION_MIN_COPIES)
      .filter((f) => f.mtime < cutoff);

    for (const f of toDelete) {
      await unlink(f.path).catch(() => {});
    }
  },

  async storageUsage(): Promise<{ localUsedBytes: number }> {
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
        else total += (await stat(full)).size;
      }
      return total;
    }
    return { localUsedBytes: await dirSize(env.BACKUP_LOCAL_ROOT) };
  },

  /**
   * Verifies each backup_history run's claimed Drive upload against what's
   * actually on Drive (by fileId, not by guessing from a file path — the
   * authoritative link), and separately surfaces any Drive file under the
   * category/sourceRef layout that isn't accounted for by any history run
   * (grouped by folder) so it can be reviewed/deleted from the UI.
   */
  async compareWithGDrive(): Promise<GDriveComparisonResult> {
    const driveFiles = GDriveService.isEnabled() ? await GDriveService.listAllBackupFiles() : [];
    const driveById = new Map(driveFiles.map((f) => [f.fileId, f]));
    const claimedFileIds = new Set<string>();

    const historyRows = BackupHistoryModel.list(1000, 0).filter((r) => r.status === "success");
    const verifications: DriveVerificationEntry[] = historyRows
      .filter((r) => r.drive_file_id)
      .map((r) => {
        claimedFileIds.add(r.drive_file_id!);
        const driveFile = driveById.get(r.drive_file_id!);
        let status: DriveVerificationEntry["status"];
        if (!driveFile) status = "missing";
        else if (r.size_bytes != null && r.size_bytes !== driveFile.sizeBytes) status = "size-mismatch";
        else status = "verified";
        return { runId: r.run_id, status };
      });

    // Runs targeting gdrive but with no driveFileId recorded never actually
    // reached Drive (e.g. the sync upload path failed silently before the
    // fileId was persisted) — surface those as "not-uploaded" too.
    for (const r of historyRows) {
      if (!r.drive_file_id && r.target === "gdrive") {
        verifications.push({ runId: r.run_id, status: "not-uploaded" });
      }
    }

    const orphanFiles = driveFiles.filter((f) => !claimedFileIds.has(f.fileId));
    const groupMap = new Map<string, OrphanDriveFile[]>();
    for (const f of orphanFiles) {
      const key = `${f.category}/${f.sourceRef}`;
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push({ fileId: f.fileId, fileName: f.fileName, sizeBytes: f.sizeBytes, modifiedAt: f.modifiedAt });
    }
    const orphanGroups = [...groupMap.entries()]
      .map(([key, files]) => {
        const [category, sourceRef] = key.split("/");
        return { category, sourceRef, files: files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)) };
      })
      .sort((a, b) => (a.category + a.sourceRef).localeCompare(b.category + b.sourceRef));

    return {
      checkedAt: new Date().toISOString(),
      verifications,
      orphanGroups,
      totalVerified: verifications.filter((v) => v.status === "verified").length,
      totalMissing: verifications.filter((v) => v.status === "missing" || v.status === "not-uploaded").length,
      totalOrphans: orphanFiles.length,
    };
  },

  async deleteGDriveFile(fileId: string): Promise<void> {
    await GDriveService.deleteFile(fileId);
  },
};

export { BackupJobModel, BackupHistoryModel };
