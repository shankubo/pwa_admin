import type { FastifyInstance } from "fastify";
import { AuditLogModel } from "../../db/models/auditLog.js";

export default async function auditRoutes(app: FastifyInstance) {
  app.get("/audit", { preHandler: (app as any).requireAuth }, async (req, reply) => {
    const { limit, offset } = req.query as { limit?: string; offset?: string };
    reply.send(AuditLogModel.list(limit ? Number(limit) : 100, offset ? Number(offset) : 0));
  });
}
