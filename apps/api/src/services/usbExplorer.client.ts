import { lstat, readdir, realpath, rm, stat } from "node:fs/promises";
import type { Stats } from "node:fs";
import { dirname, join, relative, resolve, sep, basename } from "node:path";
import { UsbBackupService } from "./usbBackup.client.js";
import { BackupHistoryModel } from "../db/models/backup.js";
import type { UsbExplorerListing, UsbExplorerEntry, UsbExplorerEntryKind } from "@pwa-admin/shared";

/**
 * Read-only browser over a USB drive's raw BACKUP/ tree — the "Disque
 * externe USB" menu page's backend. Deliberately walks BACKUP/ at its own
 * root (every hostname folder present), not BACKUP/<this machine's
 * hostname>/ like UsbBackupService.detectDrives()'s backupRoot does — the
 * whole point of this page is to let the admin see and act on a migration
 * snapshot captured by a DIFFERENT, possibly since-replaced machine, the
 * same reasoning MigrationService.listManifestsOnUsb() already applies.
 */

function classifyEntry(name: string, isDirectory: boolean): UsbExplorerEntryKind {
  if (isDirectory) return "folder";
  if (name === "manifest.json") return "manifest";
  if (name.endsWith(".json")) return "json";
  if (name.endsWith(".tar.gz") || name.endsWith(".tgz") || name.endsWith(".sh")) return "archive";
  return "file";
}

/** Every drive's BACKUP/ root, resolved once — the anti-path-traversal
 * boundary every browsed path is checked against below. */
async function backupRoots(): Promise<{ mountpoint: string; backupRoot: string }[]> {
  const drives = await UsbBackupService.detectDrives();
  return drives.map((d) => ({ mountpoint: d.mountpoint, backupRoot: resolve(join(d.mountpoint, "BACKUP")) }));
}

/** BACKUP/<hostname>/<category>/<item> is the shallowest thing that may be
 * downloaded or deleted. Everything above it — the drive's BACKUP folder, a
 * machine's folder, a category folder — can only be browsed, so one click can
 * never wipe a whole machine's backups. */
const MIN_MANAGEABLE_DEPTH = 3;

interface ResolvedEntry {
  abs: string;
  root: string;
  stats: Stats;
}

/** The single gate for download and delete: resolves a client-supplied path under
 * a drive's BACKUP/ root and rejects anything outside it, too shallow, a
 * symlink, or reached through a symlinked parent (checked on real paths). */
async function resolveManageable(mountpoint: string, relativePath: string): Promise<ResolvedEntry> {
  const root = (await backupRoots()).find((r) => r.mountpoint === mountpoint);
  if (!root) throw new Error("usb_drive_not_found");

  const abs = resolve(root.backupRoot, relativePath || ".");
  if (!abs.startsWith(root.backupRoot + sep)) throw new Error("path_traversal_rejected");

  const depth = relative(root.backupRoot, abs).split(sep).filter(Boolean).length;
  if (depth < MIN_MANAGEABLE_DEPTH) throw new Error("path_not_allowed");

  let stats: Stats;
  try {
    stats = await lstat(abs);
  } catch {
    throw new Error("not_found");
  }
  if (stats.isSymbolicLink()) throw new Error("symlink_rejected");

  const [realRoot, realAbs] = await Promise.all([realpath(root.backupRoot), realpath(abs)]);
  if (!realAbs.startsWith(realRoot + sep)) throw new Error("path_traversal_rejected");

  return { abs, root: root.backupRoot, stats };
}

