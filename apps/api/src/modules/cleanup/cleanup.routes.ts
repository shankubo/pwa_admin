import type { FastifyInstance } from "fastify";
import type { CleanupCategoryId } from "@pwa-admin/shared";
import { CleanupService } from "./cleanup.service.js";
import { withAudit } from "../../middleware/auditLog.js";

const CATEGORY_IDS: CleanupCategoryId[] = [
  "apt-cache",
  "journal",
  "docker-dangling-images",
  "docker-build-cache",
  "npm-cache",
  "app-temp",
  "tmp-owned",
  "old-backups",
];

export default async function cleanupRoutes(app: FastifyInstance) {
  const requireAuth = (app as any).requireAuth;

  // Read-only: measures what could be freed, removes nothing.
  app.get(
    "/cleanup/scan",
    {
      preHandler: requireAuth,
      schema: {
        querystring: { type: "object", properties: { backupDays: { type: "integer", minimum: 7, maximum: 3650 } } },
      },
    },
    async (req, reply) => {
      const { backupDays } = req.query as { backupDays?: number };
      try {
        reply.send(await CleanupService.scan(backupDays ?? 30));
      } catch (err) {
        reply.code(500).send({ error: (err as Error).message });
      }
    }
  );

  // Irreversible: needs the confirm flag, only acts on categories from a closed list,
  // and the service re-derives every file itself instead of trusting client paths.
  app.post(
    "/cleanup/run",
    {
      preHandler: [
        requireAuth,
        withAudit("cleanup.run", (r) => ((r.body as { categories?: string[] } | undefined)?.categories ?? []).join(",")),
      ],
      schema: {
        body: {
          type: "object",
          required: ["categories", "confirm"],
          properties: {
            categories: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", enum: CATEGORY_IDS } },
            backupDays: { type: "integer", minimum: 7, maximum: 3650 },
            confirm: { type: "boolean", const: true },
          },
        },
      },
    },
    async (req, reply) => {
      const { categories, backupDays } = req.body as { categories: CleanupCategoryId[]; backupDays?: number };
      try {
        reply.send(await CleanupService.run(categories, backupDays ?? 30));
      } catch (err) {
        const code = (err as Error).message;
        reply.code(code === "cleanup_already_running" ? 409 : 500).send({ error: code });
      }
    }
  );
}
