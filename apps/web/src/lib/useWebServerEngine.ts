import { useEffect, useState } from "react";
import type { WebServerStatus } from "@pwa-admin/shared";
import { apiJson } from "./api";

let cached: "nginx" | "apache" | "none" | null = null;

/** Fetches the actually-detected web server engine once and caches it for
 * the tab's lifetime — same module-level-cache shape as useHostname. Used
 * only to give the /nginx screen's page title its real engine name ("Apache"
 * vs "Nginx"); the nav menu's own label stays the static "Nginx" (see the
 * Apache-parity implementation plan's explicit scope decision — a dynamic
 * page title was judged worth it, a dynamic nav-menu label was not, for a
 * menu that's rarely open at the same time as the page itself). */
export function useWebServerEngine(): "nginx" | "apache" | "none" | null {
  const [engine, setEngine] = useState<typeof cached>(cached);

  useEffect(() => {
    if (cached) return;
    apiJson<WebServerStatus>("/nginx/status")
      .then((status) => {
        cached = status.engine;
        setEngine(status.engine);
      })
      .catch(() => {});
  }, []);

  return engine;
}
