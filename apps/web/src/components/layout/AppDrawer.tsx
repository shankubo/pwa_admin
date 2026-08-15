import * as Dialog from "@radix-ui/react-dialog";
import { NavLink } from "react-router-dom";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { navItems } from "./navItems";
import { cn } from "@/lib/utils";
import { useHostname } from "@/lib/useHostname";
import { useInstalledServices } from "@/lib/useInstalledServices";
import { useUiModeStore, type UiMode } from "@/stores/uiMode.store";

interface AppDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Easy Mode's deliberately closed set of screens — a non-technical operator
// sees only these plus the Wizard. Explicit allowlist rather than a NavItem
// field: keeps all mode-filtering logic in one place and requires no changes
// to externalNavItems.ts's generation contract (imanote is hidden by
// omission, not by a special case).
const EASY_MODE_PATHS = new Set(["/", "/help", "/about", "/settings", "/wizard"]);

function NavGroup({
  group,
  installedServices,
  mode,
  onNavigate,
}: {
  group: "top" | "management" | "ops" | "bottom";
  installedServices: ReturnType<typeof useInstalledServices>;
  mode: UiMode;
  onNavigate: () => void;
}) {
  const { t } = useTranslation("nav");
  const items = navItems.filter(
    (i) =>
      i.group === group &&
      // Until the first /services/overview answer arrives, installedServices
      // is null — show every item rather than hiding docker/pm2 during that
      // brief window (see useInstalledServices's own doc comment).
      (!i.requiresService || !installedServices || installedServices.has(i.requiresService)) &&
      (mode === "advanced" || EASY_MODE_PATHS.has(i.to))
  );
  return (
    <div className="flex flex-col gap-1">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === "/"}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
              isActive
                ? "bg-primary text-primary-foreground"
                : "text-foreground hover:bg-muted"
            )
          }
        >
          <item.icon className="h-5 w-5 shrink-0" />
          {t(item.labelKey)}
        </NavLink>
      ))}
    </div>
  );
}

export function AppDrawer({ open, onOpenChange }: AppDrawerProps) {
  const { t } = useTranslation("common");
  const hostname = useHostname();
  const installedServices = useInstalledServices();
  const mode = useUiModeStore((s) => s.mode);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          className="fixed inset-y-0 left-0 z-50 flex w-[85vw] max-w-xs flex-col gap-6 overflow-y-auto bg-card p-4 shadow-xl outline-none"
          style={{ paddingTop: "calc(1rem + env(safe-area-inset-top))" }}
          aria-describedby={undefined}
        >
          <div className="flex items-center justify-between">
            <div>
              <Dialog.Title className="text-lg font-semibold">{t("app.name")}</Dialog.Title>
              {hostname && <p className="text-xs text-muted-foreground">{hostname}</p>}
            </div>
            <Dialog.Close className="rounded-md p-1 hover:bg-muted">
              <X className="h-5 w-5" />
            </Dialog.Close>
          </div>

          <NavGroup group="top" installedServices={installedServices} mode={mode} onNavigate={() => onOpenChange(false)} />
          <div className="h-px bg-border" />
          <NavGroup group="management" installedServices={installedServices} mode={mode} onNavigate={() => onOpenChange(false)} />
          <div className="h-px bg-border" />
          <NavGroup group="ops" installedServices={installedServices} mode={mode} onNavigate={() => onOpenChange(false)} />
          <div className="mt-auto h-px bg-border" />
          <NavGroup group="bottom" installedServices={installedServices} mode={mode} onNavigate={() => onOpenChange(false)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
