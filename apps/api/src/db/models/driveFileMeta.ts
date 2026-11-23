import { db } from "../index.js";

/** Records whether a file uploaded to Google Drive was encrypted. No row means
 * "unknown" (uploaded before this was tracked), which the UI shows as such
 * rather than guessing. */
export const DriveFileMetaModel = {
  set(fileId: string, encrypted: boolean): void {
    db.prepare(
      `INSERT INTO drive_file_meta (file_id, encrypted) VALUES (?, ?)
       ON CONFLICT(file_id) DO UPDATE SET encrypted = excluded.encrypted`
    ).run(fileId, encrypted ? 1 : 0);
  },

  get(fileId: string): boolean | null {
    const row = db.prepare("SELECT encrypted FROM drive_file_meta WHERE file_id = ?").get(fileId) as
      | { encrypted: number }
      | undefined;
    return row ? row.encrypted === 1 : null;
  },
};
