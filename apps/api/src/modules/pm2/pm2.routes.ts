import type { FastifyInstance } from "fastify";
import { Pm2Service } from "./pm2.service.js";
import { withAudit } from "../../middleware/auditLog.js";

export default async function pm2Routes(app: FastifyInstance) {
  const auth = { preHandler: (app as any).requireAuth };

  app.get("/pm2/processes", auth, async (_req, reply) => {
    reply.send(await Pm2Service.list());
  });

  app.post(
    "/pm2/processes/:name/start",
    { preHandler: [(app as any).requireAuth, withAudit("pm2.start", (r) => (r.params as any).name)] },
    async (req, reply) => {
      const { name } = req.params as { name: string };
      try {
        await Pm2Service.start(name);
        reply.send({ ok: true });
      } catch (err) {
        reply.code(400).send({ error: (err as Error).message });
      }
    }
  );

  app.post(
    "/pm2/processes/:name/stop",
    { preHandler: [(app as any).requireAuth, withAudit("pm2.stop", (r) => (r.params as any).name)] },
    async (req, reply) => {
      const { name } = req.params as { name: string };
      try {
        await Pm2Service.stop(name);
        reply.send({ ok: true });
      } catch (err) {
        reply.code(400).send({ error: (err as Error).message });
      }
    }
  );

  app.post(
    "/pm2/processes/:name/restart",
    { preHandler: [(app as any).requireAuth, withAudit("pm2.restart", (r) => (r.params as any).name)] },
    async (req, reply) => {
      const { name } = req.params as { name: string };
      try {
        await Pm2Service.restart(name);
        reply.send({ ok: true });
      } catch (err) {
        reply.code(400).send({ error: (err as Error).message });
      }
    }
  );

  app.post(
    "/pm2/processes/:name/reload",
    { preHandler: [(app as any).requireAuth, withAudit("pm2.reload", (r) => (r.params as any).name)] },
    async (req, reply) => {
      const { name } = req.params as { name: string };
      try {
        await Pm2Service.reload(name);
        reply.send({ ok: true });
      } catch (err) {
        reply.code(400).send({ error: (err as Error).message });
      }
    }
  );

  app.get("/pm2/processes/:name/logs", auth, async (req, reply) => {
    const { name } = req.params as { name: string };
    const { lines } = req.query as { lines?: string };
    try {
      const logs = await Pm2Service.getLogs(name, lines ? Number(lines) : 200);
      reply.type("text/plain").send(logs);
    } catch (err) {
      reply.code(400).send({ error: (err as Error).message });
    }
  });
}
