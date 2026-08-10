import { useRef, useState, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";

const HOLD_MS = 3000;
const MAX_PULL_PX = 120;
const TRIGGER_PULL_PX = 70;

/**
 * Pull-down-and-hold gesture that forces a full page reload — not just a
 * data refetch. Useful in a PWA with a service worker: reloading is how an
 * admin recovers if the SW is still serving a stale bundle from before the
 * last deploy. Only arms when the scroll container is already at the top,
 * so it never fights a normal scroll gesture partway down a page.
 */
export function PullToRefresh({ children }: { children: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const startY = useRef<number | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [holding, setHolding] = useState(false);
  const [triggered, setTriggered] = useState(false);

  function clearHold() {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    setHolding(false);
  }

  function onTouchStart(e: React.TouchEvent) {
    if (window.scrollY > 0) {
      startY.current = null;
      return;
    }
    startY.current = e.touches[0].clientY;
  }

  function onTouchMove(e: React.TouchEvent) {
    if (startY.current == null) return;
    const delta = e.touches[0].clientY - startY.current;
    if (delta <= 0) {
      setPullDistance(0);
      clearHold();
      return;
    }
    const clamped = Math.min(delta, MAX_PULL_PX);
    setPullDistance(clamped);

    if (clamped >= TRIGGER_PULL_PX && !holdTimer.current && !triggered) {
      setHolding(true);
      holdTimer.current = setTimeout(() => {
        setTriggered(true);
        window.location.reload();
      }, HOLD_MS);
    } else if (clamped < TRIGGER_PULL_PX) {
      clearHold();
    }
  }

  function onTouchEnd() {
    startY.current = null;
    setPullDistance(0);
    clearHold();
  }

  return (
    <div
      ref={containerRef}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      {pullDistance > 0 && (
        <div
          className="flex items-center justify-center overflow-hidden text-muted-foreground transition-[height]"
          style={{ height: pullDistance }}
        >
          <RefreshCw
            className={`h-5 w-5 ${holding ? "animate-spin text-primary" : ""}`}
            style={{ transform: holding ? undefined : `rotate(${pullDistance * 2}deg)` }}
          />
        </div>
      )}
      {children}
    </div>
  );
}
