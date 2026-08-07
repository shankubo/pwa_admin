import { db } from "../index.js";

export interface AuditLogEntry {
  userId: number | null;
  action: string;
  target?: string | null;
  result: "success" | "failure";
  sourceIp?: string | null;
  detail?: string | null;
}

export const AuditLogModel = {
  record(entry: AuditLogEntry): void {
    db.prepare(
      `INSERT INTO audit_log (user_id, action, target, result, source_ip, detail)
       VALUES (@userId, @action, @target, @result, @sourceIp, @detail)`
    ).run({
      userId: entry.userId,
      action: entry.action,
      target: entry.target ?? null,
      result: entry.result,
      sourceIp: entry.sourceIp ?? null,
      detail: entry.detail ?? null,
    });
  },

  list(limit = 100, offset = 0) {
    return db
      .prepare(
        "SELECT * FROM audit_log ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?"
      )
      .all(limit, offset);
  },
};
