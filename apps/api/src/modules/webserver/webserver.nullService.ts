import type { WebServerService } from "./webserver.types.js";

function refuse(): never {
  throw new Error("no_web_server_detected");
}

/**
 * Stub used when detectWebServerEngine() finds neither Nginx nor Apache
 * (e.g. a Docker-only host fronting everything through a container's own
 * reverse proxy). Keeps every route/consumer that calls webServer() from
 * crashing or 500ing — read-only calls return an empty/false/null shape,
 * mutating calls throw a single, greppable error the routes already turn
 * into a 400 the same way any other WebServerService failure does.
 */
export const NullWebServerService: WebServerService = {
  engine: "none",
  logDir: "",

  async getStatus() {
    return { engine: "none", active: false, version: null, configTestOk: false, configTestOutput: "", stubStatus: null };
  },
  async listVhosts() {
    return [];
  },
  async getVhostDetail() {
    throw new Error("no_web_server_detected");
  },
  enableVhost: refuse,
  disableVhost: refuse,
  isInMaintenance() {
    return false;
  },
  enableMaintenance: refuse,
  disableMaintenance: refuse,
  isSwitchedToDuplicate() {
    return false;
  },
  switchToDuplicate: refuse,
  switchToPrimary: refuse,
  writeVhostConfig: refuse,
  createVhost: refuse,
  async snapshotVhost() {
    return null;
  },
  async listVhostHistory() {
    return [];
  },
  restoreSnapshot: refuse,
  async testConfig() {
    return { ok: false, output: "no_web_server_detected" };
  },
  reload: refuse,
  restart: refuse,
  async getVhostLogs() {
    return "";
  },
  async resolveVhostLogPath() {
    return null;
  },
  async getCertStatus() {
    return { found: false, issuer: null, subject: null, notAfter: null, daysRemaining: null, source: "none" };
  },
  async checkAccessibility() {
    return { checkedUrl: null, reachable: false, statusCode: null, latencyMs: null, error: "no_web_server_detected", checkedAt: new Date().toISOString() };
  },
  async getVhostErrors(_name, windowHours = 24) {
    return { recentCount: 0, windowHours, entries: [] };
  },
  async backupConfig() {
    throw new Error("no_web_server_detected");
  },
  restoreConfig: refuse,
  async resolveCertPaths() {
    return null;
  },
  restoreCertArchive: refuse,
  async checkCertPathExists() {
    return false;
  },
  saveManagedCert: refuse,
  parseGuidedFields() {
    throw new Error("no_web_server_detected");
  },
  async applyGuidedFields() {
    throw new Error("no_web_server_detected");
  },
  async buildInitialVhostConfig() {
    throw new Error("no_web_server_detected");
  },
};
