import type { FastifyInstance } from "fastify";
import { DbBackupService } from "./dbbackup.service.js";
import { BackupHistoryModel } from "../../db/models/backup.js";
import { withAudit } from "../../middleware/auditLog.js";
import type { BackupTarget } from "@pwa-admin/shared";

export default async function dbBackupRoutes(app: FastifyInstance) {
  const auth = { preHandler: (app as any).requireAuth };

  app.get("/dbbackup/detect", auth, async (_req, reply) => {
    reply.send(await DbBackupService.detect());
  });

  app.post(
    "/dbbackup/:location/:ref/dump",
    {
      preHandler: [
        (app as any).requireAuth,
        withAudit("dbbackup.dump", (r) => `${(r.params as any).location}:${(r.params as any).ref}`),
      ],
      schema: {
        params: {
          type: "object",
          properties: { location: { type: "string", enum: ["docker", "native"] } },
        },
        body: {
          type: "object",
          properties: {
            targets: { type: "array", items: { type: "string", enum: ["local", "gdrive", "usb"] } },
          },
        },
      },
    },
    async (req, reply) => {
      const { location, ref } = req.params as { location: "docker" | "native"; ref: string };
      const { targets } = (req.body as { targets?: BackupTarget[] }) ?? {};
      const runId = await DbBackupService.dump(location, ref, targets ?? ["local"]);
      reply.send({ runId });
    }
  );

  app.post(
    "/dbbackup/:location/:ref/restore",
    {
      preHandler: [
        (app as any).requireAuth,
        withAudit("dbbackup.restore", (r) => `${(r.params as any).location}:${(r.params as any).ref}`),
      ],
      schema: {
        params: {
          type: "object",
          properties: { location: { type: "string", enum: ["docker", "native"] } },
        },
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
      const { location, ref } = req.params as { location: "docker" | "native"; ref: string };
      const { runId } = req.body as { runId: string };
      await DbBackupService.restore(location, ref, runId);
      reply.send({ ok: true });
    }
  );

  // Restore entry point for the generic Backups history UI, which only has the
  // run's historical sourceRef (a display name) to go on. Resolves it back to a
  // live location+ref before delegating to the same restore logic above.
  app.post(
    "/dbbackup/restore-by-run",
    {
      preHandler: [(app as any).requireAuth, withAudit("dbbackup.restore", (r) => (r.body as any)?.runId)],
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
      const run = BackupHistoryModel.findByRunId(runId);
      if (!run) return reply.code(404).send({ error: "backup_not_found" });

      const resolved = await DbBackupService.resolveSourceRef(run.source_ref);
      if (!resolved) {
        return reply.code(409).send({
          error: "source_no_longer_detected",
          message: "La base source n'est plus détectée (conteneur/service arrêté ou renommé) — restauration impossible automatiquement.",
        });
      }

      await DbBackupService.restore(resolved.location, resolved.ref, runId);
      reply.send({ ok: true });
    }
  );
}
