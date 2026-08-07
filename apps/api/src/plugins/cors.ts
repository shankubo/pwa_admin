import fastifyCors from "@fastify/cors";
import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { env } from "../config/env.js";

export default fp(async function corsPlugin(app: FastifyInstance) {
  app.register(fastifyCors, {
    origin: env.NODE_ENV === "development" ? true : false,
    credentials: true,
  });
});
