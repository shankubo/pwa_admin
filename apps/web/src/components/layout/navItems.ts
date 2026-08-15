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
  label: string;
  icon: LucideIcon;
  group: "top" | "management" | "ops" | "bottom";
  /** Hidden from the nav until /services/overview confirms this service is
   * installed on the current deployment — no point sending the admin to a
   * page that just says "not installed" (see useInstalledServices). Omitted
   * for every item that's always relevant regardless of what's installed. */
  requiresService?: ServiceName;
}

export const navItems: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, group: "top" },
  { to: "/docker", label: "Docker", icon: Container, group: "management", requiresService: "docker" },
  { to: "/nginx", label: "Nginx", icon: Server, group: "management", requiresService: "webserver" },
  { to: "/sites", label: "Sites", icon: Globe, group: "management" },
  { to: "/os", label: "OS / Paquets", icon: Package, group: "management" },
  { to: "/pm2", label: "Node.js (PM2)", icon: Hexagon, group: "management", requiresService: "pm2" },
  { to: "/network", label: "Réseau & Sécurité", icon: Network, group: "management" },
  { to: "/security", label: "Sécurité serveur", icon: ShieldCheck, group: "management" },
  { to: "/wizard", label: "Assistant", icon: Wand2, group: "ops" },
  { to: "/applications", label: "Applications", icon: Boxes, group: "ops" },
  { to: "/backups", label: "Backups", icon: DatabaseBackup, group: "ops" },
  { to: "/restore", label: "Restore", icon: RotateCcw, group: "ops" },
  { to: "/usb-explorer", label: "Disque externe USB", icon: Usb, group: "ops" },
  { to: "/system", label: "System", icon: Activity, group: "ops" },
  { to: "/services", label: "Services", icon: Wrench, group: "ops" },
  { to: "/help", label: "Aide", icon: HelpCircle, group: "bottom" },
  { to: "/about", label: "À propos", icon: Info, group: "bottom" },
  { to: "/settings", label: "Settings", icon: Settings, group: "bottom" },
  ...externalNavItems,
];
