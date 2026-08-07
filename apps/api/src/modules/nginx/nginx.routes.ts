import type { FastifyInstance } from "fastify";
import { NginxService } from "./nginx.service.js";
import { withAudit } from "../../middleware/auditLog.js";

export default async function nginxRoutes(app: FastifyInstance) {
  const auth = { preHandler: (app as any).requireAuth };

  app.get("/nginx/status", auth, async (_req, reply) => {
    reply.send(await NginxService.getStatus());
  });

  app.get("/nginx/vhosts", auth, async (_req, reply) => {
    reply.send(await NginxService.listVhosts());
  });

  app.get("/nginx/vhosts/:name", auth, async (req, reply) => {
    const { name } = req.params as { name: string };
    try {
      reply.send(await NginxService.getVhostDetail(name));
    } catch (err) {
      reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post(
    "/nginx/vhosts/:name/enable",
    { preHandler: [(app as any).requireAuth, withAudit("nginx.vhost.enable", (r) => (r.params as any).name)] },
    async (req, reply) => {
      const { name } = req.params as { name: string };
      try {
        await NginxService.enableVhost(name);
        reply.send({ ok: true });
      } catch (err) {
        reply.code(400).send({ error: (err as Error).message });
      }
    }
  );

  app.post(
    "/nginx/vhosts/:name/disable",
    { preHandler: [(app as any).requireAuth, withAudit("nginx.vhost.disable", (r) => (r.params as any).name)] },
    async (req, reply) => {
      const { name } = req.params as { name: string };
      try {
        await NginxService.disableVhost(name);
        reply.send({ ok: true });
      } catch (err) {
        reply.code(400).send({ error: (err as Error).message });
      }
    }
  );

  app.put(
    "/nginx/vhosts/:name/config",
    {
      preHandler: [(app as any).requireAuth, withAudit("nginx.vhost.config.write", (r) => (r.params as any).name)],
      schema: {
        body: {
          type: "object",
          required: ["content"],
          properties: { content: { type: "string", maxLength: 200000 } },
        },
      },
    },
    async (req, reply) => {
      const { name } = req.params as { name: string };
      const { content } = req.body as { content: string };
      try {
        await NginxService.writeVhostConfig(name, content);
        reply.send({ ok: true });
      } catch (err) {
        reply.code(400).send({ error: (err as Error).message });
      }
    }
  );

  app.get("/nginx/vhosts/:name/history", auth, async (req, reply) => {
    const { name } = req.params as { name: string };
    reply.send(await NginxService.listVhostHistory(name));
  });

  app.post(
    "/nginx/vhosts/:name/history/:snapshotId/restore",
    {
      preHandler: [
        (app as any).requireAuth,
        withAudit("nginx.vhost.config.restore", (r) => (r.params as any).name),
      ],
    },
    async (req, reply) => {
      const { name, snapshotId } = req.params as { name: string; snapshotId: string };
      try {
        await NginxService.restoreSnapshot(name, Number(snapshotId));
        reply.send({ ok: true });
      } catch (err) {
        reply.code(400).send({ error: (err as Error).message });
      }
    }
  );

  app.post(
    "/nginx/reload",
    { preHandler: [(app as any).requireAuth, withAudit("nginx.reload")] },
    async (_req, reply) => {
      const test = await NginxService.testConfig();
      if (!test.ok) return reply.code(400).send({ error: "config_invalid", output: test.output });
      await NginxService.reload();
      reply.send({ ok: true });
    }
  );

  app.post(
    "/nginx/restart",
    {
      preHandler: [(app as any).requireAuth, withAudit("nginx.restart")],
      schema: {
        body: {
          type: "object",
          required: ["confirm"],
          properties: { confirm: { type: "boolean", const: true } },
        },
      },
    },
    async (_req, reply) => {
      await NginxService.restart();
      reply.send({ ok: true });
    }
  );

  app.get("/nginx/vhosts/:name/logs", auth, async (req, reply) => {
    const { name } = req.params as { name: string };
    const { type, tail } = req.query as { type?: "access" | "error"; tail?: string };
    const logs = await NginxService.getVhostLogs(name, type ?? "error", tail ? Number(tail) : 200);
    reply.type("text/plain").send(logs);
  });

  app.get("/nginx/vhosts/:name/cert", auth, async (req, reply) => {
    const { name } = req.params as { name: string };
    reply.send(await NginxService.getCertStatus(name));
  });

  app.get("/nginx/vhosts/:name/accessibility", auth, async (req, reply) => {
    const { name } = req.params as { name: string };
    try {
      reply.send(await NginxService.checkAccessibility(name));
    } catch (err) {
      reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.get("/nginx/vhosts/:name/errors", auth, async (req, reply) => {
    const { name } = req.params as { name: string };
    const { window, limit } = req.query as { window?: string; limit?: string };
    try {
      reply.send(await NginxService.getVhostErrors(name, window ? Number(window) : 24, limit ? Number(limit) : 50));
    } catch (err) {
      reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post(
    "/nginx/config/backup",
    {
      preHandler: [(app as any).requireAuth, withAudit("nginx.config.backup")],
      schema: {
        body: {
          type: "object",
          properties: {
            targets: { type: "array", items: { type: "string", enum: ["local", "gdrive"] } },
          },
        },
      },
    },
    async (req, reply) => {
      const { targets } = (req.body as { targets?: ("local" | "gdrive")[] }) ?? {};
      const run = await NginxService.backupConfig(targets && targets.length ? targets : ["local"]);
      reply.send(run);
    }
  );
}
