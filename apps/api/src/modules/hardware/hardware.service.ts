import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import si from "systeminformation";
import { runCommand } from "../../utils/exec.js";
import type {
  HardwareInfo,
  MachineClock,
  NetworkInterfaceInfo,
  WifiNetwork,
  WifiStatus,
  SystemdUnitSummary,
  SshStatus,
  HardwareOverview,
} from "@pwa-admin/shared";

async function readDeviceTreeModel(): Promise<string | null> {
  try {
    const raw = await readFile("/proc/device-tree/model", "utf8");
    return raw.replace(/\0/g, "").trim() || null;
  } catch {
    return null;
  }
}

async function readCpuInfo(): Promise<{ serial: string | null; revision: string | null }> {
  try {
    const raw = await readFile("/proc/cpuinfo", "utf8");
    const serialMatch = /^Serial\s*:\s*(\S+)/m.exec(raw);
    const revisionMatch = /^Revision\s*:\s*(\S+)/m.exec(raw);
    return { serial: serialMatch?.[1] ?? null, revision: revisionMatch?.[1] ?? null };
  } catch {
    return { serial: null, revision: null };
  }
}

async function readVoltage(rail: "core" | "sdram_c"): Promise<number | null> {
  try {
    const { stdout } = await runCommand("vcgencmd", ["measure_volts", rail], { timeoutMs: 3000 });
    const match = /volt=([\d.]+)V/.exec(stdout);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

export const HardwareService = {
  async getHardwareInfo(): Promise<HardwareInfo> {
    const [model, cpuInfo, cpuVoltage, coreVoltage] = await Promise.all([
      readDeviceTreeModel(),
      readCpuInfo(),
      readVoltage("core"),
      readVoltage("sdram_c"),
    ]);
    return {
      model,
      serial: cpuInfo.serial,
      revision: cpuInfo.revision,
      cpuVoltage,
      coreVoltage,
    };
  },

  async getClock(): Promise<MachineClock> {
    try {
      const { stdout } = await runCommand("timedatectl", ["show"], { timeoutMs: 3000 });
      const tzMatch = /^Timezone=(.+)$/m.exec(stdout);
      const ntpMatch = /^NTPSynchronized=(yes|no)$/m.exec(stdout);
      return {
        isoTime: new Date().toISOString(),
        timezone: tzMatch?.[1] ?? "UTC",
        ntpSynchronized: ntpMatch ? ntpMatch[1] === "yes" : null,
      };
    } catch {
      return { isoTime: new Date().toISOString(), timezone: "UTC", ntpSynchronized: null };
    }
  },

  async listInterfaces(): Promise<NetworkInterfaceInfo[]> {
    const ifaces = await si.networkInterfaces();
    const list = Array.isArray(ifaces) ? ifaces : [ifaces];
    return list
      .filter((i) => i.iface && i.iface !== "lo")
      .map((i) => ({
        name: i.iface,
        state: i.operstate === "up" ? "up" : i.operstate === "down" ? "down" : "unknown",
        addresses: [i.ip4, i.ip6].filter((a): a is string => !!a),
        mac: i.mac || null,
        isDefault: i.default === true,
      }));
  },

  async getWifiStatus(): Promise<WifiStatus> {
    try {
      const { stdout } = await runCommand(
        "nmcli",
        ["-t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "device"],
        { timeoutMs: 5000 }
      );
      const wifiLine = stdout.split("\n").find((l) => l.split(":")[1] === "wifi");
      if (!wifiLine) return { available: false, deviceName: null, connected: false, currentSsid: null, signal: null };

      const [device, , state, connection] = wifiLine.split(":");
      const connected = state === "connected";
      let signal: number | null = null;
      if (connected) {
        const { stdout: activeOut } = await runCommand(
          "nmcli",
          ["-t", "-f", "IN-USE,SIGNAL,SSID", "device", "wifi", "list", "ifname", device],
          { timeoutMs: 8000 }
        ).catch(() => ({ stdout: "" }));
        const activeLine = activeOut.split("\n").find((l) => l.startsWith("*:"));
        if (activeLine) signal = Number(activeLine.split(":")[1]) || null;
      }

      return {
        available: true,
        deviceName: device,
        connected,
        currentSsid: connected ? connection || null : null,
        signal,
      };
    } catch {
      return { available: false, deviceName: null, connected: false, currentSsid: null, signal: null };
    }
  },

  async scanWifi(): Promise<WifiNetwork[]> {
    const { stdout } = await runCommand(
      "nmcli",
      ["-t", "-f", "IN-USE,SSID,SIGNAL,SECURITY", "device", "wifi", "list", "--rescan", "yes"],
      { timeoutMs: 15000 }
    );
    const seen = new Set<string>();
    const results: WifiNetwork[] = [];
    for (const line of stdout.split("\n")) {
      if (!line.trim()) continue;
      const [inUse, ssid, signal, security] = line.split(":");
      if (!ssid || seen.has(ssid)) continue;
      seen.add(ssid);
      results.push({
        ssid,
        signal: Number(signal) || 0,
        security: security || "open",
        inUse: inUse === "*",
      });
    }
    return results.sort((a, b) => b.signal - a.signal);
  },

  async connectWifi(ssid: string, password: string): Promise<void> {
    if (!ssid || ssid.length > 64) throw new Error("invalid_ssid");
    // sudo: joining a network reconfigures NetworkManager connection profiles,
    // scoped to this exact subcommand shape rather than broad nmcli access.
    await runCommand("sudo", ["nmcli", "device", "wifi", "connect", ssid, "password", password], {
      timeoutMs: 30000,
    });
  },

  async disconnectWifi(deviceName: string): Promise<void> {
    await runCommand("sudo", ["nmcli", "device", "disconnect", deviceName], { timeoutMs: 10000 });
  },

  /** Lists every saved NetworkManager connection profile of type wifi (not
   * just the one currently active) — this is what a migration snapshot needs
   * to reconnect to the SAME networks on a new machine, not just today's
   * active SSID. */
  async listSavedWifiConnections(): Promise<string[]> {
    const { stdout } = await runCommand(
      "nmcli",
      ["-t", "-f", "NAME,TYPE", "connection", "show"],
      { timeoutMs: 5000 }
    ).catch(() => ({ stdout: "" }));
    return stdout
      .split("\n")
      .filter((l) => l.split(":")[1] === "802-11-wireless")
      .map((l) => l.split(":")[0])
      .filter(Boolean);
  },

  /** Tars the whole system-connections directory (root-only .nmconnection
   * files, PSK included in plaintext per NetworkManager's own storage format)
   * to destPath — sudo required, same root-only-file rationale as sshd_config
   * above. Captures every saved profile in one archive rather than one file
   * per SSID, since nmcli doesn't expose a stable file-per-connection-name
   * mapping without also shelling out per connection. */
  async backupWifiConnections(destPath: string): Promise<void> {
    await runCommand(
      "sudo",
      ["tar", "czf", destPath, "-C", "/etc/NetworkManager", "system-connections"],
      { timeoutMs: 15000 }
    );
  },

  /** Restore-side counterpart to backupWifiConnections — extracts the saved
   * profiles back into place and asks NetworkManager to reload them from
   * disk, same mechanism `nmcli connection reload` uses after any manual
   * edit under system-connections/. */
  async restoreWifiConnections(archivePath: string): Promise<void> {
    await runCommand(
      "sudo",
      ["tar", "xzf", archivePath, "-C", "/etc/NetworkManager"],
      { timeoutMs: 15000 }
    );
    await runCommand("sudo", ["nmcli", "connection", "reload"], { timeoutMs: 10000 }).catch(() => {});
  },

  async getSshStatus(): Promise<SshStatus> {
    let active = false;
    let enabled = false;
    try {
      const { stdout } = await runCommand("systemctl", ["is-active", "ssh"], { timeoutMs: 3000 });
      active = stdout.trim() === "active";
    } catch {
      active = false;
    }
    try {
      const { stdout } = await runCommand("systemctl", ["is-enabled", "ssh"], { timeoutMs: 3000 });
      enabled = stdout.trim() === "enabled";
    } catch {
      enabled = false;
    }

    let port: number | null = 22;
    let passwordAuthEnabled: boolean | null = null;
    const sshdConfigPath = "/etc/ssh/sshd_config";
    if (existsSync(sshdConfigPath)) {
      try {
        // sudo: sshd_config is root-only (0600) on a hardened setup.
        const { stdout } = await runCommand("sudo", ["cat", sshdConfigPath], { timeoutMs: 3000 });
        const portMatch = /^\s*Port\s+(\d+)/m.exec(stdout);
        if (portMatch) port = Number(portMatch[1]);
        const pwMatch = /^\s*PasswordAuthentication\s+(yes|no)/m.exec(stdout);
        if (pwMatch) passwordAuthEnabled = pwMatch[1] === "yes";
      } catch {
        // leave defaults
      }
    }

    return { active, enabled, port, passwordAuthEnabled };
  },

  async listFailedUnits(): Promise<SystemdUnitSummary[]> {
    try {
      const { stdout } = await runCommand(
        "systemctl",
        ["list-units", "--type=service", "--state=failed", "--plain", "--no-legend", "--no-pager"],
        { timeoutMs: 5000 }
      );
      return parseUnitLines(stdout);
    } catch {
      return [];
    }
  },

  async countRunningServices(): Promise<number> {
    try {
      const { stdout } = await runCommand(
        "systemctl",
        ["list-units", "--type=service", "--state=running", "--plain", "--no-legend", "--no-pager"],
        { timeoutMs: 5000 }
      );
      return stdout.split("\n").filter((l) => l.trim()).length;
    } catch {
      return 0;
    }
  },

  async listServices(filter?: string): Promise<SystemdUnitSummary[]> {
    const { stdout } = await runCommand(
      "systemctl",
      ["list-units", "--type=service", "--all", "--plain", "--no-legend", "--no-pager"],
      { timeoutMs: 8000 }
    );
    const units = parseUnitLines(stdout);
    if (!filter) return units;
    const lower = filter.toLowerCase();
    return units.filter((u) => u.name.toLowerCase().includes(lower) || u.description.toLowerCase().includes(lower));
  },

  async getOverview(): Promise<HardwareOverview> {
    const [hardware, clock, interfaces, wifi, ssh, failedUnits, runningServicesCount] = await Promise.all([
      this.getHardwareInfo(),
      this.getClock(),
      this.listInterfaces(),
      this.getWifiStatus(),
      this.getSshStatus(),
      this.listFailedUnits(),
      this.countRunningServices(),
    ]);
    return { hardware, clock, interfaces, wifi, ssh, failedUnits, runningServicesCount };
  },
};

function parseUnitLines(stdout: string): SystemdUnitSummary[] {
  const results: SystemdUnitSummary[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    const match = /^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s*(.*)$/.exec(line.trim());
    if (!match) continue;
    const [, name, loadState, activeState, subState, description] = match;
    results.push({ name, loadState, activeState, subState, description: description.trim() });
  }
  return results;
}
