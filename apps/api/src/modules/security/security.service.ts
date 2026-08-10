import { existsSync } from "node:fs";
import { runCommand } from "../../utils/exec.js";
import { env } from "../../config/env.js";
import { UserModel } from "../../db/models/user.js";
import { NetworkService } from "../network/network.service.js";
import { HardwareService } from "../hardware/hardware.service.js";
import { db } from "../../db/index.js";
import type {
  UfwStatus,
  UfwRule,
  Fail2banOverview,
  SshSecurityStatus,
  TailscaleStatus,
  UnattendedUpgradesStatus,
  TlsCertInfo,
  AppAuthSecurity,
  SecurityOverview,
} from "@pwa-admin/shared";

export const SecurityService = {
  async getUfwStatus(): Promise<UfwStatus> {
    try {
      // sudo: `ufw status` reads the live netfilter ruleset, root-only.
      const { stdout } = await runCommand("sudo", ["ufw", "status", "verbose"], { timeoutMs: 5000 });
      const active = /^Status:\s*active/im.test(stdout);
      const defaultMatch = /^Default:\s*(.+)$/im.exec(stdout);
      let defaultIncoming: string | null = null;
      let defaultOutgoing: string | null = null;
      if (defaultMatch) {
        const inMatch = /(\w+)\s*\(incoming\)/.exec(defaultMatch[1]);
        const outMatch = /(\w+)\s*\(outgoing\)/.exec(defaultMatch[1]);
        defaultIncoming = inMatch?.[1] ?? null;
        defaultOutgoing = outMatch?.[1] ?? null;
      }

      const rules: UfwRule[] = [];
      const lines = stdout.split("\n");
      const ruleStart = lines.findIndex((l) => /^To\s+Action\s+From/.test(l.trim()));
      if (ruleStart >= 0) {
        for (const line of lines.slice(ruleStart + 1)) {
          if (!line.trim()) continue;
          if (/^-+\s+-+\s+-+/.test(line.trim())) continue; // header underline separator
          const commentMatch = /#\s*(.+)$/.exec(line);
          const withoutComment = line.replace(/#.*$/, "").trim();
          const parts = withoutComment.split(/\s{2,}/).filter(Boolean);
          if (parts.length < 3) continue;
          const [to, actionRaw, from] = parts;
          const direction = /\(v6\)/.test(to) || /IN\)/.test(actionRaw) ? "IN" : "IN";
          const action = /DENY/i.test(actionRaw)
            ? "DENY"
            : /REJECT/i.test(actionRaw)
              ? "REJECT"
              : /LIMIT/i.test(actionRaw)
                ? "LIMIT"
                : "ALLOW";
          rules.push({ action, direction, to, from, comment: commentMatch?.[1]?.trim() ?? null });
        }
      }

      return { installed: true, active, defaultIncoming, defaultOutgoing, rules };
    } catch {
      return { installed: false, active: false, defaultIncoming: null, defaultOutgoing: null, rules: [] };
    }
  },

  async getFail2banOverview(): Promise<Fail2banOverview> {
    if (!env.FAIL2BAN_ENABLED) return { installed: false, active: false, jails: [] };
    try {
      const { jails } = await NetworkService.fail2banStatus();
      const details = await Promise.all(
        jails.map(async (name) => {
          try {
            const { stdout } = await runCommand("sudo", [env.FAIL2BAN_CLIENT_PATH, "status", name], {
              timeoutMs: 5000,
            });
            const currentlyFailed = Number(/Currently failed:\s*(\d+)/.exec(stdout)?.[1] ?? 0);
            const totalFailed = Number(/Total failed:\s*(\d+)/.exec(stdout)?.[1] ?? 0);
            const bannedMatch = /Banned IP list:\s*(.*)/.exec(stdout);
            const currentlyBanned = bannedMatch ? bannedMatch[1].split(/\s+/).filter(Boolean).length : 0;
            const totalBanned = Number(/Total banned:\s*(\d+)/.exec(stdout)?.[1] ?? currentlyBanned);
            return { name, currentlyFailed, totalFailed, currentlyBanned, totalBanned };
          } catch {
            return { name, currentlyFailed: 0, totalFailed: 0, currentlyBanned: 0, totalBanned: 0 };
          }
        })
      );
      return { installed: true, active: true, jails: details };
    } catch {
      return { installed: false, active: false, jails: [] };
    }
  },

  async getSshSecurityStatus(): Promise<SshSecurityStatus> {
    const base = await HardwareService.getSshStatus();
    let rootLoginPermitted: boolean | null = null;
    let maxAuthTries: number | null = null;
    const sshdConfigPath = "/etc/ssh/sshd_config";
    if (existsSync(sshdConfigPath)) {
      try {
        const { stdout } = await runCommand("sudo", ["cat", sshdConfigPath], { timeoutMs: 3000 });
        const rootMatch = /^\s*PermitRootLogin\s+(\S+)/m.exec(stdout);
        if (rootMatch) rootLoginPermitted = rootMatch[1].toLowerCase() !== "no";
        const triesMatch = /^\s*MaxAuthTries\s+(\d+)/m.exec(stdout);
        if (triesMatch) maxAuthTries = Number(triesMatch[1]);
      } catch {
        // leave defaults
      }
    }
    return { ...base, rootLoginPermitted, maxAuthTries };
  },

  async getTailscaleStatus(): Promise<TailscaleStatus> {
    try {
      const { stdout } = await runCommand("tailscale", ["status", "--json"], { timeoutMs: 5000 });
      const parsed = JSON.parse(stdout) as {
        BackendState?: string;
        Self?: { HostName?: string; TailscaleIPs?: string[] };
        CurrentTailnet?: { Name?: string };
      };
      const running = parsed.BackendState === "Running";
      return {
        installed: true,
        running,
        loggedIn: parsed.BackendState !== "NeedsLogin" && parsed.BackendState !== "NoState",
        hostname: parsed.Self?.HostName ?? null,
        tailscaleIps: parsed.Self?.TailscaleIPs ?? [],
        tailnetName: parsed.CurrentTailnet?.Name ?? null,
      };
    } catch {
      return { installed: false, running: false, loggedIn: false, hostname: null, tailscaleIps: [], tailnetName: null };
    }
  },

  async getUnattendedUpgradesStatus(): Promise<UnattendedUpgradesStatus> {
    let timerActive = false;
    try {
      const { stdout } = await runCommand("systemctl", ["is-active", "apt-daily-upgrade.timer"], {
        timeoutMs: 3000,
      });
      timerActive = stdout.trim() === "active";
    } catch {
      timerActive = false;
    }

    let automaticRebootEnabled: boolean | null = null;
    const configPath = "/etc/apt/apt.conf.d/50unattended-upgrades";
    if (existsSync(configPath)) {
      try {
        const { stdout } = await runCommand("sudo", ["cat", configPath], { timeoutMs: 3000 });
        const rebootMatch = /Unattended-Upgrade::Automatic-Reboot\s+"(\w+)"/.exec(stdout);
        if (rebootMatch) automaticRebootEnabled = rebootMatch[1] === "true";
      } catch {
        // leave null
      }
    }

    let lastRunAt: string | null = null;
    let lastRunPackages: string[] = [];
    const logPath = "/var/log/unattended-upgrades/unattended-upgrades.log";
    if (existsSync(logPath)) {
      try {
        const { stdout } = await runCommand("sudo", ["tail", "-n", "50", logPath], { timeoutMs: 3000 });
        const lines = stdout.split("\n").filter(Boolean);
        const packagesLine = [...lines].reverse().find((l) => l.includes("Packages that will be upgraded:"));
        if (packagesLine) {
          const tsMatch = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/.exec(packagesLine);
          lastRunAt = tsMatch ? new Date(tsMatch[1].replace(" ", "T")).toISOString() : null;
          const pkgs = packagesLine.split("Packages that will be upgraded:")[1]?.trim();
          lastRunPackages = pkgs ? pkgs.split(/\s+/).filter(Boolean) : [];
        }
      } catch {
        // leave defaults
      }
    }

    let pendingSecurityUpdates = 0;
    try {
      const { stdout } = await runCommand("apt", ["list", "--upgradable"], { timeoutMs: 15000 });
      pendingSecurityUpdates = stdout.split("\n").filter((l) => /-security/i.test(l)).length;
    } catch {
      pendingSecurityUpdates = 0;
    }

    return {
      installed: existsSync(configPath),
      timerActive,
      automaticRebootEnabled,
      lastRunAt,
      lastRunPackages,
      pendingSecurityUpdates,
    };
  },

  async getAppTlsStatus(): Promise<TlsCertInfo> {
    if (!env.TLS_CERT_PATH || !existsSync(env.TLS_CERT_PATH)) {
      return { found: false, subject: null, notAfter: null, daysRemaining: null, source: "none" };
    }
    try {
      const { stdout } = await runCommand(
        "openssl",
        ["x509", "-in", env.TLS_CERT_PATH, "-noout", "-enddate", "-subject"],
        { timeoutMs: 5000 }
      );
      const notAfterMatch = /notAfter=(.+)/.exec(stdout);
      const subjectMatch = /subject=(.+)/.exec(stdout);
      const notAfter = notAfterMatch ? new Date(notAfterMatch[1]).toISOString() : null;
      const daysRemaining = notAfter ? Math.round((new Date(notAfter).getTime() - Date.now()) / 86_400_000) : null;
      return { found: true, subject: subjectMatch?.[1] ?? null, notAfter, daysRemaining, source: "tailscale" };
    } catch {
      return { found: false, subject: null, notAfter: null, daysRemaining: null, source: "none" };
    }
  },

  getAppAuthSecurity(): AppAuthSecurity {
    const totalUsers = UserModel.count();
    const row = db.prepare("SELECT COUNT(*) as c FROM users WHERE totp_enabled = 1").get() as { c: number };
    return {
      totalUsers,
      usersWithTwoFactor: row.c,
      jwtAccessTtl: env.JWT_ACCESS_TTL,
      jwtSecretConfigured: env.JWT_ACCESS_SECRET.length >= 32,
      rateLimitEnabled: true,
    };
  },

  async getOverview(): Promise<SecurityOverview> {
    const [ufw, fail2ban, ssh, tailscale, unattendedUpgrades, appTls] = await Promise.all([
      this.getUfwStatus(),
      this.getFail2banOverview(),
      this.getSshSecurityStatus(),
      this.getTailscaleStatus(),
      this.getUnattendedUpgradesStatus(),
      this.getAppTlsStatus(),
    ]);
    return { ufw, fail2ban, ssh, tailscale, unattendedUpgrades, appTls, appAuth: this.getAppAuthSecurity() };
  },
};
