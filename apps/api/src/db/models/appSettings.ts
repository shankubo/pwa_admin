import { db } from "../index.js";

/** Small key/value store for admin preferences that must take effect
 * immediately (unlike .env, which is only read at startup). */
export const AppSettingsModel = {
  getBoolean(key: string, fallback: boolean): boolean {
    const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as { value: string } | undefined;
    if (!row) return fallback;
    return row.value === "true";
  },

  setBoolean(key: string, value: boolean): void {
    db.prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).run(key, value ? "true" : "false");
  },
};
