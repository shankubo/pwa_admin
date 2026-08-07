export interface UfwRule {
  action: "ALLOW" | "DENY" | "REJECT" | "LIMIT";
  direction: "IN" | "OUT";
  to: string;
  from: string;
  comment: string | null;
}

export interface UfwStatus {
  installed: boolean;
  active: boolean;
  defaultIncoming: string | null;
  defaultOutgoing: string | null;
  rules: UfwRule[];
}

export interface Fail2banOverviewJail {
  name: string;
  currentlyFailed: number;
  totalFailed: number;
  currentlyBanned: number;
  totalBanned: number;
}

export interface Fail2banOverview {
  installed: boolean;
  active: boolean;
  jails: Fail2banOverviewJail[];
}

export interface SshSecurityStatus {
  active: boolean;
  enabled: boolean;
  port: number | null;
  passwordAuthEnabled: boolean | null;
  rootLoginPermitted: boolean | null;
  maxAuthTries: number | null;
}

export interface TailscaleStatus {
  installed: boolean;
  running: boolean;
  loggedIn: boolean;
  hostname: string | null;
  tailscaleIps: string[];
  tailnetName: string | null;
}

export interface UnattendedUpgradesStatus {
  installed: boolean;
  timerActive: boolean;
  automaticRebootEnabled: boolean | null;
  lastRunAt: string | null;
  lastRunPackages: string[];
  pendingSecurityUpdates: number;
}

export interface TlsCertInfo {
  found: boolean;
  subject: string | null;
  notAfter: string | null;
  daysRemaining: number | null;
  source: string;
}

export interface AppAuthSecurity {
  totalUsers: number;
  usersWithTwoFactor: number;
  jwtAccessTtl: string | null;
  jwtSecretConfigured: boolean;
  rateLimitEnabled: boolean;
}

export interface SecurityOverview {
  ufw: UfwStatus;
  fail2ban: Fail2banOverview;
  ssh: SshSecurityStatus;
  tailscale: TailscaleStatus;
  unattendedUpgrades: UnattendedUpgradesStatus;
  appTls: TlsCertInfo;
  appAuth: AppAuthSecurity;
}
