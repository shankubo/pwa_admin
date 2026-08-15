import type { LucideIcon } from "lucide-react";
import type { ServiceName } from "@pwa-admin/shared";
import {
  LayoutDashboard,
  Container,
  Globe,
  Server,
  Network,
  Package,
  DatabaseBackup,
  Activity,
  Settings,
  Boxes,
  Hexagon,
  HelpCircle,
  Info,
  ShieldCheck,
  RotateCcw,
  Wrench,
  Usb,
  Wand2,
} from "lucide-react";
import { externalNavItems } from "./externalNavItems";

export interface NavItem {
  to: string;
  /** Clé de traduction dans le namespace "nav" (ex: "dashboard" → nav:dashboard). */
  labelKey: string;
  icon: LucideIcon;
  group: "top" | "management" | "ops" | "bottom";
  /** Hidden from the nav until /services/overview confirms this service is
   * installed on the current deployment — no point sending the admin to a
   * page that just says "not installed" (see useInstalledServices). Omitted
   * for every item that's always relevant regardless of what's installed. */
  requiresService?: ServiceName;
}

export const navItems: NavItem[] = [
  { to: "/", labelKey: "dashboard", icon: LayoutDashboard, group: "top" },
  { to: "/docker", labelKey: "docker", icon: Container, group: "management", requiresService: "docker" },
  { to: "/nginx", labelKey: "nginx", icon: Server, group: "management", requiresService: "webserver" },
  { to: "/sites", labelKey: "sites", icon: Globe, group: "management" },
  { to: "/os", labelKey: "os", icon: Package, group: "management" },
  { to: "/pm2", labelKey: "pm2", icon: Hexagon, group: "management", requiresService: "pm2" },
  { to: "/network", labelKey: "network", icon: Network, group: "management" },
  { to: "/security", labelKey: "security", icon: ShieldCheck, group: "management" },
  { to: "/wizard", labelKey: "wizard", icon: Wand2, group: "ops" },
  { to: "/applications", labelKey: "applications", icon: Boxes, group: "ops" },
  { to: "/backups", labelKey: "backups", icon: DatabaseBackup, group: "ops" },
  { to: "/restore", labelKey: "restore", icon: RotateCcw, group: "ops" },
  { to: "/usb-explorer", labelKey: "usbExplorer", icon: Usb, group: "ops" },
  { to: "/system", labelKey: "system", icon: Activity, group: "ops" },
  { to: "/services", labelKey: "services", icon: Wrench, group: "ops" },
  { to: "/help", labelKey: "help", icon: HelpCircle, group: "bottom" },
  { to: "/about", labelKey: "about", icon: Info, group: "bottom" },
  { to: "/settings", labelKey: "settings", icon: Settings, group: "bottom" },
  ...externalNavItems,
];
