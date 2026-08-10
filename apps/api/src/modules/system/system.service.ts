import si from "systeminformation";
import { runCommand } from "../../utils/exec.js";
import { env } from "../../config/env.js";
import type { SystemStatsSnapshot, SystemAlert } from "@pwa-admin/shared";

// Pseudo-filesystems systeminformation's fsSize() reports alongside real
// storage — EFI variable storage, kernel/device tmpfs, etc. They're
// meaningless as "disk usage" (efivars is typically a few hundred KB with a
// misleadingly high use%) and must never be picked as the Dashboard's
// "primary disk" via disks[0].
const PSEUDO_FS_TYPES = new Set([
  "efivarfs",
  "tmpfs",
  "devtmpfs",
  "proc",
  "sysfs",
  "cgroup",
  "cgroup2",
  "overlay",
  "squashfs",
  "devpts",
  "mqueue",
  "debugfs",
  "tracefs",
  "securityfs",
  "pstore",
  "bpf",
  "autofs",
  "binfmt_misc",
  "hugetlbfs",
  "fusectl",
  "configfs",
  "rpc_pipefs",
]);

async function readThrottled(): Promise<SystemStatsSnapshot["cpu"]["throttled"]> {
  try {
    const { stdout } = await runCommand("vcgencmd", ["get_throttled"], { timeoutMs: 2000 });
    const match = /throttled=(0x[0-9a-fA-F]+)/.exec(stdout);
    if (!match) return null;
    const bitmask = parseInt(match[1], 16);
    return {
      underVoltage: (bitmask & 0x1) !== 0,
      throttled: (bitmask & 0x4) !== 0,
      raw: match[1],
    };
  } catch {
    return null;
  }
}

export const SystemService = {
  async getSnapshot(): Promise<SystemStatsSnapshot> {
    const [load, temp, mem, fsSize, networkStats, time, osInfo, throttled] = await Promise.all([
      si.currentLoad(),
      si.cpuTemperature(),
      si.mem(),
      si.fsSize(),
      si.networkStats(),
      si.time(),
      si.osInfo(),
      readThrottled(),
    ]);

    return {
      timestamp: new Date().toISOString(),
      cpu: {
        loadPercent: Math.round(load.currentLoad * 10) / 10,
        temperatureC: temp.main ?? null,
        throttled,
      },
      memory: {
        totalBytes: mem.total,
        usedBytes: mem.active,
        usedPercent: Math.round((mem.active / mem.total) * 1000) / 10,
      },
      disks: fsSize
        .filter((d) => d.size > 0 && !PSEUDO_FS_TYPES.has(d.type))
        .map((d) => ({
          mount: d.mount,
          totalBytes: d.size,
          usedBytes: d.used,
          freeBytes: d.available ?? d.size - d.used,
          usedPercent: Math.round(d.use * 10) / 10,
        }))
        // Root filesystem first, so Dashboard's disks[0] "primary disk" card
        // is always the meaningful one instead of whatever fsSize() happened
        // to list first.
        .sort((a, b) => (a.mount === "/" ? -1 : b.mount === "/" ? 1 : 0)),
      network: networkStats.map((n) => ({
        iface: n.iface,
        rxBytesPerSec: n.rx_sec ?? 0,
        txBytesPerSec: n.tx_sec ?? 0,
      })),
      uptimeSeconds: time.uptime,
      os: {
        platform: osInfo.platform,
        distro: osInfo.distro,
        release: osInfo.release,
        kernel: osInfo.kernel,
        arch: osInfo.arch,
      },
    };
  },

  evaluateAlerts(snapshot: SystemStatsSnapshot): SystemAlert[] {
    const alerts: SystemAlert[] = [];
    const now = new Date().toISOString();

    if (snapshot.cpu.temperatureC != null) {
      if (snapshot.cpu.temperatureC >= env.ALERT_TEMP_CRIT_C) {
        alerts.push({
          id: "cpu_temp",
          type: "cpu_temp",
          severity: "critical",
          message: `CPU temperature critical: ${snapshot.cpu.temperatureC}°C`,
          raisedAt: now,
        });
      } else if (snapshot.cpu.temperatureC >= env.ALERT_TEMP_WARN_C) {
        alerts.push({
          id: "cpu_temp",
          type: "cpu_temp",
          severity: "warning",
          message: `CPU temperature high: ${snapshot.cpu.temperatureC}°C`,
          raisedAt: now,
        });
      }
    }

    for (const disk of snapshot.disks) {
      if (disk.usedPercent >= env.ALERT_DISK_CRIT_PCT) {
        alerts.push({
          id: `disk_usage_${disk.mount}`,
          type: "disk_usage",
          severity: "critical",
          message: `Disk ${disk.mount} usage critical: ${disk.usedPercent}%`,
          raisedAt: now,
        });
      } else if (disk.usedPercent >= env.ALERT_DISK_WARN_PCT) {
        alerts.push({
          id: `disk_usage_${disk.mount}`,
          type: "disk_usage",
          severity: "warning",
          message: `Disk ${disk.mount} usage high: ${disk.usedPercent}%`,
          raisedAt: now,
        });
      }
    }

    if (snapshot.cpu.throttled?.underVoltage) {
      alerts.push({
        id: "under_voltage",
        type: "cpu_temp",
        severity: "warning",
        message: "Under-voltage detected — check power supply",
        raisedAt: now,
      });
    }

    return alerts;
  },
};
