import { db } from "../index.js";

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  totp_secret: string | null;
  totp_enabled: number;
  created_at: string;
}

export const UserModel = {
  findByUsername(username: string): UserRow | undefined {
    return db.prepare("SELECT * FROM users WHERE username = ?").get(username) as
      | UserRow
      | undefined;
  },

  findById(id: number): UserRow | undefined {
    return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
  },

  create(username: string, passwordHash: string): UserRow {
    const result = db
      .prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)")
      .run(username, passwordHash);
    return this.findById(Number(result.lastInsertRowid))!;
  },

  count(): number {
    const row = db.prepare("SELECT COUNT(*) as c FROM users").get() as { c: number };
    return row.c;
  },

  setTotpSecret(userId: number, secret: string): void {
    db.prepare("UPDATE users SET totp_secret = ? WHERE id = ?").run(secret, userId);
  },

  enableTotp(userId: number): void {
    db.prepare("UPDATE users SET totp_enabled = 1 WHERE id = ?").run(userId);
  },
};
