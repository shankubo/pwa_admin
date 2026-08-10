import { db } from "../index.js";
import { randomUUID } from "node:crypto";
import type {
  Application,
  AppBackupRun,
  AppBackupRunKind,
  BackupTarget,
  BackupRunStatus,
  DriveUploadStatus,
} from "@pwa-admin/shared";

export interface ApplicationRow {
  id: number;
  name: string;
  container_names: string;
  paths: string;
  db_location: string | null;
  db_ref: string | null;
  targets: string;
  schedule_full_cron: string | null;
  schedule_partial_cron: string | null;
  retention_days: number | null;
  retention_min_copies: number | null;
}

export interface AppBackupRunRow {
  id: number;
  run_id: string;
  app_id: number;
  kind: AppBackupRunKind;
  snapshot_dir: string;
  db_dump_path: string | null;
  db_drive_file_id: string | null;
  status: BackupRunStatus;
  files_changed: number | null;
  size_bytes: number | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
  drive_upload_status: DriveUploadStatus;
  drive_upload_progress_pct: number | null;
  drive_file_ids: string | null;
  drive_upload_error: string | null;
  usb_copy_status: DriveUploadStatus;
  usb_copy_progress_pct: number | null;
  usb_paths: string | null;
  usb_copy_error: string | null;
}

export function applicationToApiShape(row: ApplicationRow): Application {
  return {
    id: row.id,
    name: row.name,
    containerNames: JSON.parse(row.container_names),
    paths: JSON.parse(row.paths),
    dbLocation: (row.db_location as "docker" | "native" | null) ?? null,
    dbRef: row.db_ref,
    targets: JSON.parse(row.targets) as BackupTarget[],
    scheduleFullCron: row.schedule_full_cron,
    schedulePartialCron: row.schedule_partial_cron,
    retentionDays: row.retention_days,
    retentionMinCopies: row.retention_min_copies,
  };
}

export function appBackupRunToApiShape(row: AppBackupRunRow): AppBackupRun {
  return {
    runId: row.run_id,
    appId: row.app_id,
    kind: row.kind,
    status: row.status,
    filesChanged: row.files_changed,
    sizeBytes: row.size_bytes,
    dbDriveFileId: row.db_drive_file_id,
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    driveUploadStatus: row.drive_upload_status,
    driveUploadProgressPct: row.drive_upload_progress_pct,
    driveFileIds: row.drive_file_ids ? JSON.parse(row.drive_file_ids) : null,
    driveUploadError: row.drive_upload_error,
    usbCopyStatus: row.usb_copy_status,
    usbCopyProgressPct: row.usb_copy_progress_pct,
    usbPaths: row.usb_paths ? JSON.parse(row.usb_paths) : null,
    usbCopyError: row.usb_copy_error,
  };
}

export const ApplicationModel = {
  create(input: {
    name: string;
    containerNames: string[];
    paths: string[];
    dbLocation?: "docker" | "native" | null;
    dbRef?: string | null;
    targets: BackupTarget[];
    scheduleFullCron?: string | null;
    schedulePartialCron?: string | null;
    retentionDays?: number | null;
    retentionMinCopies?: number | null;
  }): ApplicationRow {
    const result = db
      .prepare(
        `INSERT INTO applications
         (name, container_names, paths, db_location, db_ref, targets, schedule_full_cron, schedule_partial_cron, retention_days, retention_min_copies)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.name,
        JSON.stringify(input.containerNames),
        JSON.stringify(input.paths),
        input.dbLocation ?? null,
        input.dbRef ?? null,
        JSON.stringify(input.targets),
        input.scheduleFullCron ?? null,
        input.schedulePartialCron ?? null,
        input.retentionDays ?? null,
        input.retentionMinCopies ?? null
      );
    return this.findById(Number(result.lastInsertRowid))!;
  },

  findById(id: number): ApplicationRow | undefined {
    return db.prepare("SELECT * FROM applications WHERE id = ?").get(id) as ApplicationRow | undefined;
  },

  list(): ApplicationRow[] {
    return db.prepare("SELECT * FROM applications ORDER BY name").all() as ApplicationRow[];
  },

  update(
    id: number,
    fields: Partial<{
      name: string;
      containerNames: string[];
      paths: string[];
      dbLocation: "docker" | "native" | null;
      dbRef: string | null;
      targets: BackupTarget[];
      scheduleFullCron: string | null;
      schedulePartialCron: string | null;
      retentionDays: number | null;
      retentionMinCopies: number | null;
    }>
  ): void {
    const current = this.findById(id);
    if (!current) return;
    db.prepare(
      `UPDATE applications SET
        name = ?, container_names = ?, paths = ?, db_location = ?, db_ref = ?,
        targets = ?, schedule_full_cron = ?, schedule_partial_cron = ?,
        retention_days = ?, retention_min_copies = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      fields.name ?? current.name,
      fields.containerNames ? JSON.stringify(fields.containerNames) : current.container_names,
      fields.paths ? JSON.stringify(fields.paths) : current.paths,
      fields.dbLocation !== undefined ? fields.dbLocation : current.db_location,
      fields.dbRef !== undefined ? fields.dbRef : current.db_ref,
      fields.targets ? JSON.stringify(fields.targets) : current.targets,
      fields.scheduleFullCron !== undefined ? fields.scheduleFullCron : current.schedule_full_cron,
      fields.schedulePartialCron !== undefined ? fields.schedulePartialCron : current.schedule_partial_cron,
      fields.retentionDays !== undefined ? fields.retentionDays : current.retention_days,
      fields.retentionMinCopies !== undefined ? fields.retentionMinCopies : current.retention_min_copies,
      id
    );
  },

  delete(id: number): void {
    db.prepare("DELETE FROM applications WHERE id = ?").run(id);
  },
};

