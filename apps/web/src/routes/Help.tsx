import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardTitle } from "@/components/ui/Card";
import {
  HelpCircle,
  LayoutDashboard,
  Container,
  Server,
  Globe,
  Package,
  Hexagon,
  Network,
  Boxes,
  DatabaseBackup,
  RotateCcw,
  Wrench,
  Activity,
  Settings as SettingsIcon,
  ChevronDown,
  ChevronUp,
  Terminal,
  CheckCircle2,
} from "lucide-react";

interface HelpSection {
  icon: typeof LayoutDashboard;
  title: string;
  slug: string;
}

const SECTIONS: HelpSection[] = [
  { icon: LayoutDashboard, title: "Dashboard", slug: "dashboard" },
  { icon: Container, title: "Docker", slug: "docker" },
  { icon: Server, title: "Nginx", slug: "nginx" },
  { icon: Globe, title: "Sites", slug: "sites" },
  { icon: Package, title: "OS / Paquets", slug: "os" },
  { icon: Hexagon, title: "Node.js (PM2)", slug: "pm2" },
  { icon: Network, title: "Réseau & Sécurité", slug: "network" },
  { icon: Boxes, title: "Applications", slug: "applications" },
  { icon: DatabaseBackup, title: "Backups", slug: "backups" },
  { icon: RotateCcw, title: "Restore", slug: "restore" },
  { icon: Activity, title: "System", slug: "system" },
  { icon: Wrench, title: "Services", slug: "services" },
  { icon: SettingsIcon, title: "Settings", slug: "settings" },
];

interface Dependency {
  slug: string;
  checkCommand: string;
}

const DEPENDENCIES: Dependency[] = [
  { slug: "docker", checkCommand: "docker --version" },
  { slug: "nginx", checkCommand: "nginx -v" },
  { slug: "systemd", checkCommand: "systemctl --version" },
  { slug: "sudo", checkCommand: "sudo -l" },
  { slug: "fail2ban", checkCommand: "fail2ban-client --version" },
  { slug: "vcgencmd", checkCommand: "vcgencmd version" },
  { slug: "networkmanager", checkCommand: "nmcli --version" },
  { slug: "openssh", checkCommand: "sshd -V" },
  { slug: "pm2", checkCommand: "pm2 --version" },
  { slug: "database", checkCommand: "systemctl status mariadb" },
  { slug: "rsync", checkCommand: "rsync --version" },
  { slug: "tailscale", checkCommand: "tailscale version" },
];

function HelpSectionCard({ section }: { section: HelpSection }) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation("help");
  const details = t(`sections.${section.slug}.details`, { returnObjects: true }) as string[];
  return (
    <Card>
      <button
        className="flex w-full items-center justify-between gap-2 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
            <section.icon className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-medium">{section.title}</p>
            <p className="text-xs text-muted-foreground">{t(`sections.${section.slug}.summary`)}</p>
          </div>
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </button>
      {open && (
        <ul className="mt-3 flex flex-col gap-1.5 border-t border-border pt-3">
          {details.map((d, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <span>{d}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function Help() {
  const { t } = useTranslation("help");
  const tips = t("tips", { returnObjects: true }) as string[];
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardTitle className="flex items-center gap-1">
          <HelpCircle className="h-4 w-4" /> {t("intro.title")}
        </CardTitle>
        <p className="text-xs font-medium text-primary">{t("intro.tagline")}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t("intro.description")}</p>
      </Card>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{t("menusHeading")}</h2>
        <div className="flex flex-col gap-2">
          {SECTIONS.map((s) => (
            <HelpSectionCard key={s.title} section={s} />
          ))}
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{t("tipsHeading")}</h2>
        <Card>
          <ul className="flex flex-col gap-1.5">
            {tips.map((tip, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div>
        <h2 className="mb-2 flex items-center gap-1 text-sm font-semibold text-muted-foreground">
          <Terminal className="h-4 w-4" /> {t("dependenciesHeading")}
        </h2>
        <Card className="mb-2 text-xs text-muted-foreground">{t("dependenciesIntro")}</Card>
        <div className="flex flex-col gap-2">
          {DEPENDENCIES.map((dep) => (
            <Card key={dep.slug}>
              <p className="text-sm font-medium">{t(`dependencies.${dep.slug}.name`)}</p>
              <p className="text-xs text-muted-foreground">{t(`dependencies.${dep.slug}.purpose`)}</p>
              <code className="mt-1 block w-fit rounded bg-muted px-2 py-1 text-[11px] text-foreground">
                {dep.checkCommand}
              </code>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
