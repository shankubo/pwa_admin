import { db } from "../index.js";
import type { AccessTokenSummary } from "@pwa-admin/shared";

export interface AccessTokenRow {
  id: number;
  user_id: number;
  token_hash: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
}

function toApiShape(row: AccessTokenRow): AccessTokenSummary {
  return {
    id: row.id,
    label: row.label,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

export const AccessTokenModel = {
  create(userId: number, tokenHash: string, label: string): AccessTokenRow {
    const result = db
      .prepare("INSERT INTO access_tokens (user_id, token_hash, label) VALUES (?, ?, ?)")
      .run(userId, tokenHash, label);
    return db
      .prepare("SELECT * FROM access_tokens WHERE id = ?")
      .get(Number(result.lastInsertRowid)) as AccessTokenRow;
  },

  findByHash(tokenHash: string): AccessTokenRow | undefined {
    return db.prepare("SELECT * FROM access_tokens WHERE token_hash = ?").get(tokenHash) as
      | AccessTokenRow
      | undefined;
  },

  touchLastUsed(id: number): void {
    db.prepare("UPDATE access_tokens SET last_used_at = datetime('now') WHERE id = ?").run(id);
  },

  listForUser(userId: number): AccessTokenSummary[] {
    const rows = db
      .prepare("SELECT * FROM access_tokens WHERE user_id = ? ORDER BY created_at DESC")
      .all(userId) as AccessTokenRow[];
    return rows.map(toApiShape);
  },

  revoke(id: number, userId: number): boolean {
    const result = db
      .prepare("DELETE FROM access_tokens WHERE id = ? AND user_id = ?")
      .run(id, userId);
    return result.changes > 0;
  },
};
