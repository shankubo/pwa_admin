import type { FastifyInstance } from "fastify";
import { SitesService } from "./sites.service.js";
import { SiteDuplicateService } from "./siteDuplicate.service.js";
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

  app.get("/sites/:name/duplicate", auth, async (req, reply) => {
    const { name } = req.params as { name: string };
    reply.send(await SiteDuplicateService.getDuplicateStatus(name));
  });

  app.post(
    "/sites/:name/duplicate",
    {
      preHandler: [(app as any).requireAuth, withAudit("sites.duplicate.create", (r) => (r.params as any).name)],
      schema: {
        body: {
          type: "object",
          properties: {
            dbLocation: { type: "string", enum: ["docker", "native"] },
            dbRef: { type: "string" },
            dbName: { type: "string", maxLength: 64 },
          },
        },
      },
    },
    async (req, reply) => {
      const { name } = req.params as { name: string };
      const body = req.body as { dbLocation?: "docker" | "native"; dbRef?: string; dbName?: string };
      try {
        reply.send(await SiteDuplicateService.createDuplicate(name, body));
      } catch (err) {
        reply.code(400).send({ error: (err as Error).message });
      }
    }
  );

  app.delete(
    "/sites/:name/duplicate",
    { preHandler: [(app as any).requireAuth, withAudit("sites.duplicate.delete", (r) => (r.params as any).name)] },
    async (req, reply) => {
      const { name } = req.params as { name: string };
      try {
        await SiteDuplicateService.deleteDuplicate(name);
        reply.send({ ok: true });
      } catch (err) {
        reply.code(400).send({ error: (err as Error).message });
      }
    }
  );

  app.post(
    "/sites/:name/failover/switch",
    { preHandler: [(app as any).requireAuth, withAudit("sites.failover.switch", (r) => (r.params as any).name)] },
    async (req, reply) => {
      const { name } = req.params as { name: string };
      try {
        await NginxService.switchToDuplicate(name);
        reply.send({ ok: true });
      } catch (err) {
        reply.code(400).send({ error: (err as Error).message });
      }
    }
  );

  app.post(
    "/sites/:name/failover/revert",
    { preHandler: [(app as any).requireAuth, withAudit("sites.failover.revert", (r) => (r.params as any).name)] },
    async (req, reply) => {
      const { name } = req.params as { name: string };
      try {
        await NginxService.switchToPrimary(name);
        reply.send({ ok: true });
      } catch (err) {
        reply.code(400).send({ error: (err as Error).message });
      }
    }
  );
}
