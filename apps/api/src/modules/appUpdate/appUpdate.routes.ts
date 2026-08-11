import type { FastifyInstance } from "fastify";
import { AppUpdateService } from "./appUpdate.service.js";
import { withAudit } from "../../middleware/auditLog.js";

export default async function appUpdateRoutes(app: FastifyInstance) {
  const auth = { preHandler: (app as any).requireAuth };

  app.get("/app-update/status", auth, async (_req, reply) => {
    reply.send(await AppUpdateService.getStatus());
  });

  app.post(
    "/app-update/check",
    { preHandler: [(app as any).requireAuth, withAudit("app.update.check")] },
    async (_req, reply) => {
      try {
        await AppUpdateService.start();
        reply.send(await AppUpdateService.getStatus());
      } catch (err) {
        reply.code(409).send({ error: (err as Error).message });
      }
    }
  );
}
