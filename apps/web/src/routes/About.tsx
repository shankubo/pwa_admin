import { useTranslation } from "react-i18next";
import { Card, CardTitle } from "@/components/ui/Card";
import { APP_VERSION } from "@/lib/appVersion";
import {
  Info,
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
  ShieldCheck,
  Cpu,
  Cloud,
  Layers,
  User,
} from "lucide-react";

const DEVELOPER = "Shan.K";

const MODULES: { icon: typeof LayoutDashboard; title: string; slug: string }[] = [
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

export function About() {
  const { t } = useTranslation("about");
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Cpu className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Server Admin PWA</h1>
            <p className="text-xs font-medium text-primary">{t("tagline")}</p>
            <p className="text-xs text-muted-foreground">{t("version", { version: APP_VERSION })}</p>
          </div>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">{t("description")}</p>
      </Card>

      <Card>
        <CardTitle className="flex items-center gap-1">
          <User className="h-4 w-4" /> {t("developerHeading")}
        </CardTitle>
        <p className="text-sm font-medium">{DEVELOPER}</p>
      </Card>

      <Card>
        <CardTitle className="flex items-center gap-1">
          <Layers className="h-4 w-4" /> {t("structureHeading")}
        </CardTitle>
        <div className="flex flex-col gap-2 text-sm">
          <div>
            <p className="font-medium">{t("structure.api.title")}</p>
            <p className="text-xs text-muted-foreground">{t("structure.api.description")}</p>
          </div>
          <div>
            <p className="font-medium">{t("structure.web.title")}</p>
            <p className="text-xs text-muted-foreground">{t("structure.web.description")}</p>
          </div>
          <div>
            <p className="font-medium">{t("structure.shared.title")}</p>
            <p className="text-xs text-muted-foreground">{t("structure.shared.description")}</p>
          </div>
          <div>
            <p className="font-medium">{t("structure.deploy.title")}</p>
            <p className="text-xs text-muted-foreground">{t("structure.deploy.description")}</p>
          </div>
        </div>
      </Card>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{t("modulesHeading")}</h2>
        <div className="flex flex-col gap-2">
          {MODULES.map((m) => (
            <Card key={m.title} className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
                <m.icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium">{m.title}</p>
                <p className="text-xs text-muted-foreground">{t(`modules.${m.slug}`)}</p>
              </div>
            </Card>
          ))}
        </div>
      </div>

      <Card>
        <CardTitle className="flex items-center gap-1">
          <ShieldCheck className="h-4 w-4" /> {t("securityHeading")}
        </CardTitle>
        <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
          {(t("security", { returnObjects: true }) as string[]).map((item, i) => (
            <li key={i}>• {item}</li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardTitle className="flex items-center gap-1">
          <Cloud className="h-4 w-4" /> {t("storageHeading")}
        </CardTitle>
        <p className="text-xs text-muted-foreground">{t("storageDescription")}</p>
      </Card>

      <div className="flex items-center justify-center gap-1 py-2 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5" /> Server Admin PWA {APP_VERSION} — {DEVELOPER}
      </div>
    </div>
  );
}
