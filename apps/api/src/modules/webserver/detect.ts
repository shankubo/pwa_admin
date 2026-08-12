import { runCommand } from "../../utils/exec.js";
import type { WebServerEngine } from "@pwa-admin/shared";

export type DetectedEngine = Exclude<WebServerEngine, "none"> | "none";

async function isUnitActive(unit: string): Promise<boolean> {
  return runCommand("systemctl", ["is-active", unit], { timeoutMs: 5000 }).then(
    ({ stdout }) => stdout.trim() === "active",
    () => false
  );
}

async function binaryExists(bin: string): Promise<boolean> {
  return runCommand("which", [bin], { timeoutMs: 5000 }).then(
    () => true,
    () => false
  );
}

/**
 * Runs once at boot (see webserver.registry.ts) — never re-detected at
 * runtime, matching this app's own "config/topology changes need a restart"
 * model (no hot-reload culture anywhere else in this codebase either).
 *
 * Priority: an ACTIVE systemd unit wins over mere binary presence, since a
 * box can have both installed but only one genuinely serving traffic. If
 * both are somehow active (broken host state — they'd be fighting over
 * :80/:443), or both are merely present with neither active, Nginx wins the
 * tie deterministically: it's this app's original/incumbent engine, so an
 * Apache install alongside an existing Nginx setup should never silently
 * flip the whole admin UI to managing the wrong one.
 *
 * The `httpd` unit-name check exists only as a defensive detection probe
 * (so a RHEL-family box doesn't get silently misreported as "nothing
 * installed") — ApacheService itself only implements Debian/Ubuntu's
 * `apache2` conventions (binary path, sites-available layout, a2ensite/
 * a2dissite tooling); see the Apache-parity implementation plan for why
 * RHEL/httpd support is explicitly out of v1 scope.
 */
export async function detectWebServerEngine(): Promise<DetectedEngine> {
  const [nginxActive, apacheActive, httpdActive] = await Promise.all([
    isUnitActive("nginx"),
    isUnitActive("apache2"),
    isUnitActive("httpd"),
  ]);

  if (nginxActive && (apacheActive || httpdActive)) {
    console.warn("webserver.detect: both nginx and apache report as active — defaulting to nginx");
    return "nginx";
  }
  if (nginxActive) return "nginx";
  if (apacheActive || httpdActive) return "apache";

  const [nginxPresent, apachePresent] = await Promise.all([binaryExists("nginx"), binaryExists("apache2")]);
  if (nginxPresent && apachePresent) {
    console.warn("webserver.detect: both nginx and apache2 binaries present, neither active — defaulting to nginx");
    return "nginx";
  }
  if (nginxPresent) return "nginx";
  if (apachePresent) return "apache";

  return "none";
}
