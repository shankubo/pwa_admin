import { createReadStream } from "node:fs";
import type { FastifyInstance } from "fastify";
import { UsbExplorerService } from "../../services/usbExplorer.client.js";
import { withAudit } from "../../middleware/auditLog.js";
import { spawnCommand } from "../../utils/exec.js";

export default async function usbExplorerRoutes(app: FastifyInstance) {
  const auth = { preHandler: (app as any).requireAuth };

  app.get("/usb-explorer/list", auth, async (req, reply) => {
    const { mountpoint, path } = req.query as { mountpoint?: string; path?: string };
    if (!mountpoint) return reply.code(400).send({ error: "mountpoint_required" });
    try {
      reply.send(await UsbExplorerService.list(mountpoint, path ?? ""));
    } catch (err) {
      reply.code(400).send({ error: (err as Error).message });
    }
  });

  const entryBody = {
    type: "object",
    required: ["mountpoint", "path"],
    properties: { mountpoint: { type: "string", maxLength: 300 }, path: { type: "string", maxLength: 1000 } },
  };

  // A plain <a href> download can't send an Authorization header, so the browser
  // gets a short-lived token scoped to exactly one drive + path (same pattern as
  // /backups/history/:runId/download-token). The path is validated again when
  // the token is used.
  app.post("/usb-explorer/download-token", { preHandler: auth.preHandler, schema: { body: entryBody } }, async (req, reply) => {
    const { mountpoint, path } = req.body as { mountpoint: string; path: string };
    try {
      await UsbExplorerService.prepareDownload(mountpoint, path);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
    reply.send({ token: app.jwt.sign({ usbDownloadMount: mountpoint, usbDownloadPath: path }, { expiresIn: "2m" }) });
  });

  app.get("/usb-explorer/download", async (req, reply) => {
    const { token } = req.query as { token?: string };
    let payload: { usbDownloadMount?: string; usbDownloadPath?: string };
    try {
      payload = app.jwt.verify(token ?? "");
    } catch {
      return reply.code(401).send({ error: "unauthorized" });
    }
    if (!payload.usbDownloadMount || payload.usbDownloadPath === undefined) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    let target;
    try {
      target = await UsbExplorerService.prepareDownload(payload.usbDownloadMount, payload.usbDownloadPath);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }

    const disposition = (name: string) =>
      `attachment; filename="${name.replace(/[^\w.\-]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`;

    if (!target.isDirectory) {
      reply.header("Content-Disposition", disposition(target.name));
      reply.header("Content-Type", "application/octet-stream");
      reply.header("Content-Length", target.sizeBytes ?? 0);
      return reply.send(createReadStream(target.abs));
    }

    // A folder (e.g. a migration snapshot) is packed on the fly. Its archives are
    // already compressed, so a plain .tar avoids burning CPU for no gain.
    const tar = spawnCommand("tar", UsbExplorerService.tarArgs(target.abs));
    tar.on("error", () => tar.stdout?.destroy());
    reply.header("Content-Disposition", disposition(`${target.name}.tar`));
    reply.header("Content-Type", "application/x-tar");
    return reply.send(tar.stdout);
  });

  // Irreversible, so: confirm flag required, audited with the drive-relative path,
  // and the service only ever deletes under BACKUP/<host>/<category>/ or deeper.
  app.post(
    "/usb-explorer/delete",
    {
      preHandler: [
        (app as any).requireAuth,
        withAudit("usb.explorer.delete", (r) => String((r.body as { path?: string } | undefined)?.path ?? "")),
      ],
      schema: {
        body: {
          ...entryBody,
          required: ["mountpoint", "path", "confirm"],
          properties: { ...entryBody.properties, confirm: { type: "boolean", const: true } },
        },
      },
    },
    async (req, reply) => {
      const { mountpoint, path } = req.body as { mountpoint: string; path: string };
      try {
        reply.send({ ok: true, ...(await UsbExplorerService.remove(mountpoint, path)) });
      } catch (err) {
        reply.code(400).send({ error: (err as Error).message });
      }
    }
  );
}
