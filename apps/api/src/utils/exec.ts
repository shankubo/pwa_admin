import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class ExecError extends Error {
  constructor(
    message: string,
    public readonly stdout: string,
    public readonly stderr: string,
    public readonly exitCode: number | null
  ) {
    super(message);
    this.name = "ExecError";
  }
}

/**
 * Sole sanctioned way to shell out in this codebase. Always argv-array form —
 * never string-interpolated shell commands. Callers pass a fixed binary path
 * and an argv array built only from validated/allowlisted values.
 */
export async function runCommand(
  bin: string,
  args: string[],
  opts: { timeoutMs?: number } = {}
): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      timeout: opts.timeoutMs ?? 15_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { stdout, stderr };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number; message: string };
    throw new ExecError(e.message, e.stdout ?? "", e.stderr ?? "", e.code ?? null);
  }
}

/**
 * Spawns a long-running command (e.g. apt upgrade) with live stdout/stderr
 * streaming, for jobs that need to push progress over WebSocket while running.
 */
export function spawnCommand(bin: string, args: string[]): ChildProcess {
  return spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
}

/**
 * Like spawnCommand, but with a writable stdin — for commands a dump gets
 * piped INTO (mysql/psql/pg_restore restoring from a gunzipped file), where
 * spawnCommand's stdin: "ignore" would leave child.stdin null and crash any
 * .pipe(child.stdin) call.
 */
export function spawnCommandWithStdin(bin: string, args: string[]): ChildProcess {
  return spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });
}

const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_RE = /^[0-9a-fA-F:]+$/;

export function isValidIp(value: string): boolean {
  if (IPV4_RE.test(value)) {
    return value.split(".").every((octet) => Number(octet) >= 0 && Number(octet) <= 255);
  }
  return value.includes(":") && IPV6_RE.test(value);
}

const DEBIAN_PACKAGE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9+.-]*$/;

export function isValidPackageName(value: string): boolean {
  return DEBIAN_PACKAGE_NAME_RE.test(value) && value.length <= 255;
}

// Debian version grammar: optional "epoch:", upstream version, optional
// "-debian-revision" — see deb-version(7). Permissive but excludes shell
// metacharacters, since this only ever needs to reject injection attempts,
// not validate every legal version string byte-for-byte.
const DEBIAN_PACKAGE_VERSION_RE = /^[a-zA-Z0-9][a-zA-Z0-9.+~:-]*$/;

/** Guards `apt-get install pkg=<version>` argv construction — a migration
 * manifest's os-packages.json is read from a USB drive, so its "version"
 * field must be validated the same way a package name is before ever
 * reaching a sudo apt-get argv. */
export function isValidPackageVersion(value: string): boolean {
  return DEBIAN_PACKAGE_VERSION_RE.test(value) && value.length <= 255;
}
