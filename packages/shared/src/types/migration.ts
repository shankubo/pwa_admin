export type MigrationSnapshotStatus = "pending" | "running" | "success" | "partial" | "failed";

export type MigrationManifestItemCategory =
  | "os-packages"
  | "docker-image"
  | "docker-volume"
  | "database"
  | "nginx-config"
  | "tls-cert"
  | "wifi-config"
  | "application"
  | "pwa-admin-config";

/**
 * Minimal `docker.createContainer()` input, captured at snapshot time from
 * `container.inspect()`. Only populated on "docker-image" items — needed
 * because the existing image-restore function (ApplicationService.
 * restoreContainerImage, the "safe recreate" pattern used elsewhere in the
 * app) requires the container to ALREADY exist on the host so it can inspect
 * it before recreating — which is never true on a brand-new server. Carrying
 * this config in the manifest lets a from-scratch restore call
 * docker.createContainer() directly, with no live container to inspect.
 */
export interface MigrationContainerConfig {
  containerName: string;
  image: string;
  env: string[];
  cmd: string[] | null;
  entrypoint: string[] | null;
  exposedPorts: Record<string, object>;
  labels: Record<string, string>;
  hostConfig: unknown;
  wasRunning: boolean;
}

/**
 * Where a "database" item's dump came from, captured so restore can re-find
 * the equivalent target on the NEW server rather than reusing the old
 * server's raw ref — a Docker container ID is randomly assigned at creation
 * and never survives a recreate, so for a Docker-hosted DB the restorable
 * identity is the container NAME (re-resolved to whatever new ID that name
 * gets on this server), not the captured ref itself. A native (host-service)
 * DB's ref is just its systemd service name, which IS stable across
 * machines — reused as-is, on the assumption the corresponding DB engine
 * package has already been (re)installed on the new server (see os-packages,
 * or the admin installed it manually — this app can't install/configure a DB
 * engine itself, only dump/restore its data).
 */
export interface MigrationDatabaseTarget {
  location: "docker" | "native";
  /** location: "docker" — the container name (not ID). location: "native" — the systemd service name, used as-is. */
  containerNameOrService: string;
}

/** Only set on "docker-volume" items — the volume's own name, needed because
 * restore creates/fills a volume by name, and (unlike a container) a volume
 * has no separate "identity that changes on recreate" problem, but the name
 * still needs to travel structured rather than parsed back out of `label`. */
export interface MigrationVolumeTarget {
  volumeName: string;
}

/**
 * Only set on "tls-cert" items — one vhost's certificate material. Both
 * `certbot` (whole `/etc/letsencrypt/live/<domain>` + `archive/<domain>`,
 * since `live` is a symlink farm pointing into `archive`) and `manual`
 * (whatever exact files the vhost's own `ssl_certificate`/`ssl_certificate_key`
 * directives point to) are captured as a single tar so restore can extract it
 * back verbatim — re-issuing a Let's Encrypt cert automatically isn't
 * attempted, since that requires the new server's DNS/port 80 to already be
 * reachable from the outside, which a Tailscale-only box never is.
 */
export interface MigrationCertTarget {
  vhostName: string;
  domain: string;
  source: "certbot" | "manual";
  /** Absolute paths this archive restores files back to, relative to `/` — used to extract with `-C /`. */
  restorePaths: string[];
}

/** Only set on "wifi-config" items — this machine's saved NetworkManager
 * Wi-Fi connection profiles (`/etc/NetworkManager/system-connections/*.nmconnection`),
 * PSK included. Captured only when nmcli reports at least one Wi-Fi device
 * (most servers are wired-only) — see WifiStatus.available. */
export interface MigrationWifiProfile {
  connectionNames: string[];
}

/** One host directory path from an Application's `paths[]`, paired with the
 * per-path tar.gz archive AppBackupRunModel.copySnapshotToUsb produced for
 * it on the USB drive — restore extracts each archive directly back onto
 * `path`, since (unlike volumes/DBs/images) an Application's local rsync
 * snapshot tree never itself leaves the old server, only these per-path
 * tarballs do. */
export interface MigrationApplicationPathArchive {
  path: string;
  usbArchivePath: string;
}

/** One captured piece of a migration manifest. References an artifact already
 * produced by an existing backup service (backup_history/app_backup_runs run,
 * or the nginx config backup) rather than duplicating its data — sourceRunId
 * is how a restore step finds the underlying archive to restore from. */
