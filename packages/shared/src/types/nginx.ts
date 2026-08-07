export interface NginxStatus {
  active: boolean;
  version: string | null;
  configTestOk: boolean;
  configTestOutput: string;
  stubStatus: {
    activeConnections: number;
    requestsPerSecond: number;
  } | null;
}

export interface NginxVhostSummary {
  name: string;
  enabled: boolean;
  serverNames: string[];
  listenPorts: number[];
  proxyPassTarget: string | null;
  root: string | null;
  documentRootExists: boolean | null;
}

export interface NginxVhostDetail extends NginxVhostSummary {
  rawConfig: string;
}

export interface NginxVhostAccessibility {
  checkedUrl: string | null;
  reachable: boolean;
  statusCode: number | null;
  latencyMs: number | null;
  error: string | null;
  checkedAt: string;
}

export interface NginxErrorLogEntry {
  raw: string;
  timestamp: string | null;
}

export interface NginxVhostErrorSummary {
  recentCount: number;
  windowHours: number;
  entries: NginxErrorLogEntry[];
}

export interface NginxConfigBackupRun {
  runId: string;
  status: "success" | "failed";
  sizeBytes: number | null;
  driveFileId: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface NginxConfigSnapshot {
  id: number;
  vhostName: string;
  createdAt: string;
}

export interface NginxCertStatus {
  found: boolean;
  issuer: string | null;
  subject: string | null;
  notAfter: string | null;
  daysRemaining: number | null;
  source: "certbot" | "manual" | "none";
}
