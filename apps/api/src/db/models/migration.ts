import { db } from "../index.js";
import type {
  MigrationManifest,
  MigrationSnapshotRun,
  MigrationSnapshotStatus,
  MigrationManifestScope,
  MigrationRestoreRun,
  MigrationRestoreStatus,
  MigrationRestoreItemResult,
} from "@pwa-admin/shared";

export interface MigrationSnapshotRow {
  id: number;
  manifest_id: string;
  scope: string;
  status: MigrationSnapshotStatus;
  manifest_json: string | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

export function migrationSnapshotToApiShape(row: MigrationSnapshotRow): MigrationSnapshotRun {
  return {
    manifestId: row.manifest_id,
    scope: JSON.parse(row.scope) as MigrationManifestScope,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    error: row.error,
  };
}

export const MigrationSnapshotModel = {
  createRun(manifestId: string, scope: MigrationManifestScope): void {
    db.prepare(
      `INSERT INTO migration_snapshots (manifest_id, scope, status) VALUES (?, ?, 'running')`
    ).run(manifestId, JSON.stringify(scope));
  },

  complete(manifestId: string, result: { status: MigrationSnapshotStatus; manifest?: MigrationManifest; error?: string }): void {
    db.prepare(
      `UPDATE migration_snapshots SET status = ?, manifest_json = ?, error = ?, finished_at = datetime('now')
       WHERE manifest_id = ?`
    ).run(
      result.status,
      result.manifest ? JSON.stringify(result.manifest) : null,
      result.error ?? null,
      manifestId
    );
  },

  findByManifestId(manifestId: string): MigrationSnapshotRow | undefined {
    return db.prepare("SELECT * FROM migration_snapshots WHERE manifest_id = ?").get(manifestId) as
      | MigrationSnapshotRow
      | undefined;
  },

  list(limit = 50): MigrationSnapshotRow[] {
    return db
      .prepare("SELECT * FROM migration_snapshots ORDER BY started_at DESC LIMIT ?")
      .all(limit) as MigrationSnapshotRow[];
  },
};

export interface MigrationRestoreRow {
  id: number;
  restore_id: string;
  manifest_id: string;
  status: MigrationRestoreStatus;
  include_os_packages: number;
  items_json: string | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

export function migrationRestoreToApiShape(row: MigrationRestoreRow): MigrationRestoreRun {
  return {
    restoreId: row.restore_id,
    manifestId: row.manifest_id,
    status: row.status,
    includeOsPackages: !!row.include_os_packages,
    items: row.items_json ? (JSON.parse(row.items_json) as MigrationRestoreItemResult[]) : [],
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    error: row.error,
  };
}

export const MigrationRestoreModel = {
  createRun(restoreId: string, manifestId: string, includeOsPackages: boolean): void {
    db.prepare(
      `INSERT INTO migration_restores (restore_id, manifest_id, status, include_os_packages) VALUES (?, ?, 'running', ?)`
    ).run(restoreId, manifestId, includeOsPackages ? 1 : 0);
  },

  setItems(restoreId: string, items: MigrationRestoreItemResult[]): void {
    db.prepare("UPDATE migration_restores SET items_json = ? WHERE restore_id = ?").run(
      JSON.stringify(items),
      restoreId
    );
  },

  complete(restoreId: string, result: { status: MigrationRestoreStatus; error?: string }): void {
    db.prepare(
      `UPDATE migration_restores SET status = ?, error = ?, finished_at = datetime('now') WHERE restore_id = ?`
    ).run(result.status, result.error ?? null, restoreId);
  },

  findByRestoreId(restoreId: string): MigrationRestoreRow | undefined {
    return db.prepare("SELECT * FROM migration_restores WHERE restore_id = ?").get(restoreId) as
      | MigrationRestoreRow
      | undefined;
  },

  list(limit = 50): MigrationRestoreRow[] {
    return db
      .prepare("SELECT * FROM migration_restores ORDER BY started_at DESC LIMIT ?")
      .all(limit) as MigrationRestoreRow[];
  },
};

/**
 * Idempotence tracking for migration restores: one row per (targetKind,
 * targetName) — e.g. ("docker-image", "my-app") or ("nginx-config",
 * "server") — holding the checksum of whatever archive was last restored
 * onto it. A re-run of the same manifest (retry after a partial failure,
 * accidental double-click) compares against this before touching anything,
 * so an already-applied item is skipped instead of redone.
 */
export const MigrationRestoredArchiveModel = {
  getChecksum(targetKind: string, targetName: string): string | undefined {
    const row = db
      .prepare("SELECT checksum_sha256 FROM migration_restored_archives WHERE target_kind = ? AND target_name = ?")
      .get(targetKind, targetName) as { checksum_sha256: string } | undefined;
    return row?.checksum_sha256;
  },

  setChecksum(targetKind: string, targetName: string, checksum: string): void {
    db.prepare(
      `INSERT INTO migration_restored_archives (target_kind, target_name, checksum_sha256, restored_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(target_kind, target_name) DO UPDATE SET checksum_sha256 = excluded.checksum_sha256, restored_at = datetime('now')`
    ).run(targetKind, targetName, checksum);
  },
};
