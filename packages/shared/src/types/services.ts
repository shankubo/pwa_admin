export type ServiceName = "tailscale" | "docker" | "pm2";

export interface ServiceStatusEntry {
  name: ServiceName;
  label: string;
  installed: boolean;
  running: boolean;
  version: string | null;
  updateAvailable: boolean | null;
  /** Service-specific extra fields (e.g. Tailscale's tailscaleIps/hostname,
   * Docker's container/image counts, PM2's process count) — kept as a loose
   * bag rather than one flat interface with mostly-null fields per service. */
  detail: Record<string, unknown> | null;
}

export interface ServicesOverview {
  services: ServiceStatusEntry[];
  checkedAt: string;
}

export interface ServiceUpdateResult {
  ok: boolean;
  output: string;
  requiresRestart: boolean;
}
