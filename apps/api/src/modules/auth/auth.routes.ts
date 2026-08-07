import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { AuthService, UserModel } from "./auth.service.js";
import { env } from "../../config/env.js";

const tempTokens = new Map<string, { userId: number; expiresAt: number }>();

function issueTempToken(userId: number): string {
  const token = randomBytes(32).toString("hex");
  tempTokens.set(token, { userId, expiresAt: Date.now() + 5 * 60_000 });
  return token;
}

function consumeTempToken(token: string): number | null {
  const entry = tempTokens.get(token);
  if (!entry) return null;
  tempTokens.delete(token);
  if (entry.expiresAt < Date.now()) return null;
  return entry.userId;
}

export default async function authRoutes(app: FastifyInstance) {
  app.post(
    "/auth/login",
    {
      config: {
        rateLimit: {
          max: env.LOGIN_RATE_LIMIT_MAX,
          timeWindow: env.LOGIN_RATE_LIMIT_WINDOW,
        },
      },
      schema: {
        body: {
          type: "object",
          required: ["username", "password"],
          properties: {
            username: { type: "string", minLength: 1, maxLength: 100 },
            password: { type: "string", minLength: 1, maxLength: 200 },
          },
        },
      },
    },
    async (request, reply) => {
      const { username, password } = request.body as { username: string; password: string };
      const ip = request.ip;

      const failedAttempts = AuthService.recentFailedAttempts(username, ip);
      if (failedAttempts >= env.LOGIN_RATE_LIMIT_MAX * 3) {
        return reply.code(429).send({ error: "too_many_attempts" });
      }

      const user = UserModel.findByUsername(username);
      if (!user) {
        AuthService.recordLoginAttempt(username, ip, false);
        return reply.code(401).send({ error: "invalid_credentials" });
      }

      const valid = await AuthService.verifyPassword(password, user.password_hash);
      if (!valid) {
        AuthService.recordLoginAttempt(username, ip, false);
        return reply.code(401).send({ error: "invalid_credentials" });
      }

      AuthService.recordLoginAttempt(username, ip, true);

      if (user.totp_enabled) {
        const tempToken = issueTempToken(user.id);
        return reply.send({ requires2fa: true, tempToken });
      }

      const accessToken = app.jwt.sign({ sub: user.id, username: user.username });
      const refreshToken = AuthService.issueRefreshToken(user.id);
      reply.setCookie("refresh_token", refreshToken, {
        httpOnly: true,
        secure: env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/api/auth",
      });
      return reply.send({ requires2fa: false, accessToken });
    }
  );

  app.post(
    "/auth/2fa/verify",
    {
      schema: {
        body: {
          type: "object",
          required: ["tempToken", "code"],
          properties: {
            tempToken: { type: "string" },
            code: { type: "string", minLength: 6, maxLength: 6 },
          },
        },
      },
    },
    async (request, reply) => {
      const { tempToken, code } = request.body as { tempToken: string; code: string };
      const userId = consumeTempToken(tempToken);
      if (!userId) return reply.code(401).send({ error: "invalid_or_expired_token" });

      const user = UserModel.findById(userId);
      if (!user || !user.totp_secret) return reply.code(401).send({ error: "invalid_state" });

      const valid = AuthService.verifyTotpCode(user.totp_secret, code);
      if (!valid) return reply.code(401).send({ error: "invalid_code" });

      const accessToken = app.jwt.sign({ sub: user.id, username: user.username });
      const refreshToken = AuthService.issueRefreshToken(user.id);
      reply.setCookie("refresh_token", refreshToken, {
        httpOnly: true,
        secure: env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/api/auth",
      });
      return reply.send({ accessToken });
    }
  );

  app.post(
    "/auth/2fa/enroll",
    { preHandler: (app as any).requireAuth },
    async (request, reply) => {
      const payload = request.user as { sub: number; username: string };
      const secret = AuthService.generateTotpSecret();
      UserModel.setTotpSecret(payload.sub, secret);
      const qrCodeDataUrl = await AuthService.generateTotpQrCode(payload.username, secret);
      return reply.send({ secret, qrCodeDataUrl });
    }
  );

  app.post(
    "/auth/2fa/enroll/confirm",
    {
      preHandler: (app as any).requireAuth,
      schema: {
        body: {
          type: "object",
          required: ["code"],
          properties: { code: { type: "string", minLength: 6, maxLength: 6 } },
        },
      },
    },
    async (request, reply) => {
      const payload = request.user as { sub: number };
      const { code } = request.body as { code: string };
      const user = UserModel.findById(payload.sub);
      if (!user?.totp_secret) return reply.code(400).send({ error: "no_pending_enrollment" });

      const valid = AuthService.verifyTotpCode(user.totp_secret, code);
      if (!valid) return reply.code(401).send({ error: "invalid_code" });

      UserModel.enableTotp(payload.sub);
      return reply.send({ enabled: true });
    }
  );

  app.post("/auth/refresh", async (request, reply) => {
    const refreshToken = request.cookies.refresh_token;
    if (!refreshToken) return reply.code(401).send({ error: "no_refresh_token" });

    const userId = AuthService.verifyRefreshToken(refreshToken);
    if (!userId) return reply.code(401).send({ error: "invalid_refresh_token" });

    const user = UserModel.findById(userId);
    if (!user) return reply.code(401).send({ error: "user_not_found" });

    const accessToken = app.jwt.sign({ sub: user.id, username: user.username });
    return reply.send({ accessToken });
  });

  app.post("/auth/logout", async (request, reply) => {
    const refreshToken = request.cookies.refresh_token;
    if (refreshToken) AuthService.revokeRefreshToken(refreshToken);
    reply.clearCookie("refresh_token", { path: "/api/auth" });
    return reply.send({ ok: true });
  });

  app.get(
    "/auth/me",
    { preHandler: (app as any).requireAuth },
    async (request, reply) => {
      const payload = request.user as { sub: number; username: string };
      const user = UserModel.findById(payload.sub);
      if (!user) return reply.code(404).send({ error: "not_found" });
      return reply.send({
        id: user.id,
        username: user.username,
        twoFactorEnabled: !!user.totp_enabled,
      });
    }
  );
}
