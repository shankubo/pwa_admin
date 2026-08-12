import { useEffect, useState } from "react";
import type { ServicesOverview, ServiceName } from "@pwa-admin/shared";
import { apiJson } from "./api";

let cached: Set<ServiceName> | null = null;

/** Fetches which of docker/pm2/tailscale are installed on this deployment,
 * once per tab lifetime (same module-level-cache shape as useHostname) —
 * used to hide nav entries for a service that isn't present on this
 * particular server, rather than sending the admin to a page that just
 * says "not installed". Returns null while loading (nav renders everything
 * until the first answer arrives, matching this app's other has-loaded-yet
 * patterns rather than flashing items in after a hidden state). */
export function useInstalledServices(): Set<ServiceName> | null {
  const [installed, setInstalled] = useState<Set<ServiceName> | null>(cached);

  useEffect(() => {
    if (cached) return;
    apiJson<ServicesOverview>("/services/overview")
      .then((overview) => {
        const set = new Set(overview.services.filter((s) => s.installed).map((s) => s.name));
        cached = set;
        setInstalled(set);
      })
      .catch(() => {});
  }, []);

  return installed;
}
