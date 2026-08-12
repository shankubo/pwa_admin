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
  maintenanceMode: boolean;
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

/**
 * Structured form model for the guided config editor's v1 field set —
 * deliberately NOT a full parse of the server block, only the directives
 * this editor knows how to read/write (see nginx.guidedEditor.ts's own doc
 * comment). Anything else in the raw config is left untouched by both
 * parse and serialize.
 */
export interface NginxGuidedHeaders {
  frameOptions: boolean;
  contentTypeOptions: boolean;
  referrerPolicy: boolean;
  hsts: boolean;
}

export type NginxGuidedMode = "root" | "proxy_pass" | "mixed" | "unknown";

export interface NginxGuidedFormModel {
  sslEnabled: boolean;
  certPath: string | null;
  certKeyPath: string | null;
  clientMaxBodySize: string | null;
  headers: NginxGuidedHeaders;
  mode: NginxGuidedMode;
  rootPath: string | null;
  proxyPassTarget: string | null;
}
