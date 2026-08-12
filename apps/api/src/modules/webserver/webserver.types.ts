import type {
  WebServerEngine,
  WebServerStatus,
  VhostSummary,
  VhostDetail,
  VhostAccessibility,
  VhostErrorSummary,
  ConfigBackupRun,
  ConfigSnapshot,
  CertStatus,
  GuidedFormModel,
} from "@pwa-admin/shared";

/**
 * Common surface both NginxService and ApacheService implement — every
 * route/consumer in this app talks to whichever one webserver.registry.ts
 * resolved at boot, never to a concrete engine module directly (except the
 * private, git-untracked imanote plugin, which keeps importing NginxService
 * by its unchanged export name/path — see webserver.registry.ts's own doc
 * comment for why that's an accepted, documented exception).
 *
 * Method-for-method identical to NginxService's pre-refactor shape, plus
 * parseGuidedFields/applyGuidedFields/buildInitialVhostConfig promoted from
 * free functions (previously imported directly by nginx.routes.ts from
 * nginx.guidedEditor.ts) into interface methods, so the shared route file
 * can drive the guided editor for either engine without importing either
 * concrete module.
 */
export interface WebServerService {
  readonly engine: WebServerEngine;
  /** Directory this engine's own logs live under (env.NGINX_LOG_DIR /
   * env.APACHE_LOG_DIR) — a plain data field, not a method, since
   * network.service.ts's traffic-analytics feature reads it directly rather
   * than going through a method; exposing it here removes the pre-existing
   * direct env.NGINX_LOG_DIR read that bypassed NginxService entirely. */
  readonly logDir: string;

  getStatus(): Promise<WebServerStatus>;
  listVhosts(): Promise<VhostSummary[]>;
  getVhostDetail(name: string): Promise<VhostDetail>;
  enableVhost(name: string): Promise<void>;
  disableVhost(name: string): Promise<void>;
  isInMaintenance(name: string): boolean;
  enableMaintenance(name: string): Promise<void>;
  disableMaintenance(name: string): Promise<void>;
  isSwitchedToDuplicate(name: string): boolean;
  switchToDuplicate(name: string): Promise<void>;
  switchToPrimary(name: string): Promise<void>;
  writeVhostConfig(name: string, content: string): Promise<void>;
  createVhost(name: string, content: string): Promise<void>;
  snapshotVhost(name: string): Promise<number | null>;
  listVhostHistory(name: string): Promise<ConfigSnapshot[]>;
  restoreSnapshot(name: string, snapshotId: number): Promise<void>;
  testConfig(): Promise<{ ok: boolean; output: string }>;
  reload(): Promise<void>;
  restart(): Promise<void>;
  getVhostLogs(name: string, type: "access" | "error", tail?: number): Promise<string>;
  resolveVhostLogPath(name: string, type: "access" | "error"): Promise<string | null>;
  getCertStatus(name: string): Promise<CertStatus>;
  checkAccessibility(name: string): Promise<VhostAccessibility>;
  getVhostErrors(name: string, windowHours?: number, limit?: number): Promise<VhostErrorSummary>;
  backupConfig(targets: ("local" | "gdrive")[]): Promise<ConfigBackupRun>;
  restoreConfig(archivePath: string): Promise<void>;
  resolveCertPaths(name: string): Promise<{ domain: string; source: "certbot" | "manual"; paths: string[] } | null>;
  restoreCertArchive(archivePath: string): Promise<void>;
  checkCertPathExists(path: string): Promise<boolean>;
  saveManagedCert(vhostName: string, certPemPath: string, keyPemPath: string): Promise<{ certPath: string; keyPath: string }>;
  parseGuidedFields(rawConfig: string): GuidedFormModel;
  /** Async (unlike nginx.guidedEditor.ts's originally-sync free function)
   * because ApacheService's implementation must check/auto-enable Apache
   * modules (mod_ssl, mod_headers, mod_deflate, mod_expires) before writing
   * directives that depend on them — see apache.service.ts's
   * ensureModulesForModel. NginxService's implementation stays a plain sync
   * function wrapped in an immediately-resolved Promise. */
  applyGuidedFields(rawConfig: string, model: GuidedFormModel): Promise<string>;
  buildInitialVhostConfig(model: GuidedFormModel & { serverName: string; listenPort: number }): Promise<string>;
}
