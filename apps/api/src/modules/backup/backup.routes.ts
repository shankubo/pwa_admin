import type { FastifyInstance } from "fastify";
import { BackupService, BackupJobModel, BackupHistoryModel } from "./backup.service.js";
import { backupJobToApiShape, backupHistoryToApiShape } from "../../db/models/backup.js";
import { withAudit } from "../../middleware/auditLog.js";
import { SchedulerService } from "../../services/scheduler.js";
import { GDriveAuthService, GDriveService } from "../../services/gdrive.client.js";
import { UsbBackupService } from "../../services/usbBackup.client.js";
import { env } from "../../config/env.js";
import type { BackupSourceType, BackupTarget } from "@pwa-admin/shared";

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

  app.get("/backups/history/:runId/download", auth, async (req, reply) => {
    const { runId } = req.params as { runId: string };
    const entry = BackupHistoryModel.findByRunId(runId);
    if (!entry?.file_path) return reply.code(404).send({ error: "not_found" });
    return reply.sendFile
      ? reply.sendFile(entry.file_path)
      : reply.send((await import("node:fs")).createReadStream(entry.file_path));
  });

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
