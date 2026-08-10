import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, stat, unlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { join, basename } from "node:path";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { BackupService, BackupJobModel, BackupHistoryModel } from "./backup.service.js";
import { ApplicationService } from "../application/application.service.js";
import { backupJobToApiShape, backupHistoryToApiShape } from "../../db/models/backup.js";
import { withAudit } from "../../middleware/auditLog.js";
import { SchedulerService } from "../../services/scheduler.js";
import { GDriveAuthService, GDriveService } from "../../services/gdrive.client.js";
import { UsbBackupService, sanitizeSegment } from "../../services/usbBackup.client.js";
import { env } from "../../config/env.js";
import type { BackupSourceType, BackupTarget, BackupUploadSourceKind } from "@pwa-admin/shared";

async function sha256OfFile(path: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

export default async function backupRoutes(app: FastifyInstance) {
  const auth = { preHandler: (app as any).requireAuth };

  app.get("/backups/jobs", auth, async (_req, reply) => {
    reply.send(BackupJobModel.list().map(backupJobToApiShape));
  });

  app.get("/backups/bind-mounts", auth, async (_req, reply) => {
    reply.send(await BackupService.detectBindMounts());
  });

  app.get("/backups/volume-mounts", auth, async (_req, reply) => {
    reply.send(await BackupService.detectVolumeMounts());
  });

  // One-off backup/restore, no persisted job needed — used by the quick
  // "Sauvegarder"/"Restaurer" buttons directly on the Docker volumes list.
  app.post(
    "/backups/volumes/:name/run",
    {
      preHandler: [(app as any).requireAuth, withAudit("backup.volume.run", (r) => (r.params as any).name)],
      schema: {
        body: {
          type: "object",
          properties: {
            targets: { type: "array", items: { type: "string", enum: ["local", "gdrive", "usb"] } },
          },
        },
      },
    },
    async (req, reply) => {
      const { name } = req.params as { name: string };
      const { targets } = (req.body as { targets?: BackupTarget[] }) ?? {};
      try {
        const runId = await BackupService.backupVolume(name, targets && targets.length ? targets : ["local"]);
        reply.send({ runId });
      } catch (err) {
        reply.code(400).send({ error: (err as Error).message });
      }
    }
  );

  app.get("/backups/volumes/:name/history", auth, async (req, reply) => {
    const { name } = req.params as { name: string };
    const rows = BackupHistoryModel.list(500, 0).filter(
      (r) => r.source_type === "volume" && r.source_ref === name
    );
    reply.send(rows.map(backupHistoryToApiShape));
  });

  app.get("/backups/images/:containerName/history", auth, async (req, reply) => {
    const { containerName } = req.params as { containerName: string };
    const rows = BackupHistoryModel.list(500, 0).filter(
      (r) => r.source_type === "image" && r.source_ref === containerName
    );
    reply.send(rows.map(backupHistoryToApiShape));
  });

  app.post(
    "/backups/jobs",
    {
      preHandler: [(app as any).requireAuth, withAudit("backup.job.create")],
      schema: {
        body: {
          type: "object",
          required: ["name", "sourceType", "sourceRef", "targets"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 100 },
            sourceType: { type: "string", enum: ["volume", "db", "path"] },
            sourceRef: { type: "string", minLength: 1, maxLength: 200 },
            targets: { type: "array", items: { type: "string", enum: ["local", "gdrive", "usb"] } },
            scheduleCron: { type: "string" },
            retentionDays: { type: "number" },
            retentionMinCopies: { type: "number" },
          },
        },
      },
    },
    async (req, reply) => {
      const body = req.body as {
        name: string;
        sourceType: BackupSourceType;
        sourceRef: string;
        targets: BackupTarget[];
        scheduleCron?: string;
        retentionDays?: number;
        retentionMinCopies?: number;
      };

      if (body.sourceType === "path") {
        const mounts = await BackupService.detectBindMounts();
        if (!mounts.some((m) => m.hostPath === body.sourceRef)) {
          return reply.code(400).send({ error: "path_not_a_detected_bind_mount" });
        }
      }

      const job = BackupJobModel.create(body);
      if (body.scheduleCron) SchedulerService.registerBackupJob(job.id, body.scheduleCron);
      reply.send(backupJobToApiShape(job));
    }
  );

  app.put(
    "/backups/jobs/:id",
    { preHandler: [(app as any).requireAuth, withAudit("backup.job.update", (r) => (r.params as any).id)] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      BackupJobModel.update(Number(id), req.body as any);
      reply.send({ ok: true });
    }
  );

  app.delete(
    "/backups/jobs/:id",
    { preHandler: [(app as any).requireAuth, withAudit("backup.job.delete", (r) => (r.params as any).id)] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      SchedulerService.unregisterBackupJob(Number(id));
      BackupJobModel.delete(Number(id));
      reply.send({ ok: true });
    }
  );

  app.post(
    "/backups/jobs/:id/run",
    { preHandler: [(app as any).requireAuth, withAudit("backup.job.run", (r) => (r.params as any).id)] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const job = BackupJobModel.findById(Number(id));
      if (!job) return reply.code(404).send({ error: "job_not_found" });

      const targets = JSON.parse(job.targets) as BackupTarget[];
      if (job.source_type === "volume") {
        const runId = await BackupService.backupVolume(job.source_ref, targets);
        return reply.send({ runId });
      }
      if (job.source_type === "path") {
        const mounts = await BackupService.detectBindMounts();
        if (!mounts.some((m) => m.hostPath === job.source_ref)) {
          return reply.code(409).send({ error: "path_no_longer_a_detected_bind_mount" });
        }
        const runId = await BackupService.backupPath(job.source_ref, targets);
        return reply.send({ runId });
      }
      if (job.source_type === "db") {
        const [location, ref] = job.source_ref.split(":");
        if (location !== "docker" && location !== "native") {
          return reply.code(400).send({ error: "invalid_db_job_source_ref" });
        }
        const { DbBackupService } = await import("../dbbackup/dbbackup.service.js");
        const runId = await DbBackupService.dump(location, ref, targets);
        return reply.send({ runId });
      }
      return reply.code(400).send({ error: "unsupported_source_type" });
    }
  );

  app.get("/backups/history", auth, async (req, reply) => {
    const { limit, offset } = req.query as { limit?: string; offset?: string };
    const rows = BackupHistoryModel.list(limit ? Number(limit) : 100, offset ? Number(offset) : 0);
    reply.send(rows.map(backupHistoryToApiShape));
  });

  app.get("/backups/history/:runId", auth, async (req, reply) => {
    const { runId } = req.params as { runId: string };
    const entry = BackupHistoryModel.findByRunId(runId);
    if (!entry) return reply.code(404).send({ error: "not_found" });
    reply.send(backupHistoryToApiShape(entry));
  });

  // A plain <a href> download can't send an Authorization header, so a direct
  // browser navigation needs a short-lived scoped token instead — same
  // pattern as /docker/images/export/download-token.
  app.post(
    "/backups/history/:runId/download-token",
    auth,
    async (req, reply) => {
      const { runId } = req.params as { runId: string };
      const entry = BackupHistoryModel.findByRunId(runId);
      if (!entry?.file_path) return reply.code(404).send({ error: "not_found" });
      const token = app.jwt.sign({ downloadRunId: runId }, { expiresIn: "2m" });
      reply.send({ token });
    }
  );

  app.get("/backups/history/:runId/download", async (req, reply) => {
    const { runId } = req.params as { runId: string };
    const { token } = req.query as { token?: string };

    if (token) {
      let payload: { downloadRunId?: string };
      try {
        payload = app.jwt.verify(token);
      } catch {
        return reply.code(401).send({ error: "unauthorized" });
      }
      if (payload.downloadRunId !== runId) return reply.code(401).send({ error: "unauthorized" });
    } else {
      try {
        await (app as any).requireAuth(req, reply);
      } catch {
        return; // requireAuth already sent the 401 response
      }
    }

    const entry = BackupHistoryModel.findByRunId(runId);
    if (!entry?.file_path) return reply.code(404).send({ error: "not_found" });
    reply.header("Content-Disposition", `attachment; filename="${basename(entry.file_path)}"`);
    return reply.sendFile
      ? reply.sendFile(entry.file_path)
      : reply.send((await import("node:fs")).createReadStream(entry.file_path));
  });

  app.delete(
    "/backups/history/:runId",
    { preHandler: [(app as any).requireAuth, withAudit("backup.history.delete", (r) => (r.params as any).runId)] },
    async (req, reply) => {
      const { runId } = req.params as { runId: string };
      const entry = BackupHistoryModel.findByRunId(runId);
      if (!entry) return reply.code(404).send({ error: "not_found" });
      if (entry.status === "running") return reply.code(409).send({ error: "run_still_in_progress" });
      if (entry.file_path) await unlink(entry.file_path).catch(() => {});
      BackupHistoryModel.deleteByRunId(runId);
      reply.send({ ok: true });
    }
  );

  app.post(
    "/backups/restore",
    {
      preHandler: [(app as any).requireAuth, withAudit("backup.restore")],
      schema: {
        body: {
          type: "object",
          required: ["runId", "confirm"],
          properties: {
            runId: { type: "string" },
            targetVolume: { type: "string" },
            confirm: { type: "boolean", const: true },
          },
        },
      },
    },
    async (req, reply) => {
      const { runId, targetVolume } = req.body as { runId: string; targetVolume?: string };
      const entry = BackupHistoryModel.findByRunId(runId);
      if (!entry?.file_path) return reply.code(404).send({ error: "backup_not_found" });
      if (entry.source_type === "volume" && targetVolume) {
        await BackupService.restoreVolume(targetVolume, entry.file_path);
        return reply.send({ ok: true });
      }
      if (entry.source_type === "path") {
        const mounts = await BackupService.detectBindMounts();
        if (!mounts.some((m) => m.hostPath === entry.source_ref)) {
          return reply.code(409).send({ error: "path_no_longer_a_detected_bind_mount" });
        }
        await BackupService.restorePath(entry.source_ref, entry.file_path);
        return reply.send({ ok: true });
      }
      return reply.code(400).send({ error: "unsupported_restore_use_dbbackup_endpoint" });
    }
  );

  // Generic counterpart to /applications/:id/restore-image — for a
  // container-image backup reached from the general Restore flow (e.g. an
  // archive imported from USB) rather than from an Application's own image
  // history, where there's no application id to scope the request to.
  app.post(
    "/backups/restore-image",
    {
      preHandler: [(app as any).requireAuth, withAudit("backup.restore-image", (r) => (r.body as any)?.runId)],
      schema: {
        body: {
          type: "object",
          required: ["runId", "confirm"],
          properties: {
            runId: { type: "string" },
            confirm: { type: "boolean", const: true },
          },
        },
      },
    },
    async (req, reply) => {
      const { runId } = req.body as { runId: string };
      const entry = BackupHistoryModel.findByRunId(runId);
      if (!entry?.file_path || entry.source_type !== "image") {
        return reply.code(404).send({ error: "backup_not_found" });
      }
      await ApplicationService.restoreContainerImage(entry.source_ref, runId);
      reply.send({ ok: true });
    }
  );

  app.get("/backups/storage", auth, async (_req, reply) => {
    reply.send(await BackupService.storageUsage());
  });

  // --- External USB/SSD backup drive ---

  app.get("/backups/usb/status", auth, async (_req, reply) => {
    reply.send(await UsbBackupService.status());
  });

  app.get("/backups/usb/archives", auth, async (_req, reply) => {
    reply.send(await UsbBackupService.browseArchives());
  });

  // Designates a detected-but-unconfigured USB/SSD drive (e.g. just plugged
  // in) as a backup target by creating BACKUP/<hostname> on it. Deliberately
  // separate from detection: a drive merely being connected must never be
  // treated as a backup destination without this explicit opt-in — most
  // importantly the RPi's own rootfs, when it boots off an external USB/SSD,
  // must never be silently written to as if it were a backup drive.
  app.post(
    "/backups/usb/enable",
    {
      preHandler: [(app as any).requireAuth, withAudit("backup.usb-drive.enable")],
      schema: {
        body: { type: "object", required: ["mountpoint"], properties: { mountpoint: { type: "string" } } },
      },
    },
    async (req, reply) => {
      const { mountpoint } = req.body as { mountpoint: string };
      try {
        reply.send(await UsbBackupService.enableAsBackupDrive(mountpoint));
      } catch (err) {
        reply.code(400).send({ error: (err as Error).message });
      }
    }
  );

  // Uploads an archive from the admin's PC and registers it as a real
  // backup_history row (status "success", target "local") so it becomes
  // restorable through the existing /backups/restore and
  // /dbbackup/restore-by-run endpoints with zero new restore logic.
  app.post(
    "/backups/uploads",
    { preHandler: [(app as any).requireAuth, withAudit("backup.upload")] },
    async (req, reply) => {
      const file = await (req as any).file();
      if (!file) return reply.code(400).send({ error: "no_file_uploaded" });

      const fields = file.fields as Record<string, { value?: string } | undefined>;
      const sourceType = fields.sourceType?.value as BackupUploadSourceKind | undefined;
      const sourceRef = fields.sourceRef?.value;
      if (!sourceType || !["volume", "path", "db"].includes(sourceType)) {
        return reply.code(400).send({ error: "invalid_source_type" });
      }
      if (!sourceRef) return reply.code(400).send({ error: "source_ref_required" });

      const uploadId = randomUUID();
      const safeFileName = sanitizeSegment(file.filename.replace(/\.[^.]*$/, "")) +
        (file.filename.match(/\.[^.]*$/)?.[0] ?? "");
      const destDir = join(env.BACKUP_LOCAL_ROOT, "uploads", uploadId);
      await mkdir(destDir, { recursive: true });
      const destPath = join(destDir, safeFileName);

      try {
        await pipeline(file.file, createWriteStream(destPath));
        const stats = await stat(destPath);
        const checksum = await sha256OfFile(destPath);

        const runId = BackupHistoryModel.createRun({
          jobId: null,
          type: "backup",
          sourceType,
          sourceRef,
          target: "local",
        });
        BackupHistoryModel.complete(runId, {
          status: "success",
          filePath: destPath,
          sizeBytes: stats.size,
          checksumSha256: checksum,
        });

        reply.send({ runId, fileName: safeFileName, sizeBytes: stats.size });
      } catch (err) {
        await unlink(destPath).catch(() => {});
        reply.code(400).send({ error: (err as Error).message });
      }
    }
  );

  // Registers a USB-only archive (no backup_history row — e.g. found via
  // browseArchives after a fresh install) as a restorable run, reusing the
  // exact same restore code path unchanged.
  app.post(
    "/backups/usb/archives/import",
    {
      preHandler: [(app as any).requireAuth, withAudit("backup.usb-archive.import")],
      schema: {
        body: { type: "object", required: ["fullPath"], properties: { fullPath: { type: "string" } } },
      },
    },
    async (req, reply) => {
      const { fullPath } = req.body as { fullPath: string };
      const valid = await UsbBackupService.validateArchivePath(fullPath);
      if (!valid) return reply.code(400).send({ error: "path_outside_usb_backup_root" });

      const archives = await UsbBackupService.browseArchives();
      const archive = archives.find((a) => a.fullPath === fullPath);
      if (!archive) return reply.code(404).send({ error: "archive_not_found" });

      // Container image exports are also stored under the "paths" category
      // (see ApplicationService.backupContainerImage), tagged by the
      // "image-<containerName>" sourceRef prefix — distinguish them from
      // real bind-mount path backups, which restore through a completely
      // different code path (detectBindMounts guard vs. image load+swap).
      const isImageExport = archive.category === "paths" && archive.sourceRef.startsWith("image-");
      const sourceType: BackupSourceType = archive.category === "volumes"
        ? "volume"
        : archive.category === "db"
          ? "db"
          : isImageExport
            ? "image"
            : "path";
      const sourceRef = isImageExport ? archive.sourceRef.slice("image-".length) : archive.sourceRef;
      const stats = await stat(fullPath);

      const runId = BackupHistoryModel.createRun({
        jobId: null,
        type: "backup",
        sourceType,
        sourceRef,
        target: "usb",
      });
      BackupHistoryModel.complete(runId, {
        status: "success",
        filePath: fullPath,
        sizeBytes: stats.size,
        usbPath: fullPath,
      });

      reply.send({ runId });
    }
  );

  app.get("/backups/gdrive/compare", auth, async (_req, reply) => {
    try {
      reply.send(await BackupService.compareWithGDrive());
    } catch (err) {
      reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.delete(
    "/backups/gdrive/files/:fileId",
    { preHandler: [(app as any).requireAuth, withAudit("backup.gdrive.file.delete", (r) => (r.params as any).fileId)] },
    async (req, reply) => {
      const { fileId } = req.params as { fileId: string };
      try {
        await BackupService.deleteGDriveFile(fileId);
        reply.send({ ok: true });
      } catch (err) {
        reply.code(400).send({ error: (err as Error).message });
      }
    }
  );

  // --- Google Drive OAuth2 authorization (one-time setup) ---

  app.get("/backups/gdrive/status", auth, async (_req, reply) => {
    reply.send({
      enabled: env.GDRIVE_ENABLED,
      configured: !!(env.GDRIVE_OAUTH_CLIENT_ID && env.GDRIVE_OAUTH_CLIENT_SECRET),
      authorized: GDriveAuthService.isAuthorized(),
      rootFolderId: env.GDRIVE_ROOT_FOLDER_ID || null,
    });
  });

  app.get("/backups/gdrive/auth-url", auth, async (_req, reply) => {
    try {
      reply.send({ url: GDriveAuthService.getAuthUrl() });
    } catch (err) {
      reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post(
    "/backups/gdrive/authorize",
    {
      preHandler: [(app as any).requireAuth, withAudit("backup.gdrive.authorize")],
      schema: {
        body: { type: "object", required: ["code"], properties: { code: { type: "string", minLength: 1 } } },
      },
    },
    async (req, reply) => {
      const { code } = req.body as { code: string };
      try {
        await GDriveAuthService.exchangeCode(code);
        reply.send({ ok: true });
      } catch (err) {
        reply.code(400).send({ error: (err as Error).message });
      }
    }
  );

  app.post(
    "/backups/gdrive/revoke",
    { preHandler: [(app as any).requireAuth, withAudit("backup.gdrive.revoke")] },
    async (_req, reply) => {
      await GDriveAuthService.revoke();
      reply.send({ ok: true });
    }
  );

  app.post(
    "/backups/gdrive/test-upload",
    { preHandler: [(app as any).requireAuth, withAudit("backup.gdrive.test")] },
    async (_req, reply) => {
      const { writeFile, mkdir, rm } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const testDir = join(env.BACKUP_LOCAL_ROOT, "_gdrive-test");
      await mkdir(testDir, { recursive: true });
      const testFile = join(testDir, `connectivity-test-${Date.now()}.txt`);
      await writeFile(testFile, `Server Admin GDrive connectivity test — ${new Date().toISOString()}`);
      try {
        const uploaded = await GDriveService.uploadBackupFile(testFile, "volumes", "_connectivity-test");
        reply.send({ ok: true, fileId: uploaded.fileId });
      } catch (err) {
        reply.code(400).send({ error: (err as Error).message });
      } finally {
        await rm(testFile, { force: true });
      }
    }
  );
}
