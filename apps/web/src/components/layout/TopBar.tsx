import { useEffect } from "react";
import { Menu, Bell } from "lucide-react";
import { useLocation } from "react-router-dom";
import { navItems } from "./navItems";
import { ServerSwitcher } from "./ServerSwitcher";
import { useHostname } from "@/lib/useHostname";
import { useWebServerEngine } from "@/lib/useWebServerEngine";

interface TopBarProps {
  onMenuClick: () => void;
  alertCount?: number;
}

export function TopBar({ onMenuClick, alertCount = 0 }: TopBarProps) {
  const location = useLocation();
  const current = navItems.find((i) => (i.to === "/" ? location.pathname === "/" : location.pathname.startsWith(i.to)));
  const hostname = useHostname();
  const webServerEngine = useWebServerEngine();
  // The nav menu's own "Nginx" label stays static (see useWebServerEngine's
  // doc comment) — only the page title, which is actually visible while the
  // admin is looking at this exact screen, reflects the real detected engine.
  const pageLabel =
    current?.to === "/nginx" && webServerEngine === "apache" ? "Apache" : current?.label ?? "Server Admin";

  useEffect(() => {
    document.title = hostname ? `${pageLabel} — ${hostname}` : pageLabel;
  }, [pageLabel, hostname]);

  return (
    <header
      className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-card/95 px-3 backdrop-blur"
      style={{ paddingTop: "env(safe-area-inset-top)", height: "calc(3.5rem + env(safe-area-inset-top))" }}
    >
      <button
        type="button"
        onClick={onMenuClick}
        aria-label="Ouvrir le menu"
        className="rounded-md p-2 hover:bg-muted"
      >
        <Menu className="h-6 w-6" />
      </button>
      <div className="flex flex-col items-center leading-tight">
        <h1 className="text-base font-semibold">{pageLabel}</h1>
        {hostname && <span className="text-[11px] text-muted-foreground">{hostname}</span>}
      </div>
      <div className="flex items-center gap-1">
        <ServerSwitcher />
        <button
          type="button"
          aria-label="Alertes"
          className="relative rounded-md p-2 hover:bg-muted"
        >
          <Bell className="h-5 w-5" />
          {alertCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
              {alertCount}
            </span>
          )}
        </button>
      </div>
    </header>
  );
}
