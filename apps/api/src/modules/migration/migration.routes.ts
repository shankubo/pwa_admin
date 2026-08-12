import type { FastifyInstance } from "fastify";
import { MigrationService } from "./migration.service.js";
import { migrationSnapshotToApiShape, migrationRestoreToApiShape } from "../../db/models/migration.js";
import { withAudit } from "../../middleware/auditLog.js";

export default async function migrationRoutes(app: FastifyInstance) {
  const auth = { preHandler: (app as any).requireAuth };

  app.post(
    "/migration/snapshot",
    {
      preHandler: [(app as any).requireAuth, withAudit("migration.snapshot.start")],
      schema: {
        body: {
          type: "object",
          required: ["confirm"],
          properties: { confirm: { type: "boolean", const: true } },
        },
      },
    },
    async (_req, reply) => {
      const result = await MigrationService.captureSnapshot();
      reply.send(result);
    }
  );

  app.post(
    "/migration/snapshot/site/:name",
    {
      preHandler: [(app as any).requireAuth, withAudit("migration.snapshot.site.start", (r) => (r.params as any).name)],
      schema: {
        body: {
          type: "object",
          required: ["confirm"],
          properties: { confirm: { type: "boolean", const: true } },
        },
      },
    },
    async (req, reply) => {
      const { name } = req.params as { name: string };
      const result = await MigrationService.captureSiteSnapshot(name);
      reply.send(result);
    }
  );

  app.get("/migration/snapshot/:manifestId", auth, async (req, reply) => {
    const { manifestId } = req.params as { manifestId: string };
    const run = MigrationService.getSnapshotStatus(manifestId);
    if (!run) return reply.code(404).send({ error: "not_found" });
    reply.send(migrationSnapshotToApiShape(run));
  });

  app.get("/migration/snapshots", auth, async (_req, reply) => {
    reply.send(MigrationService.listSnapshots().map(migrationSnapshotToApiShape));
  });

  app.get("/migration/manifests", auth, async (_req, reply) => {
    reply.send(await MigrationService.listManifestsOnUsb());
  });

  app.post(
    "/migration/restore",
    {
      preHandler: [(app as any).requireAuth, withAudit("migration.restore.start", (r) => (r.body as any)?.manifestId)],
      schema: {
        body: {
          type: "object",
          required: ["manifestId", "confirm"],
          properties: {
            manifestId: { type: "string" },
            includeOsPackages: { type: "boolean" },
            excludedLabels: { type: "array", items: { type: "string" } },
            selectedPackageNames: { type: "array", items: { type: "string" } },
            confirm: { type: "boolean", const: true },
          },
        },
      },
    },
    async (req, reply) => {
      const { manifestId, includeOsPackages, excludedLabels, selectedPackageNames } = req.body as {
        manifestId: string;
        includeOsPackages?: boolean;
        excludedLabels?: string[];
        selectedPackageNames?: string[];
      };
      try {
        const result = await MigrationService.restoreFromManifest(manifestId, {
          includeOsPackages: includeOsPackages ?? false,
          excludedLabels,
          selectedPackageNames,
        });
        reply.send(result);
      } catch (err) {
        reply.code(400).send({ error: (err as Error).message });
      }
    }
  );

  app.get("/migration/restore/plan/:manifestId", auth, async (req, reply) => {
    const { manifestId } = req.params as { manifestId: string };
    try {
      reply.send(await MigrationService.planRestore(manifestId));
    } catch (err) {
      reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.get("/migration/restore/:restoreId", auth, async (req, reply) => {
    const { restoreId } = req.params as { restoreId: string };
    const run = MigrationService.getRestoreStatus(restoreId);
    if (!run) return reply.code(404).send({ error: "not_found" });
    reply.send(migrationRestoreToApiShape(run));
  });

  app.get("/migration/restores", auth, async (_req, reply) => {
    reply.send(MigrationService.listRestores().map(migrationRestoreToApiShape));
  });
}
