import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AccessTokenSummary, CreateAccessTokenResponse, CurrentUser } from "@pwa-admin/shared";
import { apiFetch, apiJson } from "@/lib/api";
import { useAuthStore } from "@/stores/auth.store";
import { Card, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ShieldCheck, ShieldOff, LogOut, KeyRound, Trash2, RefreshCw } from "lucide-react";
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

      {user && !user.twoFactorEnabled && (
        <TwoFactorEnrollCard onEnrolled={() => setUser({ ...user, twoFactorEnabled: true })} />
      )}

      {user && user.twoFactorEnabled && (
        <TwoFactorDisableCard onDisabled={() => setUser({ ...user, twoFactorEnabled: false })} />
      )}

      <AccessTokensCard />

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

  return (
    <Card>
      <CardTitle>Application</CardTitle>
      <p className="text-xs text-muted-foreground">{APP_VERSION}</p>
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

function AuditLogCard() {
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);

  async function loadMore() {
    setLoading(true);
    try {
      const page = await apiJson<AuditLogRow[]>(`/audit?limit=${PAGE_SIZE}&offset=${offset}`);
      setRows((prev) => [...prev, ...page]);
      setOffset((prev) => prev + page.length);
      setHasMore(page.length === PAGE_SIZE);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card>
      <CardTitle>Journal d'audit</CardTitle>
      <div className="flex flex-col gap-1">
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
    </Card>
  );
}
