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
  xssProtection: boolean;
  permissionsPolicy: boolean;
  contentSecurityPolicy: boolean;
}

export type NginxGuidedMode = "root" | "proxy_pass" | "mixed" | "unknown";

/** Free-text TLS tuning fields — deliberately plain strings (not
 * checkboxes/dropdowns of "known good" values) since cipher suites and
 * protocol lists are copy-pasted from external references (Mozilla SSL
 * Config Generator, etc.) far more often than typed by hand; validating
 * their contents is out of scope, same as clientMaxBodySize today. */
export interface NginxGuidedTls {
  protocols: string | null;
  ciphers: string | null;
  sessionCache: string | null;
  sessionTimeout: string | null;
}

export interface NginxGuidedGzip {
  enabled: boolean;
  types: string | null;
}

/**
 * One of a small, fixed library of pre-built `location {}` snippets — never
 * a free-text location editor. Each key toggles a whole known-good block in
 * or out; the guided editor only ever adds/removes an ENTIRE block it
 * recognizes by a leading marker comment (see LOCATION_TEMPLATES in
 * nginx.guidedEditor.ts), never edits inside one, so there's no risk of a
 * malformed partial location{} — the highest-risk category of hand-edit
 * this feature exists to avoid.
 */
export interface NginxGuidedLocations {
  blockDotfiles: boolean;
  cacheStaticAssets: boolean;
  spaFallback: boolean;
}

export interface NginxGuidedFormModel {
  sslEnabled: boolean;
  certPath: string | null;
  certKeyPath: string | null;
  clientMaxBodySize: string | null;
  headers: NginxGuidedHeaders;
  mode: NginxGuidedMode;
  rootPath: string | null;
  proxyPassTarget: string | null;
  tls: NginxGuidedTls;
  gzip: NginxGuidedGzip;
  locations: NginxGuidedLocations;
}
