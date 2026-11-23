import { hostname } from "node:os";
import { mkdir, stat, readdir, copyFile, unlink, statfs } from "node:fs/promises";
import { join, resolve, sep, dirname, basename } from "node:path";
import { runCommand } from "../utils/exec.js";
import { BackupCrypto, ENCRYPTED_SUFFIX, ENCRYPTION_OVERHEAD } from "./backupCrypto.js";
import type { UsbDriveInfo, UsbStatus, UsbBackupArchive } from "@pwa-admin/shared";

interface LsblkDevice {
  name: string;
  mountpoint: string | null;
  fstype: string | null;
  label: string | null;
  type?: string;
  size?: number | string | null;
  /** All mountpoints (util-linux >= 2.37). `mountpoint` alone reports only the
   * LAST one, which hides a system mount when the same partition is also
   * mounted elsewhere. */
  mountpoints?: (string | null)[];
  tran: string | null;
  rm: boolean;
  hotplug: boolean;
  children?: LsblkDevice[];
}
interface LsblkOutput {
  blockdevices: LsblkDevice[];
}

const BACKUP_ROOT_SEGMENT = "BACKUP";

/** Root helper (deploy/usb-backup/backup-usb-luks.sh) behind the one scoped sudoers rule. */
export const LUKS_HELPER = "/usr/local/bin/backup-usb-luks.sh";

// Mount points that are never a backup target even if lsblk reports tran=usb
// on them — e.g. a Raspberry Pi booting its rootfs off an external USB/SSD
// (common once the SD card is retired) would otherwise show its own system
// disk as an "available USB backup drive".
const SYSTEM_MOUNTPOINTS = new Set(["/", "/boot", "/boot/firmware"]);

