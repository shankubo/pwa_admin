export interface HardwareInfo {
  model: string | null;
  serial: string | null;
  revision: string | null;
  cpuVoltage: number | null;
  coreVoltage: number | null;
}

export interface MachineClock {
  isoTime: string;
  timezone: string;
  ntpSynchronized: boolean | null;
}

export interface NetworkInterfaceInfo {
  name: string;
  state: "up" | "down" | "unknown";
  addresses: string[];
  mac: string | null;
  isDefault: boolean;
}

export interface WifiNetwork {
  ssid: string;
  signal: number;
  security: string;
  inUse: boolean;
}

export interface WifiStatus {
  available: boolean;
  deviceName: string | null;
  connected: boolean;
  currentSsid: string | null;
  signal: number | null;
}

export interface SystemdUnitSummary {
  name: string;
  loadState: string;
  activeState: string;
  subState: string;
  description: string;
}

export interface SshStatus {
  active: boolean;
  enabled: boolean;
  port: number | null;
  passwordAuthEnabled: boolean | null;
}

export interface HardwareOverview {
  hardware: HardwareInfo;
  clock: MachineClock;
  interfaces: NetworkInterfaceInfo[];
  wifi: WifiStatus;
  ssh: SshStatus;
  failedUnits: SystemdUnitSummary[];
  runningServicesCount: number;
}
