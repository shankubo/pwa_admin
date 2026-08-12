export interface OsInfo {
  distro: string;
  release: string;
  kernel: string;
  arch: string;
  hostname: string;
  uptimeSeconds: number;
  rebootRequired: boolean;
  rebootRequiredPackages: string[];
}

export interface InstalledPackage {
  name: string;
  version: string;
  architecture: string;
  sizeKb: number;
}

export interface UpgradablePackage {
  name: string;
  currentVersion: string;
  availableVersion: string;
}

export type OsJobKind = "update-check" | "upgrade" | "install" | "install-batch" | "remove" | "hold" | "unhold";
export type OsJobStatus = "pending" | "running" | "succeeded" | "failed";

export interface OsJob {
  jobId: string;
  kind: OsJobKind;
  status: OsJobStatus;
  exitCode: number | null;
  startedAt: string;
  finishedAt: string | null;
}
