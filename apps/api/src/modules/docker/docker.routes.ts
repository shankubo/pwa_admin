import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, unlink, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { join, resolve, basename } from "node:path";
import type { FastifyInstance } from "fastify";
import { DockerService } from "./docker.service.js";
import { withAudit } from "../../middleware/auditLog.js";
import { env } from "../../config/env.js";

export default async function dockerRoutes(app: FastifyInstance) {
  const auth = { preHandler: (app as any).requireAuth };

  app.get("/docker/containers", auth, async (_req, reply) => {
    reply.send(await DockerService.listContainers());
  });

  app.get("/docker/containers/:id", auth, async (req, reply) => {
    const { id } = req.params as { id: string };
    reply.send(await DockerService.getContainerDetail(id));
  });

  app.post(
    "/docker/containers/:id/start",
    { ...auth, preHandler: [(app as any).requireAuth, withAudit("docker.container.start", (r) => (r.params as any).id)] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      await DockerService.startContainer(id);
      reply.send({ ok: true });
    }
  );

  app.post(
    "/docker/containers/:id/stop",
    { preHandler: [(app as any).requireAuth, withAudit("docker.container.stop", (r) => (r.params as any).id)] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      await DockerService.stopContainer(id);
      reply.send({ ok: true });
    }
  );

  app.post(
    "/docker/containers/:id/restart",
    { preHandler: [(app as any).requireAuth, withAudit("docker.container.restart", (r) => (r.params as any).id)] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      await DockerService.restartContainer(id);
      reply.send({ ok: true });
    }
  );

  app.delete(
    "/docker/containers/:id",
    {
      preHandler: [(app as any).requireAuth, withAudit("docker.container.remove", (r) => (r.params as any).id)],
      schema: {
        body: {
          type: "object",
          required: ["confirm"],
          properties: { confirm: { type: "boolean", const: true } },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      await DockerService.removeContainer(id);
      reply.send({ ok: true });
    }
  );

  app.get("/docker/containers/:id/logs", auth, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { tail } = req.query as { tail?: string };
    const logs = await DockerService.getLogs(id, tail ? Number(tail) : 200);
    reply.type("text/plain").send(logs);
  });

  app.get("/docker/containers/:id/stats", auth, async (req, reply) => {
    const { id } = req.params as { id: string };
    reply.send(await DockerService.getStats(id));
  });

  app.get("/docker/images", auth, async (_req, reply) => {
    reply.send(await DockerService.listImages());
  });

  app.delete(
    "/docker/images/:id",
    { preHandler: [(app as any).requireAuth, withAudit("docker.image.remove", (r) => (r.params as any).id)] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      await DockerService.removeImage(id);
      reply.send({ ok: true });
    }
  );

  app.post(
    "/docker/images/:id/export",
    {
      preHandler: [(app as any).requireAuth, withAudit("docker.image.export", (r) => (r.params as any).id)],
      schema: {
        body: {
          type: "object",
          required: ["label"],
          properties: {
            label: { type: "string", minLength: 1, maxLength: 200 },
            targets: { type: "array", items: { type: "string", enum: ["local", "gdrive"] } },
          },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { label, targets } = req.body as { label: string; targets?: ("local" | "gdrive")[] };
      try {
        const result = await DockerService.exportImage(id, label, targets && targets.length ? targets : ["local"]);
        reply.send(result);
      } catch (err) {
        reply.code(400).send({ error: (err as Error).message });
      }
    }
  );

  function validateImagesPath(path: string): string | null {
    const imagesRoot = resolve(env.BACKUP_LOCAL_ROOT, "images");
    const resolved = resolve(path);
    if (resolved !== imagesRoot && !resolved.startsWith(imagesRoot + "/") && !resolved.startsWith(imagesRoot + "\\")) {
      return null;
    }
    return resolved;
  }

  // A plain <a href> download can't send an Authorization header, and loading
  // the whole file into a JS blob first (fetch + res.blob()) was found to drop
  // mid-transfer on large (200+ MB) exports. So: mint a token scoped to this
  // exact file path with a short TTL, then the browser navigates straight to
  // the download URL — native streaming download, nothing held in JS memory.
  app.post(
    "/docker/images/export/download-token",
    auth,
    async (req, reply) => {
      const { path } = req.body as { path?: string };
      if (!path || !validateImagesPath(path)) {
        return reply.code(400).send({ error: "invalid_path" });
      }
      const token = app.jwt.sign({ downloadPath: path }, { expiresIn: "2m" });
      reply.send({ token });
    }
  );

  // Streams a previously exported image .tar back to the browser. The path
  // must resolve inside BACKUP_LOCAL_ROOT/images — never an arbitrary
  // admin-supplied filesystem path — since it's echoed back from exportImage's
  // own result rather than freely typed by the client.
  app.get("/docker/images/export/download", async (req, reply) => {
    const { token } = req.query as { token?: string };
    if (!token) return reply.code(401).send({ error: "unauthorized" });

    let payload: { downloadPath?: string };
    try {
      payload = app.jwt.verify(token);
    } catch {
      return reply.code(401).send({ error: "unauthorized" });
    }
    if (!payload.downloadPath) return reply.code(401).send({ error: "unauthorized" });

    const resolved = validateImagesPath(payload.downloadPath);
    if (!resolved) return reply.code(400).send({ error: "path_outside_images_backup_root" });
    if (!existsSync(resolved)) return reply.code(404).send({ error: "not_found" });

    const { size } = await stat(resolved);
    reply.header("Content-Disposition", `attachment; filename="${basename(resolved)}"`);
    reply.header("Content-Length", size);
    reply.type("application/x-tar");
    return reply.send(createReadStream(resolved));
  });

  app.post(
    "/docker/images/import",
    { preHandler: [(app as any).requireAuth, withAudit("docker.image.import")] },
    async (req, reply) => {
      const file = await (req as any).file();
      if (!file) return reply.code(400).send({ error: "no_file_uploaded" });

      const tmpDir = join(env.BACKUP_LOCAL_ROOT, "_tmp-image-import");
      await mkdir(tmpDir, { recursive: true });
      const tmpPath = join(tmpDir, `${Date.now()}-${file.filename}`);

      try {
        await pipeline(file.file, createWriteStream(tmpPath));
        await DockerService.importImage(tmpPath);
        reply.send({ ok: true });
      } catch (err) {
        reply.code(400).send({ error: (err as Error).message });
      } finally {
        await unlink(tmpPath).catch(() => {});
      }
    }
  );

  app.get("/docker/volumes", auth, async (_req, reply) => {
    reply.send(await DockerService.listVolumes());
  });

  app.delete(
    "/docker/volumes/:name",
    { preHandler: [(app as any).requireAuth, withAudit("docker.volume.remove", (r) => (r.params as any).name)] },
    async (req, reply) => {
      const { name } = req.params as { name: string };
      await DockerService.removeVolume(name);
      reply.send({ ok: true });
    }
  );

  app.get("/docker/networks", auth, async (_req, reply) => {
    reply.send(await DockerService.listNetworks());
  });

  app.get("/docker/system/df", auth, async (_req, reply) => {
    reply.send(await DockerService.systemDf());
  });

  app.post(
    "/docker/prune",
    {
      preHandler: [(app as any).requireAuth, withAudit("docker.prune")],
      schema: {
        body: {
          type: "object",
          required: ["confirm"],
          properties: { confirm: { type: "boolean", const: true } },
        },
      },
    },
    async (_req, reply) => {
      reply.send(await DockerService.prune());
    }
  );
}
