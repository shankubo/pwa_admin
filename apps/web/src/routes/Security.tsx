import { useEffect, useState } from "react";
import type { SecurityOverview } from "@pwa-admin-pi/shared";
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
  if (ok === null) {
    return <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">inconnu</span>;
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
            <ShieldCheck className="h-4 w-4" /> Sécurité du serveur
          </CardTitle>
          <button
            onClick={load}
            disabled={loading}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-50"
            title="Actualiser"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          État en direct des mécanismes de protection du Raspberry Pi et de l'application.
        </p>
      </Card>

      {error && <Card className="text-sm text-destructive">{error}</Card>}
      {!overview && !error && <Card className="text-sm text-muted-foreground">Chargement…</Card>}

      {overview && (
        <>
          {/* UFW */}
          <Card>
            <div className="flex items-center justify-between">
              <CardTitle className="mb-0">Pare-feu (UFW)</CardTitle>
              <StatusBadge ok={overview.ufw.active} okLabel="actif" badLabel="inactif" />
            </div>
            {overview.ufw.installed ? (
              <>
                <p className="mt-1 text-xs text-muted-foreground">
                  Par défaut : entrant <span className="font-mono">{overview.ufw.defaultIncoming ?? "?"}</span>, sortant{" "}
                  <span className="font-mono">{overview.ufw.defaultOutgoing ?? "?"}</span>
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
                    <p className="text-xs text-muted-foreground">Aucune règle explicite.</p>
                  )}
                </div>
              </>
            ) : (
              <p className="mt-1 text-xs text-destructive">UFW non installé — le serveur n'a pas de pare-feu applicatif.</p>
            )}
          </Card>

          {/* fail2ban */}
          <Card>
            <div className="flex items-center justify-between">
              <CardTitle className="mb-0 flex items-center gap-1">
                <ShieldBan className="h-4 w-4" /> fail2ban
              </CardTitle>
              <StatusBadge ok={overview.fail2ban.installed && overview.fail2ban.active} okLabel="actif" badLabel="inactif" />
            </div>
            {overview.fail2ban.installed ? (
              <div className="mt-2 flex flex-col gap-1">
                {overview.fail2ban.jails.map((j) => (
                  <div key={j.name} className="flex items-center justify-between border-b border-border/50 py-1 text-xs last:border-0">
                    <span className="font-mono">{j.name}</span>
                    <span className="text-muted-foreground">
                      {j.currentlyBanned} banni(s) actuellement · {j.totalBanned} au total
                    </span>
                  </div>
                ))}
                {overview.fail2ban.jails.length === 0 && (
                  <p className="text-xs text-muted-foreground">Aucune jail configurée.</p>
                )}
              </div>
            ) : (
              <p className="mt-1 text-xs text-destructive">fail2ban non installé — pas de protection anti brute-force.</p>
            )}
          </Card>

          {/* SSH */}
          <Card>
            <div className="flex items-center justify-between">
              <CardTitle className="mb-0 flex items-center gap-1">
                <KeyRound className="h-4 w-4" /> SSH
              </CardTitle>
              <StatusBadge ok={overview.ssh.active} okLabel="actif" badLabel="inactif" />
            </div>
            <div className="mt-2 flex flex-col gap-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Port</span>
                <span className="font-mono">{overview.ssh.port ?? 22}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Connexion root</span>
                <StatusBadge ok={overview.ssh.rootLoginPermitted === null ? null : !overview.ssh.rootLoginPermitted} okLabel="désactivée" badLabel="autorisée" />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Authentification par mot de passe</span>
                <StatusBadge ok={overview.ssh.passwordAuthEnabled === null ? null : !overview.ssh.passwordAuthEnabled} okLabel="désactivée (clé)" badLabel="activée" />
              </div>
              {overview.ssh.maxAuthTries != null && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Tentatives max</span>
                  <span className="font-mono">{overview.ssh.maxAuthTries}</span>
                </div>
              )}
            </div>
          </Card>

          {/* Tailscale */}
          <Card>
            <div className="flex items-center justify-between">
              <CardTitle className="mb-0 flex items-center gap-1">
                <Radio className="h-4 w-4" /> Tailscale
              </CardTitle>
              <StatusBadge ok={overview.tailscale.running} okLabel="connecté" badLabel="déconnecté" />
            </div>
            {overview.tailscale.installed ? (
              <div className="mt-2 flex flex-col gap-1 text-xs">
                {overview.tailscale.hostname && (
                  <p className="text-muted-foreground">Hôte : {overview.tailscale.hostname}</p>
                )}
                {overview.tailscale.tailnetName && (
                  <p className="text-muted-foreground">Tailnet : {overview.tailscale.tailnetName}</p>
                )}
                {overview.tailscale.tailscaleIps.map((ip) => (
                  <p key={ip} className="font-mono text-muted-foreground">{ip}</p>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-xs text-destructive">
                Tailscale non installé — vérifier que l'accès n'est pas exposé publiquement.
              </p>
            )}
          </Card>

          {/* unattended-upgrades */}
          <Card>
            <div className="flex items-center justify-between">
              <CardTitle className="mb-0">Mises à jour automatiques</CardTitle>
              <StatusBadge ok={overview.unattendedUpgrades.installed && overview.unattendedUpgrades.timerActive} okLabel="actif" badLabel="inactif" />
            </div>
            <div className="mt-2 flex flex-col gap-1 text-xs">
              {overview.unattendedUpgrades.lastRunAt && (
                <p className="text-muted-foreground">
                  Dernière exécution : {new Date(overview.unattendedUpgrades.lastRunAt).toLocaleString()}
                </p>
              )}
              {overview.unattendedUpgrades.lastRunPackages.length > 0 && (
                <p className="text-muted-foreground">
                  Paquets mis à jour : {overview.unattendedUpgrades.lastRunPackages.join(", ")}
                </p>
              )}
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Mises à jour de sécurité en attente</span>
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
                <Lock className="h-4 w-4" /> TLS (app)
              </CardTitle>
              <StatusBadge ok={overview.appTls.found} okLabel="présent" badLabel="absent" />
            </div>
            {overview.appTls.found ? (
              <div className="mt-2 flex flex-col gap-1 text-xs">
                {overview.appTls.subject && <p className="text-muted-foreground">{overview.appTls.subject}</p>}
                {overview.appTls.daysRemaining != null && (
                  <p className={overview.appTls.daysRemaining < 30 ? "font-medium text-warning" : "text-muted-foreground"}>
                    Expire dans {overview.appTls.daysRemaining} jours
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-1 text-xs text-destructive">
                Pas de certificat TLS configuré — l'app tourne peut-être en HTTP non chiffré.
              </p>
            )}
          </Card>

          {/* App auth: JWT + 2FA */}
          <Card>
            <div className="flex items-center justify-between">
              <CardTitle className="mb-0 flex items-center gap-1">
                <ShieldAlert className="h-4 w-4" /> Authentification de l'app (JWT + 2FA)
              </CardTitle>
            </div>
            <div className="mt-2 flex flex-col gap-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Comptes avec 2FA activée</span>
                <span className="font-mono">
                  {overview.appAuth.usersWithTwoFactor} / {overview.appAuth.totalUsers}
                </span>
              </div>
              {overview.appAuth.usersWithTwoFactor < overview.appAuth.totalUsers && (
                <p className="flex items-center gap-1 text-warning">
                  <AlertTriangle className="h-3.5 w-3.5" /> Au moins un compte n'a pas activé la 2FA — recommandé
                  pour tous les administrateurs (voir Settings).
                </p>
              )}
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Durée de vie du token d'accès</span>
                <span className="font-mono">{overview.appAuth.jwtAccessTtl ?? "?"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Rate limiting sur la connexion</span>
                <StatusBadge ok={overview.appAuth.rateLimitEnabled} okLabel="activé" badLabel="désactivé" />
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
