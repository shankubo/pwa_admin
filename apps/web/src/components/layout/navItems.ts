import type { LucideIcon } from "lucide-react";
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
} from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  group: "top" | "management" | "ops" | "bottom";
}

export const navItems: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, group: "top" },
  { to: "/docker", label: "Docker", icon: Container, group: "management" },
  { to: "/nginx", label: "Nginx", icon: Server, group: "management" },
  { to: "/sites", label: "Sites", icon: Globe, group: "management" },
  { to: "/os", label: "OS / Paquets", icon: Package, group: "management" },
  { to: "/pm2", label: "Node.js (PM2)", icon: Hexagon, group: "management" },
  { to: "/network", label: "Réseau & Sécurité", icon: Network, group: "management" },
  { to: "/applications", label: "Applications", icon: Boxes, group: "ops" },
  { to: "/backups", label: "Backups", icon: DatabaseBackup, group: "ops" },
  { to: "/system", label: "System", icon: Activity, group: "ops" },
  { to: "/help", label: "Aide", icon: HelpCircle, group: "bottom" },
  { to: "/about", label: "À propos", icon: Info, group: "bottom" },
  { to: "/settings", label: "Settings", icon: Settings, group: "bottom" },
];