export interface MigrationManifestItem {
  category: MigrationManifestItemCategory;
  label: string;
  sourceRunId: string | null;
  archiveRelPath: string | null;
  sizeBytes: number | null;
  status: "success" | "failed" | "skipped";
  error: string | null;
  /** Only set on "docker-image" items — see MigrationContainerConfig. */
  containerConfig: MigrationContainerConfig | null;
  /** Only set on "application" items — see MigrationApplicationPathArchive. */
  applicationPaths: MigrationApplicationPathArchive[] | null;
  /** Only set on "application" items whose Application has a database — the
   * USB path of that DB's own dump archive, restored via the normal
   * "database" restore function before the app's paths are extracted. */
  applicationDbArchivePath: string | null;
  /** Only set on "database" items — see MigrationDatabaseTarget. */
  databaseTarget: MigrationDatabaseTarget | null;
  /** Only set on "docker-volume" items — see MigrationVolumeTarget. */
  volumeTarget: MigrationVolumeTarget | null;
  /** Only set on "tls-cert" items — see MigrationCertTarget. */
  certTarget: MigrationCertTarget | null;
  /** Only set on "wifi-config" items — see MigrationWifiProfile. */
  wifiProfile: MigrationWifiProfile | null;
}

/** Distinguishes a whole-server snapshot from a single-site snapshot (captured
 * from a Sites card's "Migration" button) — a site-scoped manifest only ever
 * contains docker-image/docker-volume/database/nginx-config items relevant to
 * that one vhost, never os-packages (Docker sites carry deps in their image)
 * or pwa-admin-config (server-wide only). */
export type MigrationManifestScope = { type: "server" } | { type: "site"; siteName: string };

export interface MigrationManifest {
  manifestId: string;
  hostname: string;
  createdAt: string;
  pwaAdminVersion: string;
  osDistro: string;
  osRelease: string;
  scope: MigrationManifestScope;
  items: MigrationManifestItem[];
  usbRoot: string;
}

export interface MigrationSnapshotRun {
  manifestId: string;
  scope: MigrationManifestScope;
  status: MigrationSnapshotStatus;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
}

/** Restore-side counterpart to MigrationSnapshotStatus — "partial" here means
 * at least one item restored successfully and at least one failed, same
 * best-effort philosophy as capture (a failed volume shouldn't block
 * restoring everything else). */
export type MigrationRestoreStatus = "pending" | "running" | "success" | "partial" | "failed";

export interface MigrationRestoreItemResult {
  category: MigrationManifestItemCategory;
  label: string;
  status: "success" | "failed" | "skipped";
  error: string | null;
}

export interface MigrationRestoreRun {
  restoreId: string;
  manifestId: string;
  status: MigrationRestoreStatus;
  includeOsPackages: boolean;
  items: MigrationRestoreItemResult[];
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
}

/** One line of a pre-flight restore plan (dry-run) — shown to the admin
 * before any confirmation, so nothing changes on the server until the
 * action described here is explicitly confirmed. */
export type MigrationPlanAction = "install" | "upgrade" | "up-to-date" | "replace" | "skip-unchanged" | "restore";

export interface MigrationPlanPackageLine {
  name: string;
  currentVersion: string | null;
  manifestVersion: string;
  action: "install" | "upgrade" | "up-to-date";
}

export interface MigrationPlanItemLine {
  category: MigrationManifestItemCategory;
  label: string;
  action: MigrationPlanAction;
  detail: string | null;
}

export interface MigrationRestorePlan {
  manifestId: string;
  osMatch: boolean;
  currentOsDistro: string;
  currentOsRelease: string;
  manifestOsDistro: string;
  manifestOsRelease: string;
  packages: MigrationPlanPackageLine[];
  items: MigrationPlanItemLine[];
}

/**
 * One downloadable artifact inside a migration manifest, for the "voir les
 * fichiers" export panel on the Restore confirmation screen — a manual-SSH
 * alternative to the app's own restore flow. `fileId` is an opaque key
 * (never the raw filesystem path — see MigrationService.listManifestFiles/
 * resolveManifestFileId) used to request a download without the client ever
 * round-tripping a real archiveRelPath back to the server.
 */
export interface MigrationManifestFileEntry {
  fileId: string;
  category: MigrationManifestItemCategory;
  label: string;
  /** Where this archive restores TO on the target machine, when known (e.g. an Application bind-mount path) — informational only. */
  destinationPath: string | null;
  sizeBytes: number | null;
}

export interface MigrationManifestFileList {
  manifestId: string;
  usbRoot: string;
  files: MigrationManifestFileEntry[];
}
