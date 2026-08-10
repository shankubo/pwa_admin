import type { FastifyInstance } from "fastify";
import { ServicesService } from "./services.service.js";
import { withAudit } from "../../middleware/auditLog.js";

const CONFIRM_SCHEMA = {
  body: { type: "object", required: ["confirm"], properties: { confirm: { type: "boolean", const: true } } },
};

export default async function servicesRoutes(app: FastifyInstance) {
  const auth = { preHandler: (app as any).requireAuth };

  app.get("/services/overview", auth, async (_req, reply) => {
    reply.send(await ServicesService.getOverview());
  });

  app.post(
    "/services/tailscale/update",
    { preHandler: [(app as any).requireAuth, withAudit("services.tailscale.update")], schema: CONFIRM_SCHEMA },
    async (_req, reply) => {
      reply.send(await ServicesService.updateTailscale());
    }
  );

  app.post(
    "/services/docker/update",
    { preHandler: [(app as any).requireAuth, withAudit("services.docker.update")], schema: CONFIRM_SCHEMA },
    async (_req, reply) => {
      reply.send(await ServicesService.updateDocker());
    }
  );

  app.post(
    "/services/docker/restart",
    { preHandler: [(app as any).requireAuth, withAudit("services.docker.restart")], schema: CONFIRM_SCHEMA },
    async (_req, reply) => {
      reply.send(await ServicesService.restartDockerService());
    }
  );

  app.post(
    "/services/pm2/reload-daemon",
    { preHandler: [(app as any).requireAuth, withAudit("services.pm2.reload")], schema: CONFIRM_SCHEMA },
    async (_req, reply) => {
      reply.send(await ServicesService.reloadPm2Daemon());
    }
  );
}
