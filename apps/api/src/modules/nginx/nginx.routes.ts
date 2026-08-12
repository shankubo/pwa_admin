import { createWriteStream } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { webServer } from "../webserver/webserver.registry.js";
import { withAudit } from "../../middleware/auditLog.js";
import { env } from "../../config/env.js";
import type { NginxGuidedFormModel } from "@pwa-admin/shared";

export default async function nginxRoutes(app: FastifyInstance) {
  const auth = { preHandler: (app as any).requireAuth };

  app.get("/nginx/status", auth, async (_req, reply) => {
    reply.send(await webServer().getStatus());
  });

  app.get("/nginx/vhosts", auth, async (_req, reply) => {
    reply.send(await webServer().listVhosts());
  });

  app.get("/nginx/vhosts/:name", auth, async (req, reply) => {
    const { name } = req.params as { name: string };
    try {
      reply.send(await webServer().getVhostDetail(name));
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
        await webServer().enableVhost(name);
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
        await webServer().disableVhost(name);
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
        await webServer().writeVhostConfig(name, content);
        reply.send({ ok: true });
      } catch (err) {
        reply.code(400).send({ error: (err as Error).message });
      }
    }
  );

  // --- Guided config editor: stateless parse/apply, never writes anything —
  // the frontend still saves through PUT /nginx/vhosts/:name/config above,
  // this only produces the candidate text for that existing write path.
  app.post(
    "/nginx/vhosts/:name/guided/parse",
    {
      preHandler: (app as any).requireAuth,
      schema: {
        body: { type: "object", required: ["content"], properties: { content: { type: "string", maxLength: 200000 } } },
      },
    },
    async (req, reply) => {
      const { content } = req.body as { content: string };
      reply.send(webServer().parseGuidedFields(content));
    }
  );

  app.post(
    "/nginx/vhosts/:name/guided/apply",
    {
      preHandler: (app as any).requireAuth,
      schema: {
        body: {
          type: "object",
          required: ["content", "model"],
          properties: { content: { type: "string", maxLength: 200000 }, model: { type: "object" } },
        },
      },
    },
    async (req, reply) => {
      const { content, model } = req.body as { content: string; model: NginxGuidedFormModel };
      try {
        reply.send({ content: await webServer().applyGuidedFields(content, model) });
      } catch (err) {
        reply.code(400).send({ error: (err as Error).message });
      }
    }
  );

  app.post(
    "/nginx/vhosts/guided/build",
    {
      preHandler: (app as any).requireAuth,
      schema: {
        body: {
          type: "object",
          required: ["model", "serverName", "listenPort"],
          properties: {
            model: { type: "object" },
            serverName: { type: "string", maxLength: 500 },
            listenPort: { type: "number" },
          },
        },
      },
    },
    async (req, reply) => {
      const { model, serverName, listenPort } = req.body as {
        model: NginxGuidedFormModel;
        serverName: string;
        listenPort: number;
      };
      try {
        reply.send({ content: await webServer().buildInitialVhostConfig({ ...model, serverName, listenPort }) });
      } catch (err) {
        reply.code(400).send({ error: (err as Error).message });
      }
    }
  );

  app.get("/nginx/cert-paths/check", auth, async (req, reply) => {
    const { path } = req.query as { path?: string };
    if (!path) return reply.code(400).send({ error: "path_required" });
    reply.send({ exists: await webServer().checkCertPathExists(path) });
  });

  // Paste-PEM-text variant: writes both blocks to a tmp staging file each
  // (same "write plain content, validate, then place" idiom as the upload
  // route below) so saveManagedCert's openssl validation runs against real
  // files, then moves them into NGINX_MANAGED_CERTS_DIR/APACHE_MANAGED_CERTS_DIR.
  app.post(
    "/nginx/cert-paths/import-text",
    {
      preHandler: [(app as any).requireAuth, withAudit("nginx.cert.import_text", (r) => (r.body as any)?.vhostName)],
      schema: {
        body: {
          type: "object",
          required: ["vhostName", "certPem", "keyPem"],
          properties: {
            vhostName: { type: "string", maxLength: 200 },
            certPem: { type: "string", maxLength: 100_000 },
            keyPem: { type: "string", maxLength: 100_000 },
          },
        },
      },
    },
    async (req, reply) => {
      const { vhostName, certPem, keyPem } = req.body as { vhostName: string; certPem: string; keyPem: string };
      const managedCertsDir = webServer().engine === "apache" ? env.APACHE_MANAGED_CERTS_DIR : env.NGINX_MANAGED_CERTS_DIR;
      const tmpDir = join(managedCertsDir, "_tmp-paste");
      await mkdir(tmpDir, { recursive: true });
      const certTmp = join(tmpDir, `${Date.now()}-cert.pem`);
      const keyTmp = join(tmpDir, `${Date.now()}-key.pem`);
      try {
        await writeFile(certTmp, certPem);
        await writeFile(keyTmp, keyPem);
        const result = await webServer().saveManagedCert(vhostName, certTmp, keyTmp);
        reply.send(result);
      } catch (err) {
        reply.code(400).send({ error: (err as Error).message });
      } finally {
        await unlink(certTmp).catch(() => {});
        await unlink(keyTmp).catch(() => {});
      }
    }
  );

  // File-upload variant — same two-file idea, but the browser sends actual
  // cert/key files as multipart fields instead of pasted text.
  app.post(
    "/nginx/cert-paths/import-file",
    { preHandler: [(app as any).requireAuth, withAudit("nginx.cert.import_file")] },
    async (req, reply) => {
      const managedCertsDir = webServer().engine === "apache" ? env.APACHE_MANAGED_CERTS_DIR : env.NGINX_MANAGED_CERTS_DIR;
      const tmpDir = join(managedCertsDir, "_tmp-upload");
      await mkdir(tmpDir, { recursive: true });
      let vhostName: string | undefined;
      let certTmp: string | undefined;
      let keyTmp: string | undefined;
      try {
        for await (const part of (req as any).parts()) {
          if (part.type === "field" && part.fieldname === "vhostName") {
            vhostName = part.value as string;
          } else if (part.type === "file" && part.fieldname === "cert") {
            // Duplicate "cert"/"key" parts in one request would otherwise
            // leak the earlier tmp file on disk (only the final reference
            // gets cleaned up in `finally`) — unlink any prior one first.
            if (certTmp) await unlink(certTmp).catch(() => {});
            certTmp = join(tmpDir, `${Date.now()}-cert.pem`);
            await pipeline(part.file, createWriteStream(certTmp));
          } else if (part.type === "file" && part.fieldname === "key") {
            if (keyTmp) await unlink(keyTmp).catch(() => {});
            keyTmp = join(tmpDir, `${Date.now()}-key.pem`);
            await pipeline(part.file, createWriteStream(keyTmp));
          }
        }
        if (!vhostName || !certTmp || !keyTmp) {
          return reply.code(400).send({ error: "vhostName_cert_and_key_required" });
        }
        const result = await webServer().saveManagedCert(vhostName, certTmp, keyTmp);
        reply.send(result);
      } catch (err) {
        reply.code(400).send({ error: (err as Error).message });
      } finally {
        if (certTmp) await unlink(certTmp).catch(() => {});
        if (keyTmp) await unlink(keyTmp).catch(() => {});
      }
    }
  );

  app.post(
    "/nginx/vhosts",
    {
      preHandler: [(app as any).requireAuth, withAudit("nginx.vhost.create", (r) => (r.body as any)?.name)],
      schema: {
        body: {
          type: "object",
          required: ["name", "content"],
          properties: { name: { type: "string", maxLength: 200 }, content: { type: "string", maxLength: 200000 } },
        },
      },
    },
    async (req, reply) => {
      const { name, content } = req.body as { name: string; content: string };
      try {
        await webServer().createVhost(name, content);
        reply.send({ ok: true });
      } catch (err) {
        const message = (err as Error).message;
        reply.code(message === "vhost_already_exists" ? 409 : 400).send({ error: message });
      }
    }
  );

  app.get("/nginx/vhosts/:name/history", auth, async (req, reply) => {
    const { name } = req.params as { name: string };
    reply.send(await webServer().listVhostHistory(name));
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
        await webServer().restoreSnapshot(name, Number(snapshotId));
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
      const test = await webServer().testConfig();
      if (!test.ok) return reply.code(400).send({ error: "config_invalid", output: test.output });
      await webServer().reload();
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
      await webServer().restart();
      reply.send({ ok: true });
    }
  );

  app.get("/nginx/vhosts/:name/logs", auth, async (req, reply) => {
    const { name } = req.params as { name: string };
    const { type, tail } = req.query as { type?: "access" | "error"; tail?: string };
    const logs = await webServer().getVhostLogs(name, type ?? "error", tail ? Number(tail) : 200);
    reply.type("text/plain").send(logs);
  });

  app.get("/nginx/vhosts/:name/cert", auth, async (req, reply) => {
    const { name } = req.params as { name: string };
    reply.send(await webServer().getCertStatus(name));
  });

  app.get("/nginx/vhosts/:name/accessibility", auth, async (req, reply) => {
    const { name } = req.params as { name: string };
    try {
      reply.send(await webServer().checkAccessibility(name));
    } catch (err) {
      reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.get("/nginx/vhosts/:name/errors", auth, async (req, reply) => {
    const { name } = req.params as { name: string };
    const { window, limit } = req.query as { window?: string; limit?: string };
    try {
      reply.send(await webServer().getVhostErrors(name, window ? Number(window) : 24, limit ? Number(limit) : 50));
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
      const run = await webServer().backupConfig(targets && targets.length ? targets : ["local"]);
      reply.send(run);
    }
  );
}
