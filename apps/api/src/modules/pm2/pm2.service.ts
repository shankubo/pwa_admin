import { runCommand } from "../../utils/exec.js";
import type { Pm2Process, Pm2Status } from "@pwa-admin-pi/shared";

const PROCESS_NAME_RE = /^[a-zA-Z0-9_-]+$/;

function assertValidProcessName(name: string): void {
  if (!PROCESS_NAME_RE.test(name) || name.length > 100) {
    throw new Error("invalid_process_name");
  }
}

interface Pm2JlistEntry {
  pm_id: number;
  name: string;
  pid: number;
  monit: { cpu: number; memory: number };
  pm2_env: {
    status: Pm2Status;
    restart_time: number;
    pm_uptime: number;
    pm_exec_path?: string;
    pm_cwd?: string;
    node_version?: string;
    status_time?: number;
  };
}

export const Pm2Service = {
  async list(): Promise<Pm2Process[]> {
    const { stdout } = await runCommand("pm2", ["jlist"], { timeoutMs: 10000 });
    const entries = JSON.parse(stdout) as Pm2JlistEntry[];
    const now = Date.now();

    return entries.map((e) => ({
      pmId: e.pm_id,
      name: e.name,
      pid: e.pid || null,
      status: e.pm2_env.status,
      cpuPercent: e.monit?.cpu ?? 0,
      memoryBytes: e.monit?.memory ?? 0,
      restarts: e.pm2_env.restart_time ?? 0,
      uptimeMs: e.pm2_env.status === "online" && e.pm2_env.pm_uptime ? now - e.pm2_env.pm_uptime : null,
      scriptPath: e.pm2_env.pm_exec_path ?? null,
      cwd: e.pm2_env.pm_cwd ?? null,
      nodeVersion: e.pm2_env.node_version ?? null,
    }));
  },

  async start(name: string): Promise<void> {
    assertValidProcessName(name);
    await runCommand("pm2", ["start", name], { timeoutMs: 15000 });
  },

  async stop(name: string): Promise<void> {
    assertValidProcessName(name);
    await runCommand("pm2", ["stop", name], { timeoutMs: 15000 });
  },

  async restart(name: string): Promise<void> {
    assertValidProcessName(name);
    await runCommand("pm2", ["restart", name], { timeoutMs: 15000 });
  },

  async reload(name: string): Promise<void> {
    // Zero-downtime reload (only meaningful for cluster-mode processes, but
    // safe to call on fork-mode ones too — pm2 falls back to a normal restart).
    assertValidProcessName(name);
    await runCommand("pm2", ["reload", name], { timeoutMs: 15000 });
  },

  async getLogs(name: string, lines = 200): Promise<string> {
    assertValidProcessName(name);
    // pm2 logs --nostream --lines N prints both out/error logs with prefixes,
    // then exits — a clean snapshot fetch rather than the tailing `pm2 logs`
    // default, which never terminates.
    const { stdout } = await runCommand("pm2", ["logs", name, "--nostream", "--lines", String(lines)], {
      timeoutMs: 10000,
    });
    return stdout;
  },
};
