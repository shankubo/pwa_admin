import { runCommand } from "../../utils/exec.js";
import { docker } from "../../services/docker.client.js";
import { SecurityService } from "../security/security.service.js";
import { Pm2Service } from "../pm2/pm2.service.js";
import type { ServiceStatusEntry, ServicesOverview, ServiceUpdateResult } from "@pwa-admin/shared";

async function getVersion(bin: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await runCommand(bin, args, { timeoutMs: 5000 });
    return stdout.trim().split("\n")[0] ?? null;
  } catch {
    return null;
  }
}

export const ServicesService = {
  async getTailscaleStatus(): Promise<ServiceStatusEntry> {
    // Reuses SecurityService's own detection rather than duplicating the
    // `tailscale status --json` parsing.
    const status = await SecurityService.getTailscaleStatus();
    const version = status.installed ? await getVersion("tailscale", ["version"]) : null;
    return {
      name: "tailscale",
      label: "Tailscale",
      installed: status.installed,
      running: status.running,
      version,
      updateAvailable: null,
      detail: status.installed
        ? { loggedIn: status.loggedIn, hostname: status.hostname, tailscaleIps: status.tailscaleIps, tailnetName: status.tailnetName }
        : null,
    };
  },

  async getDockerStatus(): Promise<ServiceStatusEntry> {
    try {
      await docker.ping();
      const info = await docker.version();
      const [containers, images] = await Promise.all([
        docker.listContainers({ all: true }),
        docker.listImages(),
      ]);
      return {
        name: "docker",
        label: "Docker",
        installed: true,
        running: true,
        version: (info as { Version?: string }).Version ?? null,
        updateAvailable: null,
        detail: {
          containerCount: containers.length,
          runningContainerCount: containers.filter((c) => c.State === "running").length,
          imageCount: images.length,
        },
      };
    } catch {
      return {
        name: "docker",
        label: "Docker",
        installed: false,
        running: false,
        version: null,
        updateAvailable: null,
        detail: null,
      };
    }
  },

  async getPm2Status(): Promise<ServiceStatusEntry> {
    try {
      const processes = await Pm2Service.list();
      const version = await getVersion("pm2", ["--version"]);
      return {
        name: "pm2",
        label: "Node.js (PM2)",
        installed: true,
        running: true,
        version,
        updateAvailable: null,
        detail: {
          processCount: processes.length,
          onlineCount: processes.filter((p) => p.status === "online").length,
        },
      };
    } catch {
      return {
        name: "pm2",
        label: "Node.js (PM2)",
        installed: false,
        running: false,
        version: null,
        updateAvailable: null,
        detail: null,
      };
    }
  },

  async getOverview(): Promise<ServicesOverview> {
    const services = await Promise.all([this.getTailscaleStatus(), this.getDockerStatus(), this.getPm2Status()]);
    return { services, checkedAt: new Date().toISOString() };
  },

  async updateTailscale(): Promise<ServiceUpdateResult> {
    try {
      // sudo: `tailscale update` self-updates the binary, root-owned.
      const { stdout, stderr } = await runCommand("sudo", ["tailscale", "update"], { timeoutMs: 120_000 });
      return { ok: true, output: stdout + stderr, requiresRestart: false };
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message: string };
      // Some install methods (e.g. apt-managed) reject this subcommand and
      // point to apt instead — surface that message rather than retrying
      // silently with a different command.
      return { ok: false, output: (e.stdout ?? "") + (e.stderr ?? "") || e.message, requiresRestart: false };
    }
  },

  async updateDocker(): Promise<ServiceUpdateResult> {
    try {
      const { stdout, stderr } = await runCommand(
        "sudo",
        ["apt-get", "install", "--only-upgrade", "-y", "docker-ce", "docker-ce-cli", "containerd.io"],
        { timeoutMs: 300_000 }
      );
      return { ok: true, output: stdout + stderr, requiresRestart: true };
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message: string };
      return { ok: false, output: (e.stdout ?? "") + (e.stderr ?? "") || e.message, requiresRestart: false };
    }
  },

  async restartDockerService(): Promise<ServiceUpdateResult> {
    try {
      const { stdout, stderr } = await runCommand("sudo", ["systemctl", "restart", "docker"], { timeoutMs: 60_000 });
      return { ok: true, output: stdout + stderr, requiresRestart: false };
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message: string };
      return { ok: false, output: (e.stdout ?? "") + (e.stderr ?? "") || e.message, requiresRestart: false };
    }
  },

  async reloadPm2Daemon(): Promise<ServiceUpdateResult> {
    try {
      // No sudo — pm2 already runs as the unprivileged service user.
      const { stdout, stderr } = await runCommand("pm2", ["update"], { timeoutMs: 30_000 });
      return { ok: true, output: stdout + stderr, requiresRestart: false };
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message: string };
      return { ok: false, output: (e.stdout ?? "") + (e.stderr ?? "") || e.message, requiresRestart: false };
    }
  },
};
