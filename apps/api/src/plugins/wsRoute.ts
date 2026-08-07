import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { attachWsClient } from "../services/wsHub.js";

export default fp(async function wsRoutePlugin(app: FastifyInstance) {
  app.get("/ws", { websocket: true, preHandler: (app as any).requireAuth }, (socket) => {
    attachWsClient(socket);
  });
});
