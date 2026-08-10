import { useEffect, useState } from "react";
import type { OsInfo } from "@pwa-admin/shared";
import { apiJson } from "./api";

let cached: string | null = null;

/** Fetches this deployment's system hostname once and caches it for the tab's
 * lifetime — used to tell apart multiple pwa-admin servers open in different
 * tabs/windows (title, drawer, dashboard), since the URL alone (e.g. Tailscale
 * MagicDNS names) isn't always visually distinctive at a glance. */
export function useHostname(): string | null {
  const [hostname, setHostname] = useState<string | null>(cached);

  useEffect(() => {
    if (cached) return;
    apiJson<OsInfo>("/os/info")
      .then((info) => {
        cached = info.hostname;
        setHostname(info.hostname);
      })
      .catch(() => {});
  }, []);

  return hostname;
}
