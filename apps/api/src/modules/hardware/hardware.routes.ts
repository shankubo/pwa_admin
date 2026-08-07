import type { FastifyInstance } from "fastify";
import { HardwareService } from "./hardware.service.js";
import { withAudit } from "../../middleware/auditLog.js";

export default async function hardwareRoutes(app: FastifyInstance) {
  const auth = { preHandler: (app as any).requireAuth };

  app.get("/hardware/overview", auth, async (_req, reply) => {
    reply.send(await HardwareService.getOverview());
  });

  app.get("/hardware/services", auth, async (req, reply) => {
    const { filter } = req.query as { filter?: string };
    reply.send(await HardwareService.listServices(filter));
  });

  app.get("/hardware/wifi/scan", auth, async (_req, reply) => {
    try {
      reply.send(await HardwareService.scanWifi());
    } catch (err) {
      reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post(
    "/hardware/wifi/connect",
    {
      preHandler: [(app as any).requireAuth, withAudit("hardware.wifi.connect", (r) => (r.body as any)?.ssid)],
      schema: {
        body: {
          type: "object",
          required: ["ssid", "password"],
          properties: {
            ssid: { type: "string", minLength: 1, maxLength: 64 },
            password: { type: "string", minLength: 8, maxLength: 128 },
          },
        },
      },
    },
    async (req, reply) => {
      const { ssid, password } = req.body as { ssid: string; password: string };
      try {
        await HardwareService.connectWifi(ssid, password);
        reply.send({ ok: true });
      } catch (err) {
        reply.code(400).send({ error: (err as Error).message });
      }
    }
  );

  app.post(
    "/hardware/wifi/disconnect",
    { preHandler: [(app as any).requireAuth, withAudit("hardware.wifi.disconnect")] },
    async (req, reply) => {
      const { deviceName } = req.body as { deviceName: string };
      try {
        await HardwareService.disconnectWifi(deviceName);
        reply.send({ ok: true });
      } catch (err) {
        reply.code(400).send({ error: (err as Error).message });
      }
    }
  );
}
