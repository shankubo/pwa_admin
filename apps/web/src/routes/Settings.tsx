import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type {
  AccessTokenSummary,
  AppUpdateStatus,
  CreateAccessTokenResponse,
  CurrentUser,
} from "@pwa-admin/shared";
import { apiFetch, apiJson } from "@/lib/api";
import { useAuthStore } from "@/stores/auth.store";
import { Card, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { LanguageSwitcher } from "@/components/layout/LanguageSwitcher";
import {
  ShieldCheck,
  ShieldOff,
  LogOut,
  KeyRound,
  Trash2,
  RefreshCw,
  DownloadCloud,
  ChevronDown,
  ChevronUp,
  Cloud,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { APP_VERSION } from "@/lib/appVersion";

// No shared type exists for audit log rows — these are raw sqlite columns (snake_case).
interface AuditLogRow {
  id: number;
  user_id: number | null;
  action: string;
  target: string | null;
  result: "success" | "failure";
  source_ip: string | null;
  detail: string | null;
  created_at: string;
}

const PAGE_SIZE = 25;

export function Settings() {
  const navigate = useNavigate();
  const clearSession = useAuthStore((s) => s.clearSession);
  const [user, setUser] = useState<CurrentUser | null>(null);

  useEffect(() => {
    apiJson<CurrentUser>("/auth/me")
      .then(setUser)
      .catch(() => {});
  }, []);

  async function logout() {
    await apiFetch("/auth/logout", { method: "POST" }).catch(() => {});
    clearSession();
    navigate("/login");
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardTitle>Compte</CardTitle>
        {user ? (
          <div className="text-sm">
            <p className="font-medium">{user.username}</p>
            <p className="text-xs text-muted-foreground">
              2FA : {user.twoFactorEnabled ? "activée" : "désactivée"}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        )}
      </Card>

      <LanguageSwitcher />

      {user && !user.twoFactorEnabled && (
        <TwoFactorEnrollCard onEnrolled={() => setUser({ ...user, twoFactorEnabled: true })} />
      )}

      {user && user.twoFactorEnabled && (
        <TwoFactorDisableCard onDisabled={() => setUser({ ...user, twoFactorEnabled: false })} />
      )}

      <AccessTokensCard />

      <GDriveConfigCard />

      <GDriveConnectionCard />

      <AuditLogCard />

      <AppUpdateCard />

      <Button variant="destructive" onClick={logout}>
        <LogOut className="h-4 w-4" /> Se déconnecter
      </Button>
    </div>
  );
}

function AppUpdateCard() {
  const [clearing, setClearing] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<AppUpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  useEffect(() => stopPolling, []);

  // The final step of deploy/auto-update.sh is `sudo systemctl restart
  // pwa-admin`, which kills this very request mid-flight along with every
  // other in-flight connection — so failed polls while a check is running
  // are expected, not an error state, and must not stop the poll loop.
  async function pollStatus() {
    try {
      const status = await apiJson<AppUpdateStatus>("/app-update/status");
      setUpdateStatus(status);
      if (status.status !== "running") {
        stopPolling();
        setChecking(false);
      }
    } catch {
      // Service likely mid-restart — keep polling silently.
    }
  }

  async function checkForUpdate() {
    setChecking(true);
    try {
      const status = await apiJson<AppUpdateStatus>("/app-update/check", { method: "POST" });
      setUpdateStatus(status);
    } catch {
      // Still start polling — the check may have started successfully server-side
      // even if this response was lost to the restart.
    }
    stopPolling();
    pollRef.current = setInterval(pollStatus, 3000);
  }

  // Full reset for cases the update banner can't fix on its own (e.g. iOS
  // where the service worker may not have woken up in a long time and no
  // "new version" event has fired at all yet): unregister every service
  // worker, wipe every Cache Storage entry, then hard-reload — the same end
  // state as manually clearing site data in browser settings, but reachable
  // from inside the app.
  async function forceFullUpdate() {
    setClearing(true);
    try {
      const registrations = await navigator.serviceWorker?.getRegistrations();
      await Promise.all((registrations ?? []).map((r) => r.unregister()));
      const cacheKeys = await caches?.keys();
      await Promise.all((cacheKeys ?? []).map((k) => caches.delete(k)));
    } finally {
      window.location.reload();
    }
  }

  const updateStatusLabel: Record<NonNullable<AppUpdateStatus>["status"], string> = {
    idle: "",
    running: "Vérification et déploiement en cours…",
    up_to_date: "Déjà à jour.",
    succeeded: `Déployé : ${updateStatus?.deployedCommit ?? ""} — rechargez la page.`,
    failed: "Échec — voir le journal ci-dessous.",
  };

  return (
    <Card>
      <CardTitle>Application</CardTitle>
      <p className="text-xs text-muted-foreground">{APP_VERSION}</p>

      <Button size="sm" variant="outline" className="mt-2" disabled={checking} onClick={checkForUpdate}>
        <DownloadCloud className="h-3.5 w-3.5" />
        {checking ? "Vérification…" : "Vérifier les mises à jour"}
      </Button>
      {updateStatus && updateStatus.status !== "idle" && (
        <p
          className={`mt-1 text-xs ${updateStatus.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}
        >
          {updateStatusLabel[updateStatus.status]}
        </p>
      )}
      {updateStatus?.status === "failed" && updateStatus.log && (
        <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted p-2 text-xs">{updateStatus.log}</pre>
      )}

      <p className="mt-2 text-xs text-muted-foreground">
        Si l'application semble bloquée sur une ancienne version malgré le bandeau de mise à jour (fréquent sur
        iOS, qui réveille rarement le service worker de son propre chef), ce bouton force un nettoyage complet du
        cache et recharge l'application.
      </p>
      <Button size="sm" variant="outline" className="mt-2" disabled={clearing} onClick={forceFullUpdate}>
        <RefreshCw className="h-3.5 w-3.5" /> {clearing ? "Nettoyage…" : "Forcer la mise à jour complète"}
      </Button>
    </Card>
  );
}

function TwoFactorEnrollCard({ onEnrolled }: { onEnrolled: () => void }) {
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [enrolling, setEnrolling] = useState(false);

  async function startEnrollment() {
    setEnrolling(true);
    setError(null);
    try {
      const data = await apiJson<{ secret: string; qrCodeDataUrl: string }>("/auth/2fa/enroll", {
        method: "POST",
      });
      setQrCodeDataUrl(data.qrCodeDataUrl);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnrolling(false);
    }
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiJson("/auth/2fa/enroll/confirm", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      onEnrolled();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardTitle className="flex items-center gap-1">
        <ShieldCheck className="h-4 w-4" /> Activer la 2FA
      </CardTitle>

      {!qrCodeDataUrl ? (
        <Button size="sm" disabled={enrolling} onClick={startEnrollment}>
          {enrolling ? "…" : "Démarrer l'inscription"}
        </Button>
      ) : (
        <form onSubmit={confirm} className="flex flex-col items-center gap-3">
          <img src={qrCodeDataUrl} alt="QR code 2FA" className="h-40 w-40 rounded-md border border-border" />
          <p className="text-center text-xs text-muted-foreground">
            Scannez ce QR code avec votre application d'authentification, puis entrez le code généré.
          </p>
          <input
            type="text"
            inputMode="numeric"
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={6}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-center text-lg tracking-widest outline-none focus:ring-2 focus:ring-primary"
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button type="submit" size="sm" disabled={submitting} className="w-full">
            {submitting ? "Vérification…" : "Confirmer"}
          </Button>
        </form>
      )}
    </Card>
  );
}

function TwoFactorDisableCard({ onDisabled }: { onDisabled: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiJson("/auth/2fa/disable", {
        method: "POST",
        body: JSON.stringify({ password, code }),
      });
      onDisabled();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardTitle className="flex items-center gap-1">
        <ShieldOff className="h-4 w-4" /> Désactiver la 2FA
      </CardTitle>

      {!expanded ? (
        <Button size="sm" variant="destructive" onClick={() => setExpanded(true)}>
          Désactiver
        </Button>
      ) : (
        <form onSubmit={confirm} className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            Confirmez votre mot de passe et un code de votre application d'authentification.
          </p>
          <input
            type="password"
            placeholder="Mot de passe"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
          />
          <input
            type="text"
            inputMode="numeric"
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={6}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-center text-lg tracking-widest outline-none focus:ring-2 focus:ring-primary"
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button type="submit" size="sm" variant="destructive" disabled={submitting} className="w-full">
            {submitting ? "Vérification…" : "Confirmer la désactivation"}
          </Button>
        </form>
      )}
    </Card>
  );
}

function AccessTokensCard() {
  const [tokens, setTokens] = useState<AccessTokenSummary[]>([]);
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newToken, setNewToken] = useState<CreateAccessTokenResponse | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function load() {
    try {
      setTokens(await apiJson<AccessTokenSummary[]>("/auth/tokens"));
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const created = await apiJson<CreateAccessTokenResponse>("/auth/tokens", {
        method: "POST",
        body: JSON.stringify({ label }),
      });
      setNewToken(created);
      setLabel("");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: number) {
    await apiFetch(`/auth/tokens/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <Card>
      <CardTitle className="flex items-center gap-1">
        <KeyRound className="h-4 w-4" /> Jetons d'accès
      </CardTitle>
      <p className="text-xs text-muted-foreground">
        Permet de se connecter depuis un autre appareil sans mot de passe, via "Connexion par jeton" sur l'écran de
        connexion. Réservé à des appareils de confiance déjà sur le tailnet.
      </p>

      {newToken && (
        <div className="rounded-md border border-primary/50 bg-primary/5 p-3 text-xs">
          <p className="mb-1 font-medium">
            Jeton créé pour « {newToken.label} » — copiez-le maintenant, il ne sera plus affiché :
          </p>
          <code className="block break-all rounded bg-background p-2">{newToken.token}</code>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => setNewToken(null)}>
            J'ai copié le jeton
          </Button>
        </div>
      )}

      <form onSubmit={create} className="flex gap-2">
        <input
          type="text"
          placeholder="Nom de l'appareil (ex. iPhone Shan)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
          required
        />
        <Button type="submit" size="sm" disabled={creating}>
          {creating ? "…" : "Générer"}
        </Button>
      </form>
      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex flex-col gap-1">
        {tokens.map((t) => (
          <div key={t.id} className="flex items-center justify-between border-b border-border/50 py-1.5 text-xs last:border-0">
            <div>
              <p className="font-medium">{t.label}</p>
              <p className="text-muted-foreground">
                Créé le {new Date(t.createdAt).toLocaleDateString()}
                {t.lastUsedAt ? ` · utilisé le ${new Date(t.lastUsedAt).toLocaleDateString()}` : " · jamais utilisé"}
              </p>
            </div>
            <ConfirmDialog
              trigger={
                <Button size="sm" variant="ghost">
                  <Trash2 className="h-4 w-4" />
                </Button>
              }
              title="Révoquer ce jeton ?"
              description={`L'appareil « ${t.label} » ne pourra plus se connecter avec ce jeton.`}
              confirmLabel="Révoquer"
              onConfirm={() => revoke(t.id)}
            />
          </div>
        ))}
        {loaded && tokens.length === 0 && <p className="text-sm text-muted-foreground">Aucun jeton actif.</p>}
      </div>
    </Card>
  );
}

interface GDriveEnvConfig {
  enabled: boolean;
  clientId: string;
  clientSecretSet: boolean;
  rootFolderId: string;
}

/**
 * Édite directement les clés GDRIVE_* de .env (activer/désactiver,
 * client_id/client_secret OAuth, dossier racine) — jusqu'ici uniquement
 * modifiable à la main via SSH. Le secret n'est jamais renvoyé au
 * navigateur (seulement "défini ou non"), et une modification ne prend
 * effet qu'après un redémarrage manuel du service (comme tout changement
 * de .env dans ce projet — voir CLAUDE.md) : le formulaire prévient
 * explicitement plutôt que de laisser croire que c'est appliqué à chaud.
 */
function GDriveConfigCard() {
  const [expanded, setExpanded] = useState(false);
  const [config, setConfig] = useState<GDriveEnvConfig | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [rootFolderId, setRootFolderId] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  function loadConfig() {
    apiJson<GDriveEnvConfig>("/backups/gdrive/env-config")
      .then((c) => {
        setConfig(c);
        setEnabled(c.enabled);
        setClientId(c.clientId);
        setRootFolderId(c.rootFolderId);
      })
      .catch(() => setConfig(null));
  }

  function toggle() {
    setExpanded((v) => {
      const next = !v;
      if (next && !config) loadConfig();
      return next;
    });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await apiJson("/backups/gdrive/env-config", {
        method: "POST",
        body: JSON.stringify({
          enabled,
          clientId: clientId.trim(),
          clientSecret: clientSecret.trim() || undefined,
          rootFolderId: rootFolderId.trim(),
        }),
      });
      setClientSecret("");
      setMessage({
        type: "ok",
        text: "Enregistré dans .env — redémarrez le service (sudo systemctl restart pwa-admin) pour appliquer.",
      });
      loadConfig();
    } catch (err) {
      setMessage({ type: "error", text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <button type="button" onClick={toggle} className="flex w-full items-center justify-between">
        <CardTitle className="mb-0 flex items-center gap-1">
          <Cloud className="h-4 w-4" /> Configuration Google Drive
        </CardTitle>
        {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>

      {expanded && (
        <>
          {!config ? (
            <p className="mt-2 text-sm text-muted-foreground">Chargement…</p>
          ) : (
            <form onSubmit={save} className="mt-3 flex flex-col gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                Activer l'intégration Google Drive
              </label>

              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Client ID OAuth</label>
                <input
                  type="text"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="xxxxx.apps.googleusercontent.com"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs font-mono outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Client Secret OAuth {config.clientSecretSet && <span className="text-primary">(déjà défini)</span>}
                </label>
                <input
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder={config.clientSecretSet ? "Laisser vide pour conserver l'actuel" : "Non défini"}
                  autoComplete="off"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs font-mono outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  ID du dossier racine Drive (créé manuellement dans votre Drive)
                </label>
                <input
                  type="text"
                  value={rootFolderId}
                  onChange={(e) => setRootFolderId(e.target.value)}
                  placeholder="1AbCdEfGhIjKlMnOpQrStUvWxYz"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs font-mono outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              {message && (
                <p className={`text-xs ${message.type === "ok" ? "text-primary" : "text-destructive"}`}>
                  {message.text}
                </p>
              )}

              <Button type="submit" size="sm" disabled={saving}>
                {saving ? "Enregistrement…" : "Enregistrer"}
              </Button>
            </form>
          )}
        </>
      )}
    </Card>
  );
}

interface GDriveStatus {
  enabled: boolean;
  configured: boolean;
  authorized: boolean;
  rootFolderId: string | null;
}

/**
 * Connexion/déconnexion du compte Google Drive — déplacé depuis Backups.tsx
 * (qui garde uniquement la vérification/comparaison des sauvegardes déjà
 * envoyées, propre au contexte backup) vers Settings, aux côtés des autres
 * réglages de compte/intégrations. Mêmes endpoints qu'avant
 * (GET/POST /backups/gdrive/*) — seul l'emplacement de l'UI change.
 */
function GDriveConnectionCard() {
  const [status, setStatus] = useState<GDriveStatus | null>(null);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  function loadStatus() {
    apiJson<GDriveStatus>("/backups/gdrive/status")
      .then(setStatus)
      .catch(() => setStatus(null));
  }

  useEffect(loadStatus, []);

  async function startAuth() {
    setMessage(null);
    try {
      const { url } = await apiJson<{ url: string }>("/backups/gdrive/auth-url");
      setAuthUrl(url);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setMessage({ type: "error", text: (err as Error).message });
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      await apiJson("/backups/gdrive/authorize", {
        method: "POST",
        body: JSON.stringify({ code: code.trim() }),
      });
      setCode("");
      setAuthUrl(null);
      setMessage({ type: "ok", text: "Connecté à Google Drive avec succès." });
      loadStatus();
    } catch (err) {
      setMessage({ type: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function testUpload() {
    setBusy(true);
    setMessage(null);
    try {
      await apiJson("/backups/gdrive/test-upload", { method: "POST" });
      setMessage({ type: "ok", text: "Fichier de test envoyé avec succès sur Google Drive." });
    } catch (err) {
      setMessage({ type: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setMessage(null);
    try {
      await apiJson("/backups/gdrive/revoke", { method: "POST" });
      setMessage({ type: "ok", text: "Déconnecté de Google Drive." });
      loadStatus();
    } catch (err) {
      setMessage({ type: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardTitle className="flex items-center gap-1">
        <Cloud className="h-4 w-4" /> Google Drive
      </CardTitle>

      {!status ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : !status.enabled ? (
        <p className="text-sm text-muted-foreground">Désactivé (GDRIVE_ENABLED=false côté serveur).</p>
      ) : !status.configured ? (
        <p className="text-sm text-muted-foreground">
          Identifiants OAuth manquants (GDRIVE_OAUTH_CLIENT_ID / GDRIVE_OAUTH_CLIENT_SECRET).
        </p>
      ) : status.authorized ? (
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-1 text-sm text-primary">
            <CheckCircle2 className="h-4 w-4" /> Connecté
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={testUpload} disabled={busy}>
              Tester la connexion
            </Button>
            <ConfirmDialog
              trigger={
                <Button size="sm" variant="destructive" disabled={busy}>
                  Déconnecter
                </Button>
              }
              title="Déconnecter Google Drive ?"
              description="Les jobs ciblant « gdrive » échoueront jusqu'à une nouvelle autorisation."
              confirmLabel="Déconnecter"
              onConfirm={disconnect}
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-1 text-sm text-warning">
            <XCircle className="h-4 w-4" /> Non connecté
          </p>
          <Button size="sm" variant="outline" onClick={startAuth}>
            Autoriser l'accès à Google Drive
          </Button>
          {authUrl && (
            <form onSubmit={submitCode} className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">
                Une fenêtre Google s'est ouverte. Connectez-vous, autorisez l'accès, puis collez le code affiché
                ci-dessous.
              </p>
              <input
                type="text"
                placeholder="Code d'autorisation"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
              />
              <Button type="submit" size="sm" disabled={busy || !code.trim()}>
                {busy ? "Validation…" : "Valider le code"}
              </Button>
            </form>
          )}
        </div>
      )}

      {message && (
        <p className={`mt-2 text-xs ${message.type === "ok" ? "text-primary" : "text-destructive"}`}>
          {message.text}
        </p>
      )}
    </Card>
  );
}

function AuditLogCard() {
  const [expanded, setExpanded] = useState(false);
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);

  async function loadMore() {
    setLoading(true);
    try {
      const page = await apiJson<AuditLogRow[]>(`/audit?limit=${PAGE_SIZE}&offset=${offset}`);
      setRows((prev) => [...prev, ...page]);
      setOffset((prev) => prev + page.length);
      setHasMore(page.length === PAGE_SIZE);
    } finally {
      setLoading(false);
      setLoadedOnce(true);
    }
  }

  // Repliée par défaut — le journal complet n'est chargé qu'à la demande
  // (premier dépliage), pas au chargement de la page Settings.
  function toggle() {
    setExpanded((v) => {
      const next = !v;
      if (next && !loadedOnce) loadMore();
      return next;
    });
  }

  return (
    <Card>
      <button type="button" onClick={toggle} className="flex w-full items-center justify-between">
        <CardTitle className="mb-0">Journal d'audit</CardTitle>
        {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      {expanded && (
        <>
          <div className="mt-2 flex flex-col gap-1">
            {rows.map((r) => (
              <div key={r.id} className="border-b border-border/50 py-1.5 text-xs last:border-0">
                <div className="flex items-center justify-between">
                  <span className="font-mono">{r.action}</span>
                  <span className={r.result === "success" ? "text-primary" : "text-destructive"}>{r.result}</span>
                </div>
                <p className="text-muted-foreground">
                  {r.target ?? "—"} · {new Date(r.created_at).toLocaleString()}
                </p>
              </div>
            ))}
            {rows.length === 0 && !loading && <p className="text-sm text-muted-foreground">Aucune entrée.</p>}
          </div>
          {hasMore && (
            <Button size="sm" variant="outline" className="mt-2 w-full" disabled={loading} onClick={loadMore}>
              {loading ? "Chargement…" : "Charger plus"}
            </Button>
          )}
        </>
      )}
    </Card>
  );
}
