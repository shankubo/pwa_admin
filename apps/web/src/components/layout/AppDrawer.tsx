import * as Dialog from "@radix-ui/react-dialog";
import { NavLink } from "react-router-dom";
import { X } from "lucide-react";
import { navItems } from "./navItems";
import { cn } from "@/lib/utils";
import { useHostname } from "@/lib/useHostname";
import { useInstalledServices } from "@/lib/useInstalledServices";

interface AppDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function NavGroup({
  group,
  installedServices,
  onNavigate,
}: {
  group: "top" | "management" | "ops" | "bottom";
  installedServices: ReturnType<typeof useInstalledServices>;
  onNavigate: () => void;
}) {
  const items = navItems.filter(
    (i) =>
      i.group === group &&
      // Until the first /services/overview answer arrives, installedServices
      // is null — show every item rather than hiding docker/pm2 during that
      // brief window (see useInstalledServices's own doc comment).
      (!i.requiresService || !installedServices || installedServices.has(i.requiresService))
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
          {item.label}
        </NavLink>
      ))}
    </div>
  );
}

export function AppDrawer({ open, onOpenChange }: AppDrawerProps) {
  const hostname = useHostname();
  const installedServices = useInstalledServices();

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
              <Dialog.Title className="text-lg font-semibold">Server Admin</Dialog.Title>
              {hostname && <p className="text-xs text-muted-foreground">{hostname}</p>}
            </div>
            <Dialog.Close className="rounded-md p-1 hover:bg-muted">
              <X className="h-5 w-5" />
            </Dialog.Close>
          </div>

          <NavGroup group="top" installedServices={installedServices} onNavigate={() => onOpenChange(false)} />
          <div className="h-px bg-border" />
          <NavGroup group="management" installedServices={installedServices} onNavigate={() => onOpenChange(false)} />
          <div className="h-px bg-border" />
          <NavGroup group="ops" installedServices={installedServices} onNavigate={() => onOpenChange(false)} />
          <div className="mt-auto h-px bg-border" />
          <NavGroup group="bottom" installedServices={installedServices} onNavigate={() => onOpenChange(false)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
