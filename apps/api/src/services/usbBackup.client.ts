import { hostname } from "node:os";
import { mkdir, stat, readdir, copyFile, unlink, statfs } from "node:fs/promises";
import { join, resolve, sep, dirname, basename } from "node:path";
import { runCommand } from "../utils/exec.js";
import type { UsbDriveInfo, UsbStatus, UsbBackupArchive } from "@pwa-admin/shared";

interface LsblkDevice {
  name: string;
  mountpoint: string | null;
  fstype: string | null;
  label: string | null;
  tran: string | null;
  rm: boolean;
  hotplug: boolean;
  children?: LsblkDevice[];
}
interface LsblkOutput {
  blockdevices: LsblkDevice[];
}

const BACKUP_ROOT_SEGMENT = "BACKUP";

function sanitizeSegment(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!cleaned || cleaned === "." || cleaned === "..") throw new Error("invalid_path_segment");
  return cleaned;
}

export function currentHostnameSlug(): string {
  return sanitizeSegment(hostname());
}

/**
 * lsblk's TRAN/RM fields describe the whole-disk device, not always the
 * partition — a USB Attached SCSI (UAS) external SSD shows tran="usb" on the
 * parent disk but tran=null on its own partitions. Partitions inherit their
 * parent's USB-ness when their own fields are empty.
 */
function collectUsbMountedPartitions(devices: LsblkDevice[]): LsblkDevice[] {
  const result: LsblkDevice[] = [];
  for (const dev of devices) {
    const devIsUsb = dev.tran === "usb" || dev.rm === true;
    if (devIsUsb && dev.mountpoint) result.push(dev);
    for (const child of dev.children ?? []) {
      const childIsUsb = devIsUsb || child.tran === "usb" || child.rm === true;
      if (childIsUsb && child.mountpoint) result.push(child);
    }
  }
  return result;
}

async function freeSpace(mountpoint: string): Promise<{ totalBytes: number | null; freeBytes: number | null }> {
  try {
    const s = await statfs(mountpoint);
    return { totalBytes: s.blocks * s.bsize, freeBytes: s.bavail * s.bsize };
  } catch {
    return { totalBytes: null, freeBytes: null };
  }
}

export const UsbBackupService = {
  async detectDrives(): Promise<UsbDriveInfo[]> {
    let parsed: LsblkOutput;
    try {
      const { stdout } = await runCommand(
        "lsblk",
        ["-J", "-o", "NAME,MOUNTPOINT,FSTYPE,LABEL,TRAN,RM,HOTPLUG"],
        { timeoutMs: 5000 }
      );
      parsed = JSON.parse(stdout);
    } catch {
      return [];
    }

    const mounted = collectUsbMountedPartitions(parsed.blockdevices ?? []);
    const hostSlug = currentHostnameSlug();
    const drives: UsbDriveInfo[] = [];
    for (const dev of mounted) {
      const mountpoint = dev.mountpoint!;
      const { totalBytes, freeBytes } = await freeSpace(mountpoint);
      drives.push({
        mountpoint,
        label: dev.label || dev.name,
        device: `/dev/${dev.name}`,
        filesystem: dev.fstype,
        totalBytes,
        freeBytes,
        backupRoot: join(mountpoint, BACKUP_ROOT_SEGMENT, hostSlug),
      });
    }
    return drives;
  },

  async status(): Promise<UsbStatus> {
    const drives = await this.detectDrives();
    return { available: drives.length > 0, hostname: currentHostnameSlug(), drives };
  },

  async isAvailable(): Promise<boolean> {
    return (await this.detectDrives()).length > 0;
  },

  buildArchivePath(
    mountpoint: string,
    category: "volumes" | "paths" | "db",
    sourceRef: string,
    fileName: string
  ): string {
    const hostSlug = currentHostnameSlug();
    const safeSourceRef = sanitizeSegment(sourceRef);
    const safeFileName = sanitizeSegment(fileName.replace(/\.tar\.gz$/, "")) + ".tar.gz";
    const backupRoot = resolve(mountpoint, BACKUP_ROOT_SEGMENT, hostSlug);
    const candidate = resolve(backupRoot, category, safeSourceRef, safeFileName);
    if (!candidate.startsWith(backupRoot + sep)) throw new Error("path_traversal_rejected");
    return candidate;
  },

  async copyBackupFile(
    localPath: string,
    category: "volumes" | "paths" | "db",
    sourceRef: string
  ): Promise<{ usbPath: string; mountpoint: string }> {
    const drives = await this.detectDrives();
    if (drives.length === 0) throw new Error("no_usb_drive_detected");
    const drive = drives[0]; // single-drive write support this iteration
    const fileName = basename(localPath);
    const destPath = this.buildArchivePath(drive.mountpoint, category, sourceRef, fileName);
    await mkdir(dirname(destPath), { recursive: true });
    const expectedSize = (await stat(localPath)).size;
    await copyFile(localPath, destPath);
    const actualSize = (await stat(destPath)).size;
    if (actualSize !== expectedSize) {
      await unlink(destPath).catch(() => {});
      throw new Error("usb_copy_size_mismatch");
    }
    return { usbPath: destPath, mountpoint: drive.mountpoint };
  },

  /** Restore-side counterpart to browsing: archives present on a USB drive
   * with no corresponding backup_history row, e.g. after moving to a fresh
   * server with an empty database. */
  async browseArchives(): Promise<UsbBackupArchive[]> {
    const drives = await this.detectDrives();
    const archives: UsbBackupArchive[] = [];
    for (const drive of drives) {
      for (const category of ["volumes", "paths", "db"] as const) {
        const categoryDir = join(drive.backupRoot, category);
        let sourceRefs: string[];
        try {
          sourceRefs = (await readdir(categoryDir, { withFileTypes: true }))
            .filter((e) => e.isDirectory())
            .map((e) => e.name);
        } catch {
          continue;
        }
        for (const sourceRef of sourceRefs) {
          const sourceDir = join(categoryDir, sourceRef);
          let files: string[];
          try {
            files = await readdir(sourceDir);
          } catch {
            continue;
          }
          for (const fileName of files.filter((f) => f.endsWith(".tar.gz"))) {
            const fullPath = join(sourceDir, fileName);
            const s = await stat(fullPath);
            archives.push({
              mountpoint: drive.mountpoint,
              category,
              sourceRef,
              fileName,
              fullPath,
              sizeBytes: s.size,
              modifiedAt: s.mtime.toISOString(),
            });
          }
        }
      }
    }
    return archives.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  },

  /** Anti path-traversal gate called before any archive path (whether from
   * backup_history.usb_path or a client-supplied browse selection) is ever
   * handed to tar. */
  async validateArchivePath(candidatePath: string): Promise<boolean> {
    const drives = await this.detectDrives();
    const resolved = resolve(candidatePath);
    return drives.some((d) => resolved.startsWith(resolve(d.backupRoot) + sep));
  },
};
