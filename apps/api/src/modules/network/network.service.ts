import { existsSync, createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { runCommand, isValidIp } from "../../utils/exec.js";
import { env } from "../../config/env.js";
import { docker } from "../../services/docker.client.js";
import type { ListeningPort, TopPageEntry, VisitorStats, Fail2banJailStatus, BlockedIpEntry } from "@pwa-admin/shared";

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
