import fastifyRateLimit from "@fastify/rate-limit";
import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";

export default fp(async function rateLimitPlugin(app: FastifyInstance) {
  app.register(fastifyRateLimit, {
    global: false,
  });
});
