import type { VhostSummary, VhostDetail, CertStatus } from "./webserver.js";

export interface LinkedContainer {
  id: string;
  name: string;
  state: string;
}

export interface SiteDuplicateStatus {
  vhostName: string;
  contentPath: string | null;
  dbLocation: "docker" | "native" | null;
  dbRef: string | null;
  dbName: string | null;
  duplicateDbName: string | null;
  duplicateContainerId: string | null;
  duplicateContainerName: string | null;
  duplicatePort: number | null;
  status: "ready" | "stale" | "refreshing" | "failed";
  /** Human-readable step label while status is "refreshing", e.g. "Copie des
   * fichiers…" — polled by the frontend to show live progress. */
  progressStep: string | null;
  /** Set when status is "failed" — the error from the last attempt. */
  error: string | null;
  sizeBytes: number | null;
  /** Size of the duplicated database itself (bytes) — separate from sizeBytes
   * (file content), since a duplicate can be DB-only (no content root, e.g. a
   * reverse-proxied site) and still occupy real disk space. */
  dbSizeBytes: number | null;
  lastSyncedAt: string;
  createdAt: string;
}

export interface SiteSummary extends VhostSummary {
  linkedContainer: LinkedContainer | null;
  /** Whether a duplicate exists for this vhost — drives the failover button's
   * visibility in the Sites list without a per-row status fetch. */
  hasDuplicate: boolean;
  /** Whether traffic is currently switched to the duplicate (manual failover active). */
  failoverActive: boolean;
}

export interface SiteDetail {
  vhost: VhostDetail;
  cert: CertStatus;
  linkedContainer: LinkedContainer | null;
  duplicate: SiteDuplicateStatus | null;
  failoverActive: boolean;
}
