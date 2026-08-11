import { useRegisterSW } from "virtual:pwa-register/react";
import { RefreshCw, X } from "lucide-react";

/**
 * Surfaces the service worker's "new version ready" state instead of
 * updating silently — critical on iOS, where an installed PWA's service
 * worker almost never wakes up on its own to check for updates, so without
 * an explicit in-app affordance there's no reliable way to notice or force
 * a stale build to refresh (registerType "prompt" in vite.config.ts is what
 * makes needRefresh actually fire, instead of autoUpdate swapping versions
 * invisibly with nothing for this component to hook into).
 */
export function UpdateBanner() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) return null;

  return (
    <div className="sticky top-0 z-40 flex items-center justify-between gap-2 bg-primary px-3 py-2 text-sm text-primary-foreground">
      <div className="flex items-center gap-2">
        <RefreshCw className="h-4 w-4 shrink-0" />
        <span>Nouvelle version disponible.</span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => updateServiceWorker(true)}
          className="rounded-md bg-primary-foreground/20 px-3 py-1 font-medium hover:bg-primary-foreground/30"
        >
          Mettre à jour
        </button>
        <button
          type="button"
          aria-label="Ignorer"
          onClick={() => setNeedRefresh(false)}
          className="rounded-md p-1 hover:bg-primary-foreground/20"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
