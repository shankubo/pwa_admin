export interface ListeningPort {
  protocol: "tcp" | "udp";
  localAddress: string;
  port: number;
  processName: string | null;
  pid: number | null;
  ownedByContainer: string | null;
}

export interface TopPageEntry {
  path: string;
  hits: number;
}

export interface VisitorStats {
  uniqueIps: number;
  totalRequests: number;
  windowDays: number;
}

export interface Fail2banJailStatus {
  name: string;
  currentlyBanned: string[];
  totalBanned: number;
}

export interface BlockedIpEntry {
  ip: string;
  jail: string;
}
