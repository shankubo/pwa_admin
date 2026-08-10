export type BackupSourceType = "volume" | "db" | "path";
export type BackupTarget = "local" | "gdrive" | "usb";
export type BackupRunType = "backup" | "restore" | "pre-restore-snapshot";
export type BackupRunStatus = "pending" | "running" | "success" | "failed";

export interface BackupJob {
  id: number;
  name: string;
  sourceType: BackupSourceType;
  sourceRef: string;
  targets: BackupTarget[];
  scheduleCron: string | null;
  retentionDays: number | null;
  retentionMinCopies: number | null;
}

export interface BackupHistoryEntry {
  runId: string;
  jobId: number | null;
  type: BackupRunType;
  sourceType: BackupSourceType;
  sourceRef: string;
  /** Primary/first requested target. A run can additionally reach Drive even when
   * this says "local" — check driveFileId for actual Drive upload confirmation. */
  target: BackupTarget;
  /** Set once the archive is confirmed uploaded to Google Drive, regardless of `target`. */
  driveFileId: string | null;
  /** Set once the archive is confirmed copied to the detected USB drive, regardless of `target`. */
  usbPath: string | null;
  status: BackupRunStatus;
  sizeBytes: number | null;
  checksumSha256: string | null;
  durationMs: number | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export type DriveVerificationStatus = "verified" | "missing" | "size-mismatch" | "not-uploaded";

/** Per-history-run Drive verification, keyed by runId — lets the existing
 * history list show a status badge without a separate raw file listing. */
export interface DriveVerificationEntry {
  runId: string;
  status: DriveVerificationStatus;
}

/** A Drive file under BACKUP_LOCAL_ROOT's category/sourceRef layout that
 * doesn't correspond to any known backup_history run — either uploaded
 * outside a tracked run, or its local copy/history row was since deleted. */
export interface OrphanDriveFile {
  fileId: string;
  fileName: string;
  sizeBytes: number;
  modifiedAt: string;
}

export interface OrphanDriveGroup {
  category: string;
  sourceRef: string;
  files: OrphanDriveFile[];
}

export interface GDriveComparisonResult {
  checkedAt: string;
  verifications: DriveVerificationEntry[];
  orphanGroups: OrphanDriveGroup[];
  totalVerified: number;
  totalMissing: number;
  totalOrphans: number;
}

/** A mounted external USB drive detected via lsblk, and the app's own backup
 * root within it (`<mountpoint>/BACKUP/<hostname>`) — namespaced by hostname
 * so one drive can hold backups from several machines without collision. */
export interface UsbDriveInfo {
  mountpoint: string;
  label: string;
  device: string;
  filesystem: string | null;
  totalBytes: number | null;
  freeBytes: number | null;
  backupRoot: string;
}

export interface UsbStatus {
  available: boolean;
  hostname: string;
  drives: UsbDriveInfo[];
}

/** An archive found under a USB drive's BACKUP/<hostname>/<category>/<sourceRef>/
 * tree with no corresponding backup_history row — either from a fresh/wiped
 * database (disaster recovery) or an untracked copy. */
export interface UsbBackupArchive {
  mountpoint: string;
  category: "volumes" | "paths" | "db";
  sourceRef: string;
  fileName: string;
  fullPath: string;
  sizeBytes: number;
  modifiedAt: string;
}

export type DbEngine = "postgres" | "mysql" | "mariadb" | "mongo" | "redis";

export interface DetectedDatabase {
  /** "docker": DB running inside a container, dump via docker exec. "native": DB running as a host OS service, dump via sudo. */
  location: "docker" | "native";
  /** Docker container ID for location=docker, or the systemd service name for location=native. Used as :ref in /dbbackup/:location/:ref/... routes. */
  ref: string;
  displayName: string;
  engine: DbEngine;
  /** Individual database/schema names available on this instance (native only; docker dumps default to all-databases). */
  databases?: string[];
}

/** A host filesystem path bind-mounted into a running container — the data
 * behind it lives directly on the Pi's disk, not in a Docker-managed volume. */
export interface DetectedBindMount {
  containerName: string;
  hostPath: string;
  containerPath: string;
}

export type AppBackupRunKind = "full" | "partial";

/**
 * A logical "app" composed manually by the admin: one or more containers, the
 * host directories behind their bind mounts, and an optional associated
 * database. Backing it up snapshots every path via rsync --link-dest against
 * the previous snapshot (unchanged files become hardlinks — near-zero extra
 * disk for a "full" restore point) plus a full DB dump every run.
 */
export interface Application {
  id: number;
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
}

/**
 * Google Drive upload of a run's *file* snapshot (as opposed to the DB dump,
 * which has its own dbDriveFileId and uploads synchronously since dumps are
 * small). This is separate and asynchronous because a snapshot can be several
 * GB — the local backup completes and is marked "success" immediately, then
 * the Drive upload runs in the background and is tracked here so the UI can
 * show real progress instead of silently never uploading.
 */
export type DriveUploadStatus = "none" | "pending" | "compressing" | "uploading" | "success" | "failed";

export interface AppBackupRun {
  runId: string;
  appId: number;
  kind: AppBackupRunKind;
  status: BackupRunStatus;
  /** Count of files that were actually copied (vs. hardlinked from the previous snapshot) — the "how much changed" signal for a partial run. */
  filesChanged: number | null;
  sizeBytes: number | null;
  dbDriveFileId: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  driveUploadStatus: DriveUploadStatus;
  driveUploadProgressPct: number | null;
  /** One Drive file ID per uploaded path archive (one tar.gz per app path), once driveUploadStatus is "success". */
  driveFileIds: string[] | null;
  driveUploadError: string | null;
  /** Mirrors driveUploadStatus but for the USB drive leg — also asynchronous
   * and best-effort, since a run should still succeed via local (and possibly
   * gdrive) even if no USB drive is plugged in or the copy fails partway. */
  usbCopyStatus: DriveUploadStatus;
  usbCopyProgressPct: number | null;
  /** One USB destination path per copied path archive (one tar.gz per app path), once usbCopyStatus is "success". */
  usbPaths: string[] | null;
  usbCopyError: string | null;
}
