import type { FastifyInstance } from "fastify";
import { UsbExplorerService } from "../../services/usbExplorer.client.js";

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
}
