import { spawnCommandWithStdin } from "../utils/exec.js";
import { UsbBackupService, LUKS_HELPER as HELPER } from "./usbBackup.client.js";

// Everything privileged happens in the root script (see deploy/usb-backup/
// backup-usb-luks.sh); the service only ever shells out to it through the one
// scoped sudoers rule. Passphrases go over stdin, never argv.
const PARTITION_RE = /^(sd[a-z]+[0-9]+|nvme[0-9]+n[0-9]+p[0-9]+|mmcblk[0-9]+p[0-9]+)$/;
const HELPER_TIMEOUT_MS = 10 * 60_000;

function assertPassphrase(passphrase: string): void {
  if (passphrase.length < 8 || passphrase.length > 256 || passphrase.includes("\0")) {
    throw new Error("invalid_passphrase_length");
  }
}

function runHelper(args: string[], passphrase?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawnCommandWithStdin("sudo", [HELPER, ...args]);
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("luks_helper_timeout"));
    }, HELPER_TIMEOUT_MS);

    child.stdout?.on("data", (c) => (stdout += c));
    child.stderr?.on("data", (c) => (stderr += c));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve(stdout.trim());
      // The helper prints "backup-usb-luks: <machine_code>" on failure; pass
      // that code through so the UI can show a precise message.
      const match = stderr.match(/backup-usb-luks: ([a-z_:]+)/);
      reject(new Error(match ? match[1] : "luks_helper_failed"));
    });

    // No trailing newline: cryptsetup --key-file=- reads stdin to EOF as-is.
    if (passphrase !== undefined) child.stdin?.write(passphrase);
    child.stdin?.end();
  });
}

async function requirePartition(
  partition: string,
  allowed: "locked-or-plain" | "encrypted-or-locked" | "locked-or-encrypted-or-plain"
): Promise<void> {
  if (!PARTITION_RE.test(partition)) throw new Error("invalid_partition_name");
  const status = await UsbBackupService.status();
  const plain = status.drives.some((d) => d.partition === partition && !d.encrypted);
  const encrypted = status.drives.some((d) => d.partition === partition && d.encrypted);
  const locked = status.lockedDrives.some((d) => d.partition === partition);
  const ok =
    allowed === "locked-or-plain"
      ? plain || locked
      : allowed === "encrypted-or-locked"
        ? encrypted || locked
        : plain || encrypted || locked;
  if (!ok) throw new Error("usb_partition_not_found");
}

export const UsbLuksService = {
  async unlock(partition: string, passphrase: string): Promise<void> {
    assertPassphrase(passphrase);
    await requirePartition(partition, "locked-or-encrypted-or-plain");
    await runHelper(["unlock", partition], passphrase);
  },

  /** ERASES the partition. Allowed on a plain USB drive or on a locked LUKS one
   * (forgotten passphrase) — never on one that is currently unlocked, which
   * would pull the rug from under a mounted backup drive. */
  async format(partition: string, passphrase: string, withKeyfile: boolean): Promise<void> {
    assertPassphrase(passphrase);
    await requirePartition(partition, "locked-or-plain");
    await runHelper(["format", partition, ...(withKeyfile ? ["--with-keyfile"] : [])], passphrase);
  },

  async setKeyfile(partition: string, passphrase: string, enabled: boolean): Promise<void> {
    assertPassphrase(passphrase);
    await requirePartition(partition, "encrypted-or-locked");
    await runHelper([enabled ? "enable-keyfile" : "disable-keyfile", partition], passphrase);
  },

  async keyfileStatus(partition: string): Promise<{ keyfile: boolean }> {
    await requirePartition(partition, "encrypted-or-locked");
    const out = await runHelper(["status", partition]);
    return { keyfile: out.includes("keyfile=yes") };
  },
};
