/** Server cleanup ("Nettoyage serveur"): a read-only scan lists what could be
 * removed, then a separate action removes only the categories the admin picks. */

export type CleanupCategoryId =
  | "apt-cache"
  | "journal"
  | "docker-dangling-images"
  | "docker-build-cache"
  | "npm-cache"
  | "app-temp"
  | "tmp-owned"
  | "old-backups";

/** "safe": regenerated on demand, nothing is lost. "review": removes data the admin
 * may still want (old backups, old logs) — never selected by default. */
export type CleanupRisk = "safe" | "review";

export interface CleanupItem {
  label: string;
  sizeBytes: number | null;
  detail?: string;
}

export interface CleanupCategory {
  id: CleanupCategoryId;
  risk: CleanupRisk;
  /** False when the thing doesn't exist on this server (e.g. Docker not installed). */
  available: boolean;
  /** Bytes that cleaning would free; null if it couldn't be measured. */
  sizeBytes: number | null;
  /** True when sizeBytes is the total and the actual gain can only be lower. */
  sizeIsUpperBound: boolean;
  itemCount: number | null;
  /** A sample (largest first) so the admin can see what would go. */
  items: CleanupItem[];
  /** Why this category couldn't be scanned (e.g. missing permission). */
  scanError: string | null;
}

export interface CleanupDiskInfo {
  path: string;
  totalBytes: number;
  freeBytes: number;
  usedPct: number;
}

export interface CleanupFolderSize {
  name: string;
  sizeBytes: number;
}

export interface CleanupScan {
  scannedAt: string;
  disk: CleanupDiskInfo;
  /** Age threshold used to pick old backups. */
  backupDays: number;
  /** The newest N successful backups of each source are always kept, whatever their age. */
  backupMinCopies: number;
  categories: CleanupCategory[];
  /** Where the local backup space goes (data/backups subfolders), biggest first. */
  localBackups: CleanupFolderSize[];
}

export interface CleanupRunResult {
  id: CleanupCategoryId;
  ok: boolean;
  freedBytes: number | null;
  /** Error code when ok is false; a short note when something was skipped. */
  message: string | null;
}

export interface CleanupRunResponse {
  results: CleanupRunResult[];
  freeBytesBefore: number;
  freeBytesAfter: number;
}
