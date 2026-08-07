import type { FastifyInstance } from "fastify";
import { OsService, AptJobRunner } from "./os.service.js";
import { env } from "../../config/env.js";
import { withAudit } from "../../middleware/auditLog.js";

export default async function osRoutes(app: FastifyInstance) {
  const auth = { preHandler: (app as any).requireAuth };

  app.get("/os/info", auth, async (_req, reply) => {
    reply.send(await OsService.getInfo());
  });

  app.get("/os/packages", auth, async (_req, reply) => {
    reply.send(await OsService.listInstalledPackages());
  });

  app.get("/os/packages/upgradable", auth, async (_req, reply) => {
    reply.send(await OsService.listUpgradablePackages());
  });

  app.get("/os/packages/held", auth, async (_req, reply) => {
    reply.send(await OsService.listHeldPackages());
  });

  app.post(
    "/os/update-check",
    { preHandler: [(app as any).requireAuth, withAudit("os.update-check")] },
    async (_req, reply) => {
      try {
        const jobId = await OsService.startUpdateCheck();
        reply.send({ jobId });
      } catch (err) {
        reply.code(409).send({ error: (err as Error).message });
      }
    }
  );

  app.post(
    "/os/upgrade",
    {
      preHandler: [(app as any).requireAuth, withAudit("os.upgrade")],
      schema: {
        body: {
          type: "object",
          properties: { mode: { type: "string", enum: ["upgrade", "full-upgrade"] } },
        },
      },
    },
    async (req, reply) => {
      const { mode } = (req.body as { mode?: "upgrade" | "full-upgrade" }) ?? {};
      try {
        const jobId = await OsService.startUpgrade(mode ?? "upgrade");
        reply.send({ jobId });
      } catch (err) {
        reply.code(409).send({ error: (err as Error).message });
      }
    }
  );

  app.get("/os/jobs", auth, async (_req, reply) => {
    reply.send(AptJobRunner.listJobs());
  });

  app.get("/os/jobs/:jobId", auth, async (req, reply) => {
    const { jobId } = req.params as { jobId: string };
    const job = AptJobRunner.getJob(jobId);
    if (!job) return reply.code(404).send({ error: "not_found" });
    reply.send(job);
  });

  app.get("/os/jobs/:jobId/log", auth, async (req, reply) => {
    const { jobId } = req.params as { jobId: string };
    const logPath = AptJobRunner.getJobLogPath(jobId);
    if (!logPath) return reply.code(404).send({ error: "not_found" });
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(logPath, "utf8").catch(() => "");
    reply.type("text/plain").send(content);
  });

  app.post(
    "/os/packages/:name/install",
    {
      preHandler: [(app as any).requireAuth, withAudit("os.package.install", (r) => (r.params as any).name)],
    },
    async (req, reply) => {
      if (!env.APT_ALLOW_INSTALL_REMOVE) return reply.code(403).send({ error: "install_remove_disabled" });
      const { name } = req.params as { name: string };
      const { isValidPackageName } = await import("../../utils/exec.js");
      if (!isValidPackageName(name)) return reply.code(400).send({ error: "invalid_package_name" });
      try {
        const jobId = await AptJobRunner.start("install", "sudo", ["apt-get", "install", "-y", name]);
        reply.send({ jobId });
      } catch (err) {
        reply.code(409).send({ error: (err as Error).message });
      }
    }
  );

  app.post(
    "/os/packages/:name/remove",
    {
      preHandler: [(app as any).requireAuth, withAudit("os.package.remove", (r) => (r.params as any).name)],
      schema: {
        body: {
          type: "object",
          required: ["confirmName"],
          properties: { confirmName: { type: "string" } },
        },
      },
    },
    async (req, reply) => {
      if (!env.APT_ALLOW_INSTALL_REMOVE) return reply.code(403).send({ error: "install_remove_disabled" });
      const { name } = req.params as { name: string };
      const { confirmName } = req.body as { confirmName: string };
      if (confirmName !== name) return reply.code(400).send({ error: "confirmation_name_mismatch" });
      try {
        const jobId = await AptJobRunner.start("remove", "sudo", ["apt-get", "remove", "-y", name]);
        reply.send({ jobId });
      } catch (err) {
        reply.code(409).send({ error: (err as Error).message });
      }
    }
  );

  app.post(
    "/os/packages/:name/hold",
    { preHandler: [(app as any).requireAuth, withAudit("os.package.hold", (r) => (r.params as any).name)] },
    async (req, reply) => {
      const { name } = req.params as { name: string };
      try {
        await OsService.holdPackage(name);
        reply.send({ ok: true });
      } catch (err) {
        reply.code(400).send({ error: (err as Error).message });
      }
    }
  );

  app.post(
    "/os/packages/:name/unhold",
    { preHandler: [(app as any).requireAuth, withAudit("os.package.unhold", (r) => (r.params as any).name)] },
    async (req, reply) => {
      const { name } = req.params as { name: string };
      try {
        await OsService.unholdPackage(name);
        reply.send({ ok: true });
      } catch (err) {
        reply.code(400).send({ error: (err as Error).message });
      }
    }
  );
}
