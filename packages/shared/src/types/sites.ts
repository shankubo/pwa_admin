import type { NginxVhostSummary, NginxVhostDetail, NginxCertStatus } from "./nginx.js";

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
  status: "ready" | "stale" | "refreshing";
  sizeBytes: number | null;
  lastSyncedAt: string;
  createdAt: string;
}

export interface SiteSummary extends NginxVhostSummary {
  linkedContainer: LinkedContainer | null;
  /** Whether a duplicate exists for this vhost — drives the failover button's
   * visibility in the Sites list without a per-row status fetch. */
  hasDuplicate: boolean;
  /** Whether traffic is currently switched to the duplicate (manual failover active). */
  failoverActive: boolean;
}

export interface SiteDetail {
  vhost: NginxVhostDetail;
  cert: NginxCertStatus;
  linkedContainer: LinkedContainer | null;
  duplicate: SiteDuplicateStatus | null;
  failoverActive: boolean;
}
