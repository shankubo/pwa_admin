import Fastify, { type FastifyInstance } from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import fastifyMultipart from "@fastify/multipart";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { env } from "./config/env.js";
import "./db/index.js";

import jwtPlugin from "./plugins/jwt.js";
import websocketPlugin from "./plugins/websocket.js";
import rateLimitPlugin from "./plugins/rateLimit.js";
import corsPlugin from "./plugins/cors.js";
import wsRoutePlugin from "./plugins/wsRoute.js";

import authRoutes from "./modules/auth/auth.routes.js";
import systemRoutes from "./modules/system/system.routes.js";
import "./modules/system/system.ws.js";
import dockerRoutes from "./modules/docker/docker.routes.js";
import "./modules/docker/docker.ws.js";
import nginxRoutes from "./modules/nginx/nginx.routes.js";
import "./modules/nginx/nginx.ws.js";
import sitesRoutes from "./modules/sites/sites.routes.js";
import networkRoutes from "./modules/network/network.routes.js";
import osRoutes from "./modules/os/os.routes.js";
import "./modules/os/os.ws.js";
import backupRoutes from "./modules/backup/backup.routes.js";
import dbBackupRoutes from "./modules/dbbackup/dbbackup.routes.js";
import applicationRoutes from "./modules/application/application.routes.js";
import pm2Routes from "./modules/pm2/pm2.routes.js";
import "./modules/pm2/pm2.ws.js";
import hardwareRoutes from "./modules/hardware/hardware.routes.js";
import securityRoutes from "./modules/security/security.routes.js";
import auditRoutes from "./modules/audit/audit.routes.js";
import { SchedulerService } from "./services/scheduler.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const useTls = !!(env.TLS_CERT_PATH && env.TLS_KEY_PATH);

const loggerOptions = {
  level: env.NODE_ENV === "development" ? "debug" : "info",
  transport: env.NODE_ENV === "development" ? { target: "pino-pretty" } : undefined,
} as const;

// Cast to the plain HTTP FastifyInstance type in both branches: the app's routes/plugins
// never touch protocol-specific APIs, and Fastify itself handles HTTP vs HTTPS transparently
// once the server is created — only the constructor options differ.
const app: FastifyInstance = useTls
  ? (Fastify({
      logger: loggerOptions,
      trustProxy: true,
      https: {
        cert: readFileSync(env.TLS_CERT_PATH!),
        key: readFileSync(env.TLS_KEY_PATH!),
      },
    }) as unknown as FastifyInstance)
  : Fastify({
      logger: loggerOptions,
      trustProxy: true,
    });

await app.register(corsPlugin);
await app.register(fastifyCookie);
await app.register(jwtPlugin);
await app.register(websocketPlugin);
await app.register(rateLimitPlugin);
await app.register(fastifyMultipart, {
  limits: { fileSize: 5 * 1024 * 1024 * 1024 }, // 5 GB — Docker image archives can be large
});

await app.register(async (api) => {
  await api.register(authRoutes);
  await api.register(systemRoutes);
  await api.register(dockerRoutes);
  await api.register(nginxRoutes);
  await api.register(sitesRoutes);
  await api.register(networkRoutes);
  await api.register(osRoutes);
  await api.register(backupRoutes);
  await api.register(dbBackupRoutes);
  await api.register(applicationRoutes);
  await api.register(pm2Routes);
  await api.register(hardwareRoutes);
  await api.register(securityRoutes);
  await api.register(auditRoutes);
  await api.register(wsRoutePlugin);
}, { prefix: "/api" });

SchedulerService.start();

const webDist = join(__dirname, "..", "..", "web", "dist");
await app.register(fastifyStatic, {
  root: webDist,
});

app.setNotFoundHandler((request, reply) => {
  if (request.raw.url?.startsWith("/api")) {
    return reply.code(404).send({ error: "not_found" });
  }
  return reply.sendFile("index.html");
});

app.get("/healthz", async () => ({ ok: true }));

try {
  await app.listen({ port: env.PORT, host: env.HOST });
  app.log.info(
    `pwa-admin API listening on ${useTls ? "https" : "http"}://${env.HOST}:${env.PORT}`
  );
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