export const UsbExplorerService = {
  /** Validates a download request and describes what will be streamed: a file
   * as-is, or a folder (e.g. a migration snapshot) packed on the fly as .tar. */
  async prepareDownload(
    mountpoint: string,
    relativePath: string
  ): Promise<{ abs: string; name: string; isDirectory: boolean; sizeBytes: number | null }> {
    const { abs, stats } = await resolveManageable(mountpoint, relativePath);
    const isDirectory = stats.isDirectory();
    if (!isDirectory && !stats.isFile()) throw new Error("unsupported_entry");
    return { abs, name: basename(abs), isDirectory, sizeBytes: isDirectory ? null : stats.size };
  },

  /** Deletes a backup file or a whole folder (a migration snapshot, a source's
   * archives). Runs as the service account — no sudo — so a file it can't remove
   * fails with permission_denied rather than being forced. USB copies recorded in
   * the history are detached so the history doesn't claim a copy that is gone. */
  async remove(mountpoint: string, relativePath: string): Promise<{ detachedHistoryRows: number }> {
    const { abs, stats } = await resolveManageable(mountpoint, relativePath);
    if (!stats.isDirectory() && !stats.isFile()) throw new Error("unsupported_entry");

    try {
      await rm(abs, { recursive: stats.isDirectory(), force: false });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EACCES" || code === "EPERM") throw new Error("permission_denied");
      if (code === "EBUSY") throw new Error("entry_busy");
      throw err;
    }

    return { detachedHistoryRows: BackupHistoryModel.clearUsbPathsUnder(abs) };
  },

  /** The parent folder and name `tar` needs to pack a folder download. */
  tarArgs(abs: string): string[] {
    return ["-cf", "-", "-C", dirname(abs), basename(abs)];
  },

  /**
   * Lists one directory under a drive's BACKUP/ root. `relativePath` is
   * relative to BACKUP/ itself ("" for the top-level list of hostname
   * folders) — validated to never resolve outside that root before any
   * filesystem access, same pattern as Nginx's resolveVhostPath.
   */
  async list(mountpoint: string, relativePath: string): Promise<UsbExplorerListing> {
    const roots = await backupRoots();
    const root = roots.find((r) => r.mountpoint === mountpoint);
    if (!root) throw new Error("usb_drive_not_found");

    const targetDir = resolve(root.backupRoot, relativePath || ".");
    if (targetDir !== root.backupRoot && !targetDir.startsWith(root.backupRoot + sep)) {
      throw new Error("path_traversal_rejected");
    }

    // Hostname is only meaningful one level below BACKUP/ (BACKUP/<hostname>/...) —
    // surfaced per-entry so the UI can show "which machine" without the admin
    // having to infer it from the breadcrumb alone.
    const segments = relativePath ? relativePath.split(/[\\/]+/).filter(Boolean) : [];
    const hostnameForChildren = segments.length >= 1 ? segments[0] : null;

    let dirents;
    try {
      dirents = await readdir(targetDir, { withFileTypes: true });
    } catch {
      return { mountpoint, relativePath, entries: [] };
    }

    const entries: UsbExplorerEntry[] = [];
    for (const dirent of dirents) {
      const entryPath = join(targetDir, dirent.name);
      const isDirectory = dirent.isDirectory();
      let sizeBytes: number | null = null;
      let modifiedAt = new Date(0).toISOString();
      try {
        const s = await stat(entryPath);
        sizeBytes = isDirectory ? null : s.size;
        modifiedAt = s.mtime.toISOString();
      } catch {
        continue; // dangling entry (e.g. broken symlink) — skip rather than fail the whole listing
      }

      const kind = classifyEntry(dirent.name, isDirectory);
      let migrationManifestId: string | null = null;
      if (kind === "manifest") {
        // migration/<manifestId>/manifest.json — the manifestId is the
        // parent folder name, read back out rather than re-parsing the file
        // here (MigrationService.listManifestsOnUsb already does that, and
        // is the single source of truth for manifest content).
        migrationManifestId = basename(targetDir);
      }

      entries.push({
        name: dirent.name,
        path: join(relativePath, dirent.name).replace(/\\/g, "/"),
        kind,
        isDirectory,
        sizeBytes,
        modifiedAt,
        hostname: relativePath ? hostnameForChildren : dirent.name,
        migrationManifestId,
        manageable: segments.length + 1 >= MIN_MANAGEABLE_DEPTH && !dirent.isSymbolicLink(),
      });
    }

    entries.sort((a, b) => (a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1));
    return { mountpoint, relativePath, entries };
  },
};
