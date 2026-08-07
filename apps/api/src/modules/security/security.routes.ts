import type { FastifyInstance } from "fastify";
import { SecurityService } from "./security.service.js";

export default async function securityRoutes(app: FastifyInstance) {
  const auth = { preHandler: (app as any).requireAuth };

  app.get("/security/overview", auth, async (_req, reply) => {
    reply.send(await SecurityService.getOverview());
  });
}
