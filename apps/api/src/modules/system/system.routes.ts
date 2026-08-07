import type { FastifyInstance } from "fastify";
import { SystemService } from "./system.service.js";

export default async function systemRoutes(app: FastifyInstance) {
  app.get("/system/stats", { preHandler: (app as any).requireAuth }, async (_request, reply) => {
    const snapshot = await SystemService.getSnapshot();
    return reply.send(snapshot);
  });

  app.get("/system/alerts", { preHandler: (app as any).requireAuth }, async (_request, reply) => {
    const snapshot = await SystemService.getSnapshot();
    const alerts = SystemService.evaluateAlerts(snapshot);
    return reply.send({ alerts });
  });
}
