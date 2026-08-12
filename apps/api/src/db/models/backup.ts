import { db } from "../index.js";
import { randomUUID } from "node:crypto";
import type {
  BackupSourceType,
  BackupTarget,
  BackupRunType,
  BackupRunStatus,
  BackupJob,
  BackupHistoryEntry,
} from "@pwa-admin/shared";

export interface BackupJobRow {
  id: number;
  name: string;
  source_type: BackupSourceType;
  source_ref: string;
  targets: string;
  schedule_cron: string | null;
  retention_days: number | null;
  retention_min_copies: number | null;
}

export interface BackupHistoryRow {
  id: number;
  run_id: string;
  job_id: number | null;
  type: BackupRunType;
  source_type: BackupSourceType;
  source_ref: string;
  target: BackupTarget;
  status: BackupRunStatus;
  file_path: string | null;
  size_bytes: number | null;
  checksum_sha256: string | null;
  drive_file_id: string | null;
  usb_path: string | null;
  duration_ms: number | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

export function backupJobToApiShape(row: BackupJobRow): BackupJob {
  return {
    id: row.id,
    name: row.name,
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    targets: JSON.parse(row.targets) as BackupTarget[],
    scheduleCron: row.schedule_cron,
    retentionDays: row.retention_days,
    retentionMinCopies: row.retention_min_copies,
  };
}

export function backupHistoryToApiShape(row: BackupHistoryRow): BackupHistoryEntry {
  return {
    runId: row.run_id,
    jobId: row.job_id,
    type: row.type,
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    target: row.target,
    driveFileId: row.drive_file_id,
    usbPath: row.usb_path,
    status: row.status,
    sizeBytes: row.size_bytes,
    checksumSha256: row.checksum_sha256,
    durationMs: row.duration_ms,
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export const BackupJobModel = {
  create(input: {
    name: string;
    sourceType: BackupSourceType;
    sourceRef: string;
    targets: BackupTarget[];
    scheduleCron?: string | null;
    retentionDays?: number | null;
    retentionMinCopies?: number | null;
  }): BackupJobRow {
    const result = db
      .prepare(
        `INSERT INTO backup_jobs (name, source_type, source_ref, targets, schedule_cron, retention_days, retention_min_copies)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.name,
        input.sourceType,
        input.sourceRef,
        JSON.stringify(input.targets),
        input.scheduleCron ?? null,
        input.retentionDays ?? null,
        input.retentionMinCopies ?? null
      );
    return this.findById(Number(result.lastInsertRowid))!;
  },

  findById(id: number): BackupJobRow | undefined {
    return db.prepare("SELECT * FROM backup_jobs WHERE id = ?").get(id) as BackupJobRow | undefined;
  },

  list(): BackupJobRow[] {
    return db.prepare("SELECT * FROM backup_jobs ORDER BY id DESC").all() as BackupJobRow[];
  },

  update(id: number, fields: Partial<{ name: string; scheduleCron: string | null; retentionDays: number | null; retentionMinCopies: number | null }>): void {
    const current = this.findById(id);
    if (!current) return;
    db.prepare(
      `UPDATE backup_jobs SET name = ?, schedule_cron = ?, retention_days = ?, retention_min_copies = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(
      fields.name ?? current.name,
      fields.scheduleCron !== undefined ? fields.scheduleCron : current.schedule_cron,
      fields.retentionDays !== undefined ? fields.retentionDays : current.retention_days,
      fields.retentionMinCopies !== undefined ? fields.retentionMinCopies : current.retention_min_copies,
      id
    );
  },

  delete(id: number): void {
    db.prepare("DELETE FROM backup_jobs WHERE id = ?").run(id);
  },
};

export const BackupHistoryModel = {
  createRun(input: {
    jobId: number | null;
    type: BackupRunType;
    sourceType: BackupSourceType;
    sourceRef: string;
    target: BackupTarget;
  }): string {
    const runId = randomUUID();
    db.prepare(
      `INSERT INTO backup_history (run_id, job_id, type, source_type, source_ref, target, status)
       VALUES (?, ?, ?, ?, ?, ?, 'running')`
    ).run(runId, input.jobId, input.type, input.sourceType, input.sourceRef, input.target);
    return runId;
  },

  complete(runId: string, result: { status: BackupRunStatus; filePath?: string; sizeBytes?: number; checksumSha256?: string; driveFileId?: string; usbPath?: string; durationMs?: number; error?: string }): void {
    db.prepare(
      `UPDATE backup_history SET status = ?, file_path = ?, size_bytes = ?, checksum_sha256 = ?, drive_file_id = ?, usb_path = ?, duration_ms = ?, error = ?, finished_at = datetime('now')
       WHERE run_id = ?`
    ).run(
      result.status,
      result.filePath ?? null,
      result.sizeBytes ?? null,
      result.checksumSha256 ?? null,
      result.driveFileId ?? null,
      result.usbPath ?? null,
      result.durationMs ?? null,
      result.error ?? null,
      runId
    );
  },

  /** Patches only the usb_path column on an existing run — unlike complete(),
   * never touches status/file_path/etc, so it's safe to call on a run that's
   * long since finished (e.g. "also copy this local backup to USB" from the
   * Restore screen, well after the original backup completed). */
  setUsbPath(runId: string, usbPath: string): void {
    db.prepare("UPDATE backup_history SET usb_path = ? WHERE run_id = ?").run(usbPath, runId);
  },

  /** Same as setUsbPath but for drive_file_id — see its doc comment. */
  setDriveFileId(runId: string, driveFileId: string): void {
    db.prepare("UPDATE backup_history SET drive_file_id = ? WHERE run_id = ?").run(driveFileId, runId);
  },

  findByRunId(runId: string): BackupHistoryRow | undefined {
    return db.prepare("SELECT * FROM backup_history WHERE run_id = ?").get(runId) as
      | BackupHistoryRow
      | undefined;
  },

  list(limit = 100, offset = 0): BackupHistoryRow[] {
    return db
      .prepare("SELECT * FROM backup_history ORDER BY started_at DESC, id DESC LIMIT ? OFFSET ?")
      .all(limit, offset) as BackupHistoryRow[];
  },

  listSuccessfulByJob(jobId: number): BackupHistoryRow[] {
    return db
      .prepare(
        "SELECT * FROM backup_history WHERE job_id = ? AND status = 'success' AND type = 'backup' ORDER BY started_at DESC"
      )
      .all(jobId) as BackupHistoryRow[];
  },

  deleteByRunId(runId: string): void {
    db.prepare("DELETE FROM backup_history WHERE run_id = ?").run(runId);
  },
};
