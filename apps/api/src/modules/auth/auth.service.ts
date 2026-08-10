import bcrypt from "bcrypt";
import { authenticator } from "otplib";
import QRCode from "qrcode";
import { randomBytes, createHash } from "node:crypto";
import { db } from "../../db/index.js";
import { UserModel } from "../../db/models/user.js";
import { AccessTokenModel } from "../../db/models/accessToken.js";
import { env } from "../../config/env.js";

const BCRYPT_ROUNDS = 12;

export const AuthService = {
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_ROUNDS);
  },

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  },

  generateTotpSecret(): string {
    return authenticator.generateSecret();
  },

  async generateTotpQrCode(username: string, secret: string): Promise<string> {
    const otpauth = authenticator.keyuri(username, env.TOTP_ISSUER, secret);
    return QRCode.toDataURL(otpauth);
  },

  verifyTotpCode(secret: string, code: string): boolean {
    return authenticator.check(code, secret);
  },

  issueRefreshToken(userId: number): string {
    const token = randomBytes(48).toString("hex");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + parseTtlMs(env.JWT_REFRESH_TTL)).toISOString();
    db.prepare(
      "INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)"
    ).run(userId, tokenHash, expiresAt);
    return token;
  },

  verifyRefreshToken(token: string): number | null {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const row = db
      .prepare(
        `SELECT user_id, expires_at FROM refresh_tokens
         WHERE token_hash = ? AND revoked = 0`
      )
      .get(tokenHash) as { user_id: number; expires_at: string } | undefined;

    if (!row) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) return null;
    return row.user_id;
  },

  revokeRefreshToken(token: string): void {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    db.prepare("UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?").run(tokenHash);
  },
  issueAccessToken(userId: number, label: string): { id: number; token: string; createdAt: string } {
    const token = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const row = AccessTokenModel.create(userId, tokenHash, label);
    return { id: row.id, token, createdAt: row.created_at };
  },
  verifyAccessToken(token: string): number | null {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const row = AccessTokenModel.findByHash(tokenHash);
    if (!row) return null;
    AccessTokenModel.touchLastUsed(row.id);
    return row.user_id;
  },

  recordLoginAttempt(username: string, ip: string, success: boolean): void {
    db.prepare(
      "INSERT INTO login_attempts (username, ip, success) VALUES (?, ?, ?)"
    ).run(username, ip, success ? 1 : 0);
  },

  recentFailedAttempts(username: string, ip: string, windowMinutes = 15): number {
    const row = db
      .prepare(
        `SELECT COUNT(*) as c FROM login_attempts
         WHERE (username = ? OR ip = ?) AND success = 0
         AND created_at >= datetime('now', ?)`
      )
      .get(username, ip, `-${windowMinutes} minutes`) as { c: number };
    return row.c;
  },
};

function parseTtlMs(ttl: string): number {
  const match = /^(\d+)([smhd])$/.exec(ttl);
  if (!match) return 7 * 24 * 60 * 60 * 1000;
  const value = Number(match[1]);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return value * multipliers[unit];
}

export { UserModel };
