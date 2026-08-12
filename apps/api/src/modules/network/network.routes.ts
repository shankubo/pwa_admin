import type { FastifyInstance } from "fastify";
import { NetworkService } from "./network.service.js";
import { withAudit } from "../../middleware/auditLog.js";

export default async function networkRoutes(app: FastifyInstance) {
  const auth = { preHandler: (app as any).requireAuth };

  app.get("/network/ports", auth, async (_req, reply) => {
    try {
      reply.send(await NetworkService.listOpenPorts());
    } catch (err) {
      reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post(
    "/network/ports/block",
    {
      preHandler: [
        (app as any).requireAuth,
        withAudit("network.port.block", (r) => {
          const b = r.body as any;
          return `${b?.port}/${b?.protocol}`;
        }),
      ],
      schema: {
        body: {
          type: "object",
          required: ["port", "protocol"],
          properties: { port: { type: "number" }, protocol: { type: "string", enum: ["tcp", "udp"] } },
        },
      },
    },
    async (req, reply) => {
      const { port, protocol } = req.body as { port: number; protocol: "tcp" | "udp" };
      try {
        await NetworkService.blockPort(port, protocol);
        reply.send({ ok: true });
      } catch (err) {
        reply.code(400).send({ error: (err as Error).message });
      }
    }
  );

  app.post(
    "/network/ports/unblock",
    {
      preHandler: [
        (app as any).requireAuth,
        withAudit("network.port.unblock", (r) => {
          const b = r.body as any;
          return `${b?.port}/${b?.protocol}`;
        }),
      ],
      schema: {
        body: {
          type: "object",
          required: ["port", "protocol"],
          properties: { port: { type: "number" }, protocol: { type: "string", enum: ["tcp", "udp"] } },
        },
      },
    },
    async (req, reply) => {
      const { port, protocol } = req.body as { port: number; protocol: "tcp" | "udp" };
      try {
        await NetworkService.unblockPort(port, protocol);
        reply.send({ ok: true });
      } catch (err) {
        reply.code(400).send({ error: (err as Error).message });
      }
    }
  );

  app.post(
    "/network/ports/kill",
    {
      preHandler: [
        (app as any).requireAuth,
        withAudit("network.port.kill", (r) => {
          const b = r.body as any;
          return `pid:${b?.pid}`;
        }),
      ],
      schema: {
        body: {
          type: "object",
          required: ["port", "pid"],
          properties: { port: { type: "number" }, pid: { type: "number" } },
        },
      },
    },
    async (req, reply) => {
      const { port, pid } = req.body as { port: number; pid: number };
      try {
        await NetworkService.killPort(port, pid);
        reply.send({ ok: true });
      } catch (err) {
        reply.code(400).send({ error: (err as Error).message });
      }
    }
  );

  app.get("/analytics/sites/:name/top-pages", auth, async (req, reply) => {
    const { name } = req.params as { name: string };
    const { window } = req.query as { window?: string };
    reply.send(await NetworkService.topPages(name, window ? Number(window) : 7));
  });

  app.get("/analytics/sites/:name/visitors", auth, async (req, reply) => {
    const { name } = req.params as { name: string };
    const { window } = req.query as { window?: string };
    reply.send(await NetworkService.visitorStats(name, window ? Number(window) : 7));
  });

  app.get("/security/fail2ban/status", auth, async (_req, reply) => {
    reply.send(await NetworkService.fail2banStatus());
  });

  app.get("/security/fail2ban/jails/:jail", auth, async (req, reply) => {
    const { jail } = req.params as { jail: string };
    try {
      reply.send(await NetworkService.jailStatus(jail));
    } catch (err) {
      reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.get("/security/blocked-ips", auth, async (_req, reply) => {
    reply.send(await NetworkService.listBlockedIps());
  });

  app.post(
    "/security/blocked-ips",
    {
      preHandler: [(app as any).requireAuth, withAudit("security.ip.block", (r) => (r.body as any)?.ip)],
      schema: {
        body: {
          type: "object",
          required: ["ip"],
          properties: { ip: { type: "string" }, jail: { type: "string" } },
        },
      },
    },
    async (req, reply) => {
      const { ip, jail } = req.body as { ip: string; jail?: string };
      try {
        await NetworkService.banIp(ip, jail);
        reply.send({ ok: true });
      } catch (err) {
        reply.code(400).send({ error: (err as Error).message });
      }
    }
  );

  app.delete(
    "/security/blocked-ips/:ip",
    { preHandler: [(app as any).requireAuth, withAudit("security.ip.unblock", (r) => (r.params as any).ip)] },
    async (req, reply) => {
      const { ip } = req.params as { ip: string };
      try {
        await NetworkService.unbanIp(ip);
        reply.send({ ok: true });
      } catch (err) {
        reply.code(400).send({ error: (err as Error).message });
      }
    }
  );
}
