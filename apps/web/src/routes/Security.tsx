import { useEffect, useState } from "react";
import type { SecurityOverview } from "@pwa-admin/shared";
import { useTranslation } from "react-i18next";
import { apiJson } from "@/lib/api";
import { Card, CardTitle } from "@/components/ui/Card";
import {
  ShieldCheck,
  ShieldAlert,
  ShieldBan,
  KeyRound,
  RefreshCw,
  Lock,
  Radio,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";

function StatusBadge({ ok, okLabel, badLabel }: { ok: boolean | null; okLabel: string; badLabel: string }) {
  const { t } = useTranslation("security");
  if (ok === null) {
    return <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{t("statusUnknown")}</span>;
  }
  return (
    <span
      className={
        "flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium " +
        (ok ? "bg-primary/15 text-primary" : "bg-destructive/15 text-destructive")
      }
    >
      {ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
      {ok ? okLabel : badLabel}
    </span>
  );
}

export function Security() {
  const { t } = useTranslation("security");
  const [overview, setOverview] = useState<SecurityOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function load() {
    setLoading(true);
    return apiJson<SecurityOverview>("/security/overview")
      .then(setOverview)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex items-center justify-between">
          <CardTitle className="mb-0 flex items-center gap-1">
            <ShieldCheck className="h-4 w-4" /> {t("title")}
          </CardTitle>
          <button
            onClick={load}
            disabled={loading}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-50"
            title={t("refresh")}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
        <p className="text-xs text-muted-foreground">{t("description")}</p>
      </Card>

      {error && <Card className="text-sm text-destructive">{error}</Card>}
      {!overview && !error && <Card className="text-sm text-muted-foreground">{t("loading")}</Card>}

      {overview && (
        <>
          {/* UFW */}
          <Card>
            <div className="flex items-center justify-between">
              <CardTitle className="mb-0">{t("ufw.title")}</CardTitle>
              <StatusBadge ok={overview.ufw.active} okLabel={t("statusActive")} badLabel={t("statusInactive")} />
            </div>
            {overview.ufw.installed ? (
              <>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("ufw.defaults", {
                    incoming: overview.ufw.defaultIncoming ?? "?",
                    outgoing: overview.ufw.defaultOutgoing ?? "?",
                  })}
                </p>
                <div className="mt-2 flex flex-col gap-1">
                  {overview.ufw.rules.map((r, i) => (
                    <div key={i} className="flex items-center justify-between border-b border-border/50 py-1 text-xs last:border-0">
                      <span className="font-mono">
                        {r.to} ← {r.from}
                      </span>
                      <span className="flex items-center gap-2">
                        {r.comment && <span className="text-muted-foreground">{r.comment}</span>}
                        <span
                          className={
                            "rounded-full px-2 py-0.5 text-[10px] font-medium " +
                            (r.action === "ALLOW"
                              ? "bg-primary/15 text-primary"
                              : "bg-destructive/15 text-destructive")
                          }
                        >
                          {r.action}
                        </span>
                      </span>
                    </div>
                  ))}
                  {overview.ufw.rules.length === 0 && (
                    <p className="text-xs text-muted-foreground">{t("ufw.noRules")}</p>
                  )}
                </div>
              </>
            ) : (
              <p className="mt-1 text-xs text-destructive">{t("ufw.notInstalled")}</p>
            )}
          </Card>

          {/* fail2ban */}
          <Card>
            <div className="flex items-center justify-between">
              <CardTitle className="mb-0 flex items-center gap-1">
                <ShieldBan className="h-4 w-4" /> {t("fail2ban.title")}
              </CardTitle>
              <StatusBadge
                ok={overview.fail2ban.installed && overview.fail2ban.active}
                okLabel={t("statusActive")}
                badLabel={t("statusInactive")}
              />
            </div>
            {overview.fail2ban.installed ? (
              <div className="mt-2 flex flex-col gap-1">
                {overview.fail2ban.jails.map((j) => (
                  <div key={j.name} className="flex items-center justify-between border-b border-border/50 py-1 text-xs last:border-0">
                    <span className="font-mono">{j.name}</span>
                    <span className="text-muted-foreground">
                      {t("fail2ban.jailStats", { banned: j.currentlyBanned, total: j.totalBanned })}
                    </span>
                  </div>
                ))}
                {overview.fail2ban.jails.length === 0 && (
                  <p className="text-xs text-muted-foreground">{t("fail2ban.noJails")}</p>
                )}
              </div>
            ) : (
              <p className="mt-1 text-xs text-destructive">{t("fail2ban.notInstalled")}</p>
            )}
          </Card>

          {/* SSH */}
          <Card>
            <div className="flex items-center justify-between">
              <CardTitle className="mb-0 flex items-center gap-1">
                <KeyRound className="h-4 w-4" /> {t("ssh.title")}
              </CardTitle>
              <StatusBadge ok={overview.ssh.active} okLabel={t("statusActive")} badLabel={t("statusInactive")} />
            </div>
            <div className="mt-2 flex flex-col gap-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t("ssh.port")}</span>
                <span className="font-mono">{overview.ssh.port ?? 22}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t("ssh.rootLogin")}</span>
                <StatusBadge
                  ok={overview.ssh.rootLoginPermitted === null ? null : !overview.ssh.rootLoginPermitted}
                  okLabel={t("ssh.rootLoginDisabled")}
                  badLabel={t("ssh.rootLoginEnabled")}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t("ssh.passwordAuth")}</span>
                <StatusBadge
                  ok={overview.ssh.passwordAuthEnabled === null ? null : !overview.ssh.passwordAuthEnabled}
                  okLabel={t("ssh.passwordAuthDisabled")}
                  badLabel={t("ssh.passwordAuthEnabled")}
                />
              </div>
              {overview.ssh.maxAuthTries != null && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t("ssh.maxAuthTries")}</span>
                  <span className="font-mono">{overview.ssh.maxAuthTries}</span>
                </div>
              )}
            </div>
          </Card>

          {/* Tailscale */}
          <Card>
            <div className="flex items-center justify-between">
              <CardTitle className="mb-0 flex items-center gap-1">
                <Radio className="h-4 w-4" /> {t("tailscale.title")}
              </CardTitle>
              <StatusBadge ok={overview.tailscale.running} okLabel={t("tailscale.connected")} badLabel={t("tailscale.disconnected")} />
            </div>
            {overview.tailscale.installed ? (
              <div className="mt-2 flex flex-col gap-1 text-xs">
                {overview.tailscale.hostname && (
                  <p className="text-muted-foreground">{t("tailscale.host", { hostname: overview.tailscale.hostname })}</p>
                )}
                {overview.tailscale.tailnetName && (
                  <p className="text-muted-foreground">{t("tailscale.tailnet", { name: overview.tailscale.tailnetName })}</p>
                )}
                {overview.tailscale.tailscaleIps.map((ip) => (
                  <p key={ip} className="font-mono text-muted-foreground">{ip}</p>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-xs text-destructive">{t("tailscale.notInstalled")}</p>
            )}
          </Card>

          {/* unattended-upgrades */}
          <Card>
            <div className="flex items-center justify-between">
              <CardTitle className="mb-0">{t("unattendedUpgrades.title")}</CardTitle>
              <StatusBadge
                ok={overview.unattendedUpgrades.installed && overview.unattendedUpgrades.timerActive}
                okLabel={t("statusActive")}
                badLabel={t("statusInactive")}
              />
            </div>
            <div className="mt-2 flex flex-col gap-1 text-xs">
              {overview.unattendedUpgrades.lastRunAt && (
                <p className="text-muted-foreground">
                  {t("unattendedUpgrades.lastRun", { date: new Date(overview.unattendedUpgrades.lastRunAt).toLocaleString() })}
                </p>
              )}
              {overview.unattendedUpgrades.lastRunPackages.length > 0 && (
                <p className="text-muted-foreground">
                  {t("unattendedUpgrades.lastRunPackages", { packages: overview.unattendedUpgrades.lastRunPackages.join(", ") })}
                </p>
              )}
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t("unattendedUpgrades.pendingSecurity")}</span>
                <span className={overview.unattendedUpgrades.pendingSecurityUpdates > 0 ? "font-medium text-warning" : "font-mono"}>
                  {overview.unattendedUpgrades.pendingSecurityUpdates}
                </span>
              </div>
            </div>
          </Card>

          {/* TLS */}
          <Card>
            <div className="flex items-center justify-between">
              <CardTitle className="mb-0 flex items-center gap-1">
                <Lock className="h-4 w-4" /> {t("tls.title")}
              </CardTitle>
              <StatusBadge ok={overview.appTls.found} okLabel={t("tls.present")} badLabel={t("tls.absent")} />
            </div>
            {overview.appTls.found ? (
              <div className="mt-2 flex flex-col gap-1 text-xs">
                {overview.appTls.subject && <p className="text-muted-foreground">{overview.appTls.subject}</p>}
                {overview.appTls.daysRemaining != null && (
                  <p className={overview.appTls.daysRemaining < 30 ? "font-medium text-warning" : "text-muted-foreground"}>
                    {t("tls.expiresIn", { days: overview.appTls.daysRemaining })}
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-1 text-xs text-destructive">{t("tls.notConfigured")}</p>
            )}
          </Card>

          {/* App auth: JWT + 2FA */}
          <Card>
            <div className="flex items-center justify-between">
              <CardTitle className="mb-0 flex items-center gap-1">
                <ShieldAlert className="h-4 w-4" /> {t("appAuth.title")}
              </CardTitle>
            </div>
            <div className="mt-2 flex flex-col gap-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t("appAuth.twoFactorAccounts")}</span>
                <span className="font-mono">
                  {overview.appAuth.usersWithTwoFactor} / {overview.appAuth.totalUsers}
                </span>
              </div>
              {overview.appAuth.usersWithTwoFactor < overview.appAuth.totalUsers && (
                <p className="flex items-center gap-1 text-warning">
                  <AlertTriangle className="h-3.5 w-3.5" /> {t("appAuth.twoFactorWarning")}
                </p>
              )}
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t("appAuth.jwtTtl")}</span>
                <span className="font-mono">{overview.appAuth.jwtAccessTtl ?? "?"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t("appAuth.rateLimit")}</span>
                <StatusBadge ok={overview.appAuth.rateLimitEnabled} okLabel={t("appAuth.rateLimitEnabled")} badLabel={t("appAuth.rateLimitDisabled")} />
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
