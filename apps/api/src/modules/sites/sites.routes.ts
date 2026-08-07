import type { FastifyInstance } from "fastify";
import { SitesService } from "./sites.service.js";
import { NginxService } from "../nginx/nginx.service.js";
import { withAudit } from "../../middleware/auditLog.js";

export default async function sitesRoutes(app: FastifyInstance) {
  const auth = { preHandler: (app as any).requireAuth };

  app.get("/sites", auth, async (_req, reply) => {
    reply.send(await SitesService.listSites());
  });

  app.get("/sites/:name", auth, async (req, reply) => {
    const { name } = req.params as { name: string };
    reply.send(await SitesService.getSiteDetail(name));
  });

  app.post(
    "/sites/:name/enable",
    { preHandler: [(app as any).requireAuth, withAudit("sites.enable", (r) => (r.params as any).name)] },
    async (req, reply) => {
      const { name } = req.params as { name: string };
      await NginxService.enableVhost(name);
      reply.send({ ok: true });
    }
  );

  app.post(
    "/sites/:name/disable",
    { preHandler: [(app as any).requireAuth, withAudit("sites.disable", (r) => (r.params as any).name)] },
    async (req, reply) => {
      const { name } = req.params as { name: string };
      await NginxService.disableVhost(name);
      reply.send({ ok: true });
    }
  );

  app.post(
    "/sites/:name/maintenance/enable",
    { preHandler: [(app as any).requireAuth, withAudit("sites.maintenance.enable", (r) => (r.params as any).name)] },
    async (req, reply) => {
      const { name } = req.params as { name: string };
      try {
        await NginxService.enableMaintenance(name);
        reply.send({ ok: true });
      } catch (err) {
        reply.code(400).send({ error: (err as Error).message });
      }
    }
  );

  app.post(
    "/sites/:name/maintenance/disable",
    { preHandler: [(app as any).requireAuth, withAudit("sites.maintenance.disable", (r) => (r.params as any).name)] },
    async (req, reply) => {
      const { name } = req.params as { name: string };
      try {
        await NginxService.disableMaintenance(name);
        reply.send({ ok: true });
      } catch (err) {
        reply.code(400).send({ error: (err as Error).message });
      }
    }
  );

  app.get("/sites/:name/logs", auth, async (req, reply) => {
    const { name } = req.params as { name: string };
    const { type, tail } = req.query as { type?: "access" | "error"; tail?: string };
    const logs = await NginxService.getVhostLogs(name, type ?? "error", tail ? Number(tail) : 200);
    reply.type("text/plain").send(logs);
  });
}