export function sanitizeSegment(value: string): string {
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
interface UsbScan {
  /** Mounted, non-system USB filesystems; `partition` is the underlying
   * partition (the LUKS one when `encrypted`). */
  mounted: { dev: LsblkDevice; partition: string; encrypted: boolean }[];
  /** USB-attached mountpoints dropped because they're this machine's own
   * system mounts (see SYSTEM_MOUNTPOINTS) — surfaced so the UI can warn
   * "this server's rootfs lives on external USB/SSD storage". */
  systemMountpoints: string[];
  /** LUKS partitions with no unlocked mapper child yet. */
  locked: LsblkDevice[];
  /** Plain USB partitions with a mountable filesystem that aren't mounted. */
  unmounted: LsblkDevice[];
}

const MOUNTABLE_FSTYPES = new Set(["exfat", "vfat", "ntfs", "ext2", "ext3", "ext4", "xfs", "btrfs"]);

function mountpointsOf(dev: LsblkDevice): string[] {
  const list = dev.mountpoints && dev.mountpoints.length > 0 ? dev.mountpoints : [dev.mountpoint];
  return list.filter((m): m is string => typeof m === "string" && m.length > 0);
}

/** System mountpoints (/, /boot, /boot/firmware) anywhere under this device. */
function systemMountsIn(dev: LsblkDevice): string[] {
  const own = mountpointsOf(dev).filter((m) => SYSTEM_MOUNTPOINTS.has(m));
  return [...own, ...(dev.children ?? []).flatMap(systemMountsIn)];
}

/** Walks the whole lsblk tree: an unlocked LUKS drive is a grandchild
 * (disk > partition > crypt mapper), so a fixed two-level loop would miss it. */
export function scanUsb(devices: LsblkDevice[]): UsbScan {
  const scan: UsbScan = { mounted: [], systemMountpoints: [], locked: [], unmounted: [] };

  function visit(dev: LsblkDevice, parentIsUsb: boolean, parentPartition: string | null): void {
    const isUsb = parentIsUsb || dev.tran === "usb" || dev.rm === true;
    const isCrypt = dev.type === "crypt";
    if (isUsb && dev.mountpoint) {
      if (SYSTEM_MOUNTPOINTS.has(dev.mountpoint)) scan.systemMountpoints.push(dev.mountpoint);
      else scan.mounted.push({ dev, partition: isCrypt && parentPartition ? parentPartition : dev.name, encrypted: isCrypt });
    }
    const children = dev.children ?? [];
    if (isUsb && dev.fstype === "crypto_LUKS" && !children.some((c) => c.type === "crypt")) scan.locked.push(dev);
    if (isUsb && dev.type === "part" && !dev.mountpoint && dev.fstype && MOUNTABLE_FSTYPES.has(dev.fstype)) {
      scan.unmounted.push(dev);
    }
    for (const child of children) visit(child, isUsb, dev.name);
  }

  for (const dev of devices) {
    // A disk that hosts any system mount (a server booting from an external
    // USB/SSD) is never a backup, format or encryption candidate — not even for
    // its other partitions, and not when the udev rule also mounted its
    // partitions under /media/backup-usb (lsblk then reports only that last
    // mountpoint, hiding the real one).
    const system = systemMountsIn(dev);
    if (system.length > 0) {
      if (dev.tran === "usb" || dev.rm === true) scan.systemMountpoints.push(...system);
      continue;
    }
    visit(dev, false, null);
  }
  return scan;
}

async function freeSpace(mountpoint: string): Promise<{ totalBytes: number | null; freeBytes: number | null }> {
  try {
    const s = await statfs(mountpoint);
    return { totalBytes: s.blocks * s.bsize, freeBytes: s.bavail * s.bsize };
  } catch {
    return { totalBytes: null, freeBytes: null };
  }
}

async function lsblkDevices(): Promise<LsblkDevice[]> {
  try {
    const { stdout } = await runCommand(
      "lsblk",
      ["-J", "-b", "-o", "NAME,MOUNTPOINT,MOUNTPOINTS,FSTYPE,LABEL,TYPE,SIZE,TRAN,RM,HOTPLUG"],
      { timeoutMs: 5000 }
    );
    return (JSON.parse(stdout) as LsblkOutput).blockdevices ?? [];
  } catch {
    // util-linux older than 2.37 has no MOUNTPOINTS column.
    try {
      const { stdout } = await runCommand(
        "lsblk",
        ["-J", "-b", "-o", "NAME,MOUNTPOINT,FSTYPE,LABEL,TYPE,SIZE,TRAN,RM,HOTPLUG"],
        { timeoutMs: 5000 }
      );
      return (JSON.parse(stdout) as LsblkOutput).blockdevices ?? [];
    } catch {
      return [];
    }
  }
}

export const UsbBackupService = {
  async detectDrives(): Promise<UsbDriveInfo[]> {
    const devices = await lsblkDevices();
    const hostSlug = currentHostnameSlug();
    const drives: UsbDriveInfo[] = [];
    for (const { dev, partition, encrypted } of scanUsb(devices).mounted) {
      const mountpoint = dev.mountpoint!;
      const { totalBytes, freeBytes } = await freeSpace(mountpoint);
      const backupRoot = join(mountpoint, BACKUP_ROOT_SEGMENT, hostSlug);
      const isBackupConfigured = await stat(backupRoot)
        .then((s) => s.isDirectory())
        .catch(() => false);
      drives.push({
        mountpoint,
        label: dev.label || dev.name,
        device: encrypted ? `/dev/mapper/${dev.name}` : `/dev/${dev.name}`,
        filesystem: dev.fstype,
        totalBytes,
        freeBytes,
        backupRoot,
        partition,
        encrypted,
        isBackupConfigured,
      });
    }
    return drives;
  },

  /** Designates a detected-but-unconfigured USB/SSD drive as a backup target
   * by creating BACKUP/<hostname> on it — the marker collectUsbMountedPartitions'
   * callers use to distinguish an intentional backup drive from any other USB
   * storage that happens to be plugged in. */
  async enableAsBackupDrive(mountpoint: string): Promise<UsbDriveInfo> {
    const drives = await this.detectDrives();
    const drive = drives.find((d) => d.mountpoint === mountpoint);
    if (!drive) throw new Error("usb_drive_not_found");
    await mkdir(drive.backupRoot, { recursive: true });
    return { ...drive, isBackupConfigured: true };
  },

  async status(): Promise<UsbStatus> {
    const [drives, devices] = await Promise.all([this.detectDrives(), lsblkDevices()]);
    const scan = scanUsb(devices);
    return {
      available: drives.length > 0,
      hostname: currentHostnameSlug(),
      drives,
      lockedDrives: scan.locked.map((d) => ({
        partition: d.name,
        device: `/dev/${d.name}`,
        label: d.label || d.name,
        sizeBytes: d.size != null ? Number(d.size) : null,
      })),
      unmountedDrives: scan.unmounted.map((d) => ({
        partition: d.name,
        device: `/dev/${d.name}`,
        label: d.label || d.name,
        filesystem: d.fstype,
        sizeBytes: d.size != null ? Number(d.size) : null,
      })),
      systemMountpointsOnUsb: scan.systemMountpoints,
    };
  },

  async isAvailable(): Promise<boolean> {
    return (await this.detectDrives()).some((d) => d.isBackupConfigured);
  },

  buildArchivePath(
    mountpoint: string,
    category: "volumes" | "paths" | "db",
    sourceRef: string,
    fileName: string,
    encrypted = false
  ): string {
    const hostSlug = currentHostnameSlug();
    const safeSourceRef = sanitizeSegment(sourceRef);
    const safeFileName =
      sanitizeSegment(fileName.replace(/\.tar\.gz$/, "")) + ".tar.gz" + (encrypted ? ENCRYPTED_SUFFIX : "");
    const backupRoot = resolve(mountpoint, BACKUP_ROOT_SEGMENT, hostSlug);
    const candidate = resolve(backupRoot, category, safeSourceRef, safeFileName);
    if (!candidate.startsWith(backupRoot + sep)) throw new Error("path_traversal_rejected");
    return candidate;
  },

  async copyBackupFile(
    localPath: string,
    category: "volumes" | "paths" | "db",
    sourceRef: string,
    // `plain` is only for flows that must read the USB copy back themselves
    // without an admin present to supply the private key (migration capture).
    opts: { plain?: boolean } = {}
  ): Promise<{ usbPath: string; mountpoint: string }> {
    const drives = (await this.detectDrives()).filter((d) => d.isBackupConfigured);
    if (drives.length === 0) throw new Error("no_usb_drive_detected");
    const drive = drives[0]; // single-drive write support this iteration
    const fileName = basename(localPath);
    const encrypt = !opts.plain && (await BackupCrypto.isEnabledFor("usb"));
    const destPath = this.buildArchivePath(drive.mountpoint, category, sourceRef, fileName, encrypt);
    await mkdir(dirname(destPath), { recursive: true });
    const plainSize = (await stat(localPath)).size;
    const expectedSize = encrypt ? plainSize + ENCRYPTION_OVERHEAD : plainSize;
    if (encrypt) await BackupCrypto.encryptFile(localPath, destPath);
    else await copyFile(localPath, destPath);
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
          for (const fileName of files.filter((f) => f.endsWith(".tar.gz") || f.endsWith(".tar.gz" + ENCRYPTED_SUFFIX))) {
            const fullPath = join(sourceDir, fileName);
            const s = await stat(fullPath);
            archives.push({
              encrypted: fileName.endsWith(ENCRYPTED_SUFFIX),
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

  /** Releases a currently-mounted USB/SSD drive so it can be unplugged
   * without risking corruption from writes still in the kernel's page cache.
   * Stops the same systemd unit that mounted it (backup-usb-mount@<dev>.service,
   * see deploy/usb-backup/) rather than calling umount directly — that unit's
   * ExecStop already does the umount, and pwa-admin deliberately never
   * touches mount/umount itself. Only a mountpoint lsblk currently reports as
   * USB-attached is accepted, so this can't target a system mount. */
  async eject(mountpoint: string): Promise<void> {
    const drives = await this.detectDrives();
    const drive = drives.find((d) => d.mountpoint === mountpoint);
    if (!drive) throw new Error("usb_drive_not_found");

    if (drive.encrypted) {
      // An unlocked drive's `device` is the dm-crypt mapper, not the partition the
      // mount unit is named after, and the unit may not even be active (an unlock
      // done from the app mounts outside it). The root helper tears it down either way.
      await runCommand("sudo", [LUKS_HELPER, "eject", drive.partition], { timeoutMs: 30000 });
    } else {
      await runCommand("sudo", ["/bin/systemctl", "stop", `backup-usb-mount@${drive.partition}.service`], {
        timeoutMs: 15000,
      });
    }

    // Never report "safe to unplug" on faith: a stop of the wrong or an inactive
    // unit succeeds silently while leaving the drive mounted.
    const stillMounted = (await this.detectDrives()).some((d) => d.mountpoint === mountpoint);
    if (stillMounted) throw new Error("eject_failed_still_mounted");
  },

  /** Mounts again a drive that is still plugged in (typically right after an
   * eject) without unplugging it: re-runs its mount unit through the root
   * helper, which auto-unlocks a LUKS drive only if its keyfile is enabled.
   * The partition must be one lsblk currently reports as an unmounted or locked
   * USB partition, so this can't be aimed at a system disk. */
  async reconnect(partition: string): Promise<void> {
    if (!/^(sd[a-z]+[0-9]+|nvme[0-9]+n[0-9]+p[0-9]+|mmcblk[0-9]+p[0-9]+)$/.test(partition)) {
      throw new Error("invalid_partition_name");
    }
    const status = await this.status();
    const known =
      status.unmountedDrives.some((d) => d.partition === partition) ||
      status.lockedDrives.some((d) => d.partition === partition);
    if (!known) throw new Error("usb_partition_not_found");

    try {
      await runCommand("sudo", [LUKS_HELPER, "reconnect", partition], { timeoutMs: 60000 });
    } catch (err) {
      // The helper prints "backup-usb-luks: <machine_code>" on failure.
      const match = ((err as { stderr?: string }).stderr ?? "").match(/backup-usb-luks: ([a-z_:]+)/);
      throw new Error(match ? match[1] : "reconnect_failed");
    }

    const mounted = (await this.detectDrives()).some((d) => d.partition === partition);
    if (!mounted) throw new Error("reconnect_failed");
  },
};
