import { existsSync, createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { runCommand, isValidIp } from "../../utils/exec.js";
import { env } from "../../config/env.js";
import { docker } from "../../services/docker.client.js";
import { HardwareService } from "../hardware/hardware.service.js";
import type { ListeningPort, TopPageEntry, VisitorStats, Fail2banJailStatus, BlockedIpEntry } from "@pwa-admin/shared";

// Process names this app must never let an admin kill from the "Ports
// ouverts" screen — every one of these, if killed, either cuts off access
// to pwa-admin itself (node = this very process, sshd = the only other
// remote-admin path) or breaks the machine at the OS level (systemd,
// systemd-resolve, systemd-network). Deliberately name-based rather than
// PID-based (this process's own PID is trivially available via
// process.pid, but a name-based list also protects a same-named process
// that gets relaunched under a new PID between page loads).
const PROTECTED_PROCESS_NAMES = new Set(["node", "sshd", "systemd", "systemd-resolve", "systemd-network"]);

// blockPort (ufw deny) never looks at a PID or process name at all — it
// only ever sees a port number — so PROTECTED_PROCESS_NAMES can't protect
// it the way it protects killPort. SSH's well-known port is hardcoded here
// as a second, independent guard: this app is documented (CLAUDE.md) as
// reachable ONLY via Tailscale, with UFW's own default-deny posture
// otherwise carving out just this app's own port — firewalling off 22
// would sever the one other remote-admin path into the box, with no
// physical console access implied by that same Tailscale-only posture.
// A custom, non-22 SSH port (see SshStatus.port from hardware.service.ts)
// is intentionally NOT auto-added here — the running server's actual
// configured SSH port is looked up fresh in blockPort itself, below.
const PROTECTED_PORTS = new Set([22]);

function assertNotProtectedProcess(processName: string | null): void {
  if (processName && PROTECTED_PROCESS_NAMES.has(processName)) {
    throw new Error(`refusing_to_act_on_protected_process:${processName}`);
  }
}

function assertNotOwnPort(port: number): void {
  if (port === env.PORT) throw new Error("refusing_to_block_own_port");
}

function assertNotProtectedPort(port: number): void {
  if (PROTECTED_PORTS.has(port)) throw new Error(`refusing_to_block_protected_port:${port}`);
}

const analyticsCache = new Map<string, { data: unknown; expiresAt: number }>();
const CACHE_TTL_MS = 60_000;

function getCached<T>(key: string): T | null {
  const entry = analyticsCache.get(key);
  if (!entry || entry.expiresAt < Date.now()) return null;
  return entry.data as T;
}

function setCached(key: string, data: unknown) {
  analyticsCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

export const NetworkService = {
  async listOpenPorts(): Promise<ListeningPort[]> {
    const { stdout } = await runCommand("sudo", ["/usr/bin/ss", "-tulpn"], { timeoutMs: 5000 });
    const lines = stdout.split("\n").slice(1).filter(Boolean);

    let dockerPortOwners: Record<number, string> = {};
    try {
      const containers = await docker.listContainers({ all: false });
      dockerPortOwners = {};
      for (const c of containers) {
        for (const p of c.Ports) {
          if (p.PublicPort) dockerPortOwners[p.PublicPort] = c.Names[0]?.replace(/^\//, "") ?? c.Id.slice(0, 12);
        }
      }
    } catch {
      dockerPortOwners = {};
    }

    const results: ListeningPort[] = [];
    for (const line of lines) {
      const cols = line.trim().split(/\s+/);
      const protocol = cols[0]?.toLowerCase() === "udp" ? "udp" : "tcp";
      const localAddrCol = cols[4];
      if (!localAddrCol) continue;
      const portMatch = /:(\d+)$/.exec(localAddrCol);
      if (!portMatch) continue;
      const port = Number(portMatch[1]);
      const localAddress = localAddrCol.slice(0, -portMatch[0].length);

      const procMatch = /users:\(\("([^"]+)",pid=(\d+)/.exec(line);

      results.push({
        protocol,
        localAddress,
        port,
        processName: procMatch?.[1] ?? null,
        pid: procMatch ? Number(procMatch[2]) : null,
        ownedByContainer: dockerPortOwners[port] ?? null,
      });
    }
    return results;
  },

  async topPages(siteName: string, windowDays: number): Promise<TopPageEntry[]> {
    const cacheKey = `top-pages:${siteName}:${windowDays}`;
    const cached = getCached<TopPageEntry[]>(cacheKey);
    if (cached) return cached;

    const logPath = await resolveAccessLogPath(siteName);
    if (!logPath) return [];

    const counts = new Map<string, number>();
    let lineCount = 0;

    await forEachLine(logPath, (line) => {
      if (++lineCount > env.ANALYTICS_LOG_LINE_CAP) return false;
      const match = /"[A-Z]+\s+(\S+)\s+HTTP/.exec(line);
      if (match) counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
      return true;
    });

    const result = [...counts.entries()]
      .map(([path, hits]) => ({ path, hits }))
      .sort((a, b) => b.hits - a.hits)
      .slice(0, 20);

    setCached(cacheKey, result);
    return result;
  },

  async visitorStats(siteName: string, windowDays: number): Promise<VisitorStats> {
    const cacheKey = `visitors:${siteName}:${windowDays}`;
    const cached = getCached<VisitorStats>(cacheKey);
    if (cached) return cached;

    const logPath = await resolveAccessLogPath(siteName);
    if (!logPath) return { uniqueIps: 0, totalRequests: 0, windowDays };

    const ips = new Set<string>();
    let total = 0;
    let lineCount = 0;

    await forEachLine(logPath, (line) => {
      if (++lineCount > env.ANALYTICS_LOG_LINE_CAP) return false;
      const ipMatch = /^(\S+)/.exec(line);
      if (ipMatch) ips.add(ipMatch[1]);
      total++;
      return true;
    });

    const result = { uniqueIps: ips.size, totalRequests: total, windowDays };
    setCached(cacheKey, result);
    return result;
  },

  async fail2banStatus(): Promise<{ jails: string[] }> {
    if (!env.FAIL2BAN_ENABLED) return { jails: [] };
    const { stdout } = await runCommand("sudo", [env.FAIL2BAN_CLIENT_PATH, "status"], { timeoutMs: 5000 });
    const match = /Jail list:\s*(.+)/.exec(stdout);
    const jails = match ? match[1].split(",").map((j) => j.trim()).filter(Boolean) : [];
    return { jails };
  },

  async jailStatus(jail: string): Promise<Fail2banJailStatus> {
    const { jails } = await this.fail2banStatus();
    if (!jails.includes(jail)) throw new Error("unknown_jail");

    const { stdout } = await runCommand("sudo", [env.FAIL2BAN_CLIENT_PATH, "status", jail], { timeoutMs: 5000 });
    const bannedMatch = /Banned IP list:\s*(.*)/.exec(stdout);
    const totalMatch = /Total banned:\s*(\d+)/.exec(stdout);
    const currentlyBanned = bannedMatch ? bannedMatch[1].split(/\s+/).filter(Boolean) : [];
    return {
      name: jail,
      currentlyBanned,
      totalBanned: totalMatch ? Number(totalMatch[1]) : currentlyBanned.length,
    };
  },

  async listBlockedIps(): Promise<BlockedIpEntry[]> {
    const { jails } = await this.fail2banStatus();
    const results: BlockedIpEntry[] = [];
    for (const jail of jails) {
      const status = await this.jailStatus(jail).catch(() => null);
      if (!status) continue;
      for (const ip of status.currentlyBanned) results.push({ ip, jail });
    }
    return results;
  },

  async banIp(ip: string, jail?: string): Promise<void> {
    if (!isValidIp(ip)) throw new Error("invalid_ip");
    const targetJail = jail ?? env.FAIL2BAN_DEFAULT_JAIL;
    const { jails } = await this.fail2banStatus();
    if (!jails.includes(targetJail)) throw new Error("unknown_jail");
    await runCommand("sudo", [env.FAIL2BAN_CLIENT_PATH, "set", targetJail, "banip", ip], { timeoutMs: 5000 });
  },

  async unbanIp(ip: string): Promise<void> {
    if (!isValidIp(ip)) throw new Error("invalid_ip");
    const blocked = await this.listBlockedIps();
    const entry = blocked.find((b) => b.ip === ip);
    if (!entry) throw new Error("ip_not_currently_banned");
    await runCommand("sudo", [env.FAIL2BAN_CLIENT_PATH, "set", entry.jail, "unbanip", ip], { timeoutMs: 5000 });
  },

  /**
   * Firewalls off a port via `ufw deny` — the port stays technically
   * listening locally (never touches the process itself), it just becomes
   * unreachable from outside through the firewall. Reversible via
   * unblockPort. Refuses to block this app's own PORT (env.PORT), the
   * hardcoded PROTECTED_PORTS set (22 — the well-known SSH port), AND the
   * server's actual CURRENTLY CONFIGURED SSH port looked up fresh from
   * HardwareService (covers a custom, non-22 sshd_config Port — a fixed
   * PROTECTED_PORTS entry alone would miss that). This app is documented
   * as reachable ONLY via Tailscale (CLAUDE.md) — SSH is the one other
   * remote path into the box, and there's no physical console access
   * implied by that same posture, so severing it here would be a true
   * lockout, not just an inconvenience.
   */
  async blockPort(port: number, protocol: "tcp" | "udp"): Promise<void> {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("invalid_port");
    assertNotOwnPort(port);
    assertNotProtectedPort(port);
    const ssh = await HardwareService.getSshStatus();
    if (ssh.port != null && port === ssh.port) throw new Error(`refusing_to_block_protected_port:${port}`);
    await runCommand("sudo", ["ufw", "deny", `${port}/${protocol}`], { timeoutMs: 10_000 });
  },

  /** Removes a `deny <port>/<protocol>` rule this app itself would have
   * added via blockPort — same argv shape so the sudoers rule for delete
   * matches exactly what was inserted. */
  async unblockPort(port: number, protocol: "tcp" | "udp"): Promise<void> {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("invalid_port");
    await runCommand("sudo", ["ufw", "delete", "deny", `${port}/${protocol}`], { timeoutMs: 10_000 });
  },

  /**
   * Stops the process currently listening on a port — a strictly more
   * disruptive action than blockPort (the process itself goes down, not
   * just its external reachability), offered alongside it per explicit
   * admin request. Requires the CURRENT pid+processName exactly as
   * listOpenPorts() just reported them (re-verified against a fresh
   * listOpenPorts() call, not trusted from client input) — both as a
   * safety check against a stale/reused PID, and because
   * assertNotProtectedProcess needs the real process name, not whatever a
   * client claims it is. Refuses outright on any PROTECTED_PROCESS_NAMES
   * entry (node/sshd/systemd*), a container-owned port (use the Docker
   * module's own stop/restart instead — SIGTERM to a containerized
   * process's HOST pid bypasses `docker stop`'s semantics and can trigger
   * an endless restart-loop under a `--restart always`/`unless-stopped`
   * policy rather than a clean stop), or this app's own port.
   */
  async killPort(port: number, pid: number): Promise<void> {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("invalid_port");
    if (!Number.isInteger(pid) || pid < 1) throw new Error("invalid_pid");
    // The sudoers rule for `kill` is necessarily unscoped (a PID can't be
    // glob-matched the way a file path or fixed subcommand can), so this
    // app-side check is the ONLY thing standing between "stop one
    // container's Node process" and "stop PID 1". Low PIDs are near-
    // universally the kernel/init/core system daemons on a freshly booted
    // Linux box, so refusing anything below 100 is a cheap extra margin on
    // top of the name-based PROTECTED_PROCESS_NAMES check below, not a
    // replacement for it (a malicious/renamed process could still get a
    // low PID in principle, but never in the ordinary boot-then-run-user-
    // services lifecycle this server actually has).
    if (pid < 100) throw new Error("refusing_to_kill_low_pid");
    assertNotOwnPort(port);

    const current = await this.listOpenPorts();
    const match = current.find((p) => p.port === port && p.pid === pid);
    if (!match) throw new Error("port_pid_mismatch_refetch_and_retry");
    assertNotProtectedProcess(match.processName);
    if (match.ownedByContainer) {
      throw new Error(`refusing_to_kill_container_process:${match.ownedByContainer}`);
    }

    await runCommand("sudo", ["kill", "-TERM", String(pid)], { timeoutMs: 5000 });
  },
};

async function resolveAccessLogPath(siteName: string): Promise<string | null> {
  if (!/^[a-zA-Z0-9._-]+$/.test(siteName)) return null;
  const candidates = [
    join(env.NGINX_LOG_DIR, `${siteName}.access.log`),
    join(env.NGINX_LOG_DIR, `${siteName}_access.log`),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  const shared = join(env.NGINX_LOG_DIR, "access.log");
  return existsSync(shared) ? shared : null;
}

async function forEachLine(path: string, onLine: (line: string) => boolean): Promise<void> {
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!onLine(line)) break;
  }
  rl.close();
}
