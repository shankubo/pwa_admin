import fastifyJwt from "@fastify/jwt";
import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { env } from "../config/env.js";

export default fp(async function jwtPlugin(app: FastifyInstance) {
  app.register(fastifyJwt, {
    secret: env.JWT_ACCESS_SECRET,
    sign: { expiresIn: env.JWT_ACCESS_TTL },
  });

  app.decorate("requireAuth", async (request: FastifyRequest, reply: any) => {
    try {
      // WS handshake can't set an Authorization header from browser WebSocket API,
      // so accept the access token as a query param for /ws only, header otherwise.
      const queryToken = (request.query as { token?: string } | undefined)?.token;
      if (queryToken && request.url.startsWith("/api/ws")) {
        request.headers.authorization = `Bearer ${queryToken}`;
      }
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ error: "unauthorized" });
    }
  });
});
