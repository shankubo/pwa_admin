import fastifyWebsocket from "@fastify/websocket";
import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";

export default fp(async function websocketPlugin(app: FastifyInstance) {
  app.register(fastifyWebsocket);
});
