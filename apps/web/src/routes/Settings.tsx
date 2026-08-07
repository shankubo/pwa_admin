import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { CurrentUser } from "@pwa-admin-pi/shared";
import { apiFetch, apiJson } from "@/lib/api";
import { useAuthStore } from "@/stores/auth.store";
import { Card, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ShieldCheck, LogOut } from "lucide-react";

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

      <AuditLogCard />

      <Button variant="destructive" onClick={logout}>
        <LogOut className="h-4 w-4" /> Se déconnecter
      </Button>
    </div>
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
