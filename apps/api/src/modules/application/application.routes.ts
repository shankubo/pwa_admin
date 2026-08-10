import type { FastifyInstance } from "fastify";
import { ApplicationService, ApplicationModel } from "./application.service.js";
import { applicationToApiShape, appBackupRunToApiShape, AppBackupRunModel } from "../../db/models/application.js";
import { BackupService } from "../backup/backup.service.js";
import { DockerService } from "../docker/docker.service.js";
import { withAudit } from "../../middleware/auditLog.js";
import { SchedulerService } from "../../services/scheduler.js";
import type { AppBackupRunKind, BackupTarget } from "@pwa-admin/shared";

export default async function applicationRoutes(app: FastifyInstance) {
  const auth = { preHandler: (app as any).requireAuth };

  app.get("/applications", auth, async (_req, reply) => {
    reply.send(ApplicationModel.list().map(applicationToApiShape));
  });

  app.post(
    "/applications",
    {
      preHandler: [(app as any).requireAuth, withAudit("application.create")],
      schema: {
        body: {
          type: "object",
          required: ["name", "containerNames", "paths", "targets"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 100 },
            containerNames: { type: "array", items: { type: "string" } },
            paths: { type: "array", items: { type: "string" } },
            volumeNames: { type: "array", items: { type: "string" } },
            dbLocation: { type: "string", enum: ["docker", "native"] },
            dbRef: { type: "string" },
            targets: { type: "array", items: { type: "string", enum: ["local", "gdrive", "usb"] } },
            scheduleFullCron: { type: "string" },
            schedulePartialCron: { type: "string" },
            retentionDays: { type: "number" },
            retentionMinCopies: { type: "number" },
          },
        },
      },
    },
    async (req, reply) => {
      const body = req.body as {
        name: string;
        containerNames: string[];
        paths: string[];
        volumeNames?: string[];
        dbLocation?: "docker" | "native";
        dbRef?: string;
        targets: BackupTarget[];
        scheduleFullCron?: string;
        schedulePartialCron?: string;
        retentionDays?: number;
        retentionMinCopies?: number;
      };
      const volumeNames = body.volumeNames ?? [];

      if (body.paths.length === 0 && volumeNames.length === 0 && !body.dbLocation) {
        return reply.code(400).send({ error: "at_least_one_path_volume_or_database_required" });
      }

      // Every path must be a currently-detected bind mount — never an arbitrary
      // admin-typed filesystem path.
      const mounts = await BackupService.detectBindMounts();
      const validPaths = new Set(mounts.map((m) => m.hostPath));
      const invalid = body.paths.filter((p) => !validPaths.has(p));
      if (invalid.length > 0) {
        return reply.code(400).send({ error: "paths_not_detected_bind_mounts", invalid });
      }

      // Same guard for volumes — must match a currently-existing named Docker volume.
      const volumes = await DockerService.listVolumes();
      const validVolumes = new Set(volumes.map((v) => v.name));
      const invalidVolumes = volumeNames.filter((v) => !validVolumes.has(v));
      if (invalidVolumes.length > 0) {
        return reply.code(400).send({ error: "volumes_not_detected", invalid: invalidVolumes });
      }

      let created;
      try {
        created = ApplicationModel.create(body);
      } catch (err) {
        if ((err as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") {
          return reply.code(409).send({ error: "application_name_already_exists" });
        }
        throw err;
      }
      if (body.scheduleFullCron) {
        SchedulerService.registerAppBackup(created.id, "full", body.scheduleFullCron);
      }
      if (body.schedulePartialCron) {
        SchedulerService.registerAppBackup(created.id, "partial", body.schedulePartialCron);
      }
      reply.send(applicationToApiShape(created));
    }
  );

  app.put(
    "/applications/:id",
    { preHandler: [(app as any).requireAuth, withAudit("application.update", (r) => (r.params as any).id)] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      ApplicationModel.update(Number(id), req.body as any);
      const updated = ApplicationModel.findById(Number(id));
      if (updated) {
        SchedulerService.unregisterAppBackup(Number(id), "full");
        SchedulerService.unregisterAppBackup(Number(id), "partial");
        if (updated.schedule_full_cron) SchedulerService.registerAppBackup(updated.id, "full", updated.schedule_full_cron);
        if (updated.schedule_partial_cron)
          SchedulerService.registerAppBackup(updated.id, "partial", updated.schedule_partial_cron);
      }
      reply.send({ ok: true });
    }
  );

  app.delete(
    "/applications/:id",
    { preHandler: [(app as any).requireAuth, withAudit("application.delete", (r) => (r.params as any).id)] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      SchedulerService.unregisterAppBackup(Number(id), "full");
      SchedulerService.unregisterAppBackup(Number(id), "partial");
      ApplicationModel.delete(Number(id));
      reply.send({ ok: true });
    }
  );

  app.post(
    "/applications/:id/backup",
    {
      preHandler: [(app as any).requireAuth, withAudit("application.backup.run", (r) => (r.params as any).id)],
      schema: {
        body: {
          type: "object",
          properties: { kind: { type: "string", enum: ["full", "partial"] } },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const application = ApplicationModel.findById(Number(id));
      if (!application) return reply.code(404).send({ error: "application_not_found" });

      const { kind } = (req.body as { kind?: AppBackupRunKind }) ?? {};
      const runId = await ApplicationService.runBackup(application, kind ?? "full");
      reply.send({ runId });
    }
  );

  app.get("/applications/:id/runs", auth, async (req, reply) => {
    const { id } = req.params as { id: string };
    reply.send(AppBackupRunModel.listByApp(Number(id)).map(appBackupRunToApiShape));
  });

  app.get("/applications/runs/all", auth, async (_req, reply) => {
    reply.send(AppBackupRunModel.list().map(appBackupRunToApiShape));
  });

  app.get("/applications/runs/:runId", auth, async (req, reply) => {
    const { runId } = req.params as { runId: string };
    const run = AppBackupRunModel.findByRunId(runId);
    if (!run) return reply.code(404).send({ error: "not_found" });
    reply.send(appBackupRunToApiShape(run));
  });

  app.post(
    "/applications/:id/restore",
    {
      preHandler: [(app as any).requireAuth, withAudit("application.restore", (r) => (r.params as any).id)],
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
      const { id } = req.params as { id: string };
      const { runId } = req.body as { runId: string };
      const application = ApplicationModel.findById(Number(id));
      if (!application) return reply.code(404).send({ error: "application_not_found" });

      await ApplicationService.restore(application, runId);
      reply.send({ ok: true });
    }
  );
}
