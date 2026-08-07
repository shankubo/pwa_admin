export interface SystemStatsSnapshot {
  timestamp: string;
  cpu: {
    loadPercent: number;
    temperatureC: number | null;
    throttled: {
      underVoltage: boolean;
      throttled: boolean;
      raw: string | null;
    } | null;
  };
  memory: {
    totalBytes: number;
    usedBytes: number;
    usedPercent: number;
  };
  disks: Array<{
    mount: string;
    totalBytes: number;
    usedBytes: number;
    usedPercent: number;
  }>;
  network: Array<{
    iface: string;
    rxBytesPerSec: number;
    txBytesPerSec: number;
  }>;
  uptimeSeconds: number;
  os: {
    platform: string;
    distro: string;
    release: string;
    kernel: string;
    arch: string;
  };
}

export type AlertSeverity = "warning" | "critical";

export type AlertType =
  | "cpu_temp"
  | "disk_usage"
  | "cpu_load"
  | "memory_usage"
  | "reboot_required"
  | "fail2ban_ban"
  | "os_updates_available";

export interface SystemAlert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  raisedAt: string;
}
