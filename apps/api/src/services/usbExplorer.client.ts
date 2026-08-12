import { readdir, stat } from "node:fs/promises";
import { join, resolve, sep, basename } from "node:path";
import { UsbBackupService } from "./usbBackup.client.js";
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

export const UsbExplorerService = {
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
      });
    }

    entries.sort((a, b) => (a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1));
    return { mountpoint, relativePath, entries };
  },
};