export const AppBackupRunModel = {
  createRun(input: { appId: number; kind: AppBackupRunKind; snapshotDir: string }): string {
    const runId = randomUUID();
    db.prepare(
      `INSERT INTO app_backup_runs (run_id, app_id, kind, snapshot_dir, status) VALUES (?, ?, ?, ?, 'running')`
    ).run(runId, input.appId, input.kind, input.snapshotDir);
    return runId;
  },

  complete(
    runId: string,
    result: {
      status: BackupRunStatus;
      dbDumpPath?: string;
      dbDriveFileId?: string;
      filesChanged?: number;
      sizeBytes?: number;
      error?: string;
    }
  ): void {
    db.prepare(
      `UPDATE app_backup_runs SET status = ?, db_dump_path = ?, db_drive_file_id = ?, files_changed = ?, size_bytes = ?, error = ?, finished_at = datetime('now')
       WHERE run_id = ?`
    ).run(
      result.status,
      result.dbDumpPath ?? null,
      result.dbDriveFileId ?? null,
      result.filesChanged ?? null,
      result.sizeBytes ?? null,
      result.error ?? null,
      runId
    );
  },

  setDriveUploadStatus(
    runId: string,
    status: DriveUploadStatus,
    fields: { progressPct?: number; fileIds?: string[]; error?: string } = {}
  ): void {
    const current = this.findByRunId(runId);
    db.prepare(
      `UPDATE app_backup_runs SET drive_upload_status = ?, drive_upload_progress_pct = ?, drive_file_ids = ?, drive_upload_error = ?
       WHERE run_id = ?`
    ).run(
      status,
      fields.progressPct !== undefined ? fields.progressPct : (current?.drive_upload_progress_pct ?? null),
      fields.fileIds ? JSON.stringify(fields.fileIds) : (current?.drive_file_ids ?? null),
      fields.error !== undefined ? fields.error : (current?.drive_upload_error ?? null),
      runId
    );
  },

  setUsbCopyStatus(
    runId: string,
    status: DriveUploadStatus,
    fields: { progressPct?: number; paths?: string[]; error?: string } = {}
  ): void {
    const current = this.findByRunId(runId);
    db.prepare(
      `UPDATE app_backup_runs SET usb_copy_status = ?, usb_copy_progress_pct = ?, usb_paths = ?, usb_copy_error = ?
       WHERE run_id = ?`
    ).run(
      status,
      fields.progressPct !== undefined ? fields.progressPct : (current?.usb_copy_progress_pct ?? null),
      fields.paths ? JSON.stringify(fields.paths) : (current?.usb_paths ?? null),
      fields.error !== undefined ? fields.error : (current?.usb_copy_error ?? null),
      runId
    );
  },

  findByRunId(runId: string): AppBackupRunRow | undefined {
    return db.prepare("SELECT * FROM app_backup_runs WHERE run_id = ?").get(runId) as
      | AppBackupRunRow
      | undefined;
  },

  listByApp(appId: number, limit = 50): AppBackupRunRow[] {
    return db
      .prepare("SELECT * FROM app_backup_runs WHERE app_id = ? ORDER BY started_at DESC LIMIT ?")
      .all(appId, limit) as AppBackupRunRow[];
  },

  lastSuccessful(appId: number): AppBackupRunRow | undefined {
    return db
      .prepare(
        "SELECT * FROM app_backup_runs WHERE app_id = ? AND status = 'success' ORDER BY started_at DESC LIMIT 1"
      )
      .get(appId) as AppBackupRunRow | undefined;
  },

  list(limit = 100): AppBackupRunRow[] {
    return db.prepare("SELECT * FROM app_backup_runs ORDER BY started_at DESC LIMIT ?").all(limit) as AppBackupRunRow[];
  },
};
