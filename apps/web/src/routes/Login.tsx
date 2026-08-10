import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { Card, CardTitle } from "@/components/ui/Card";
import { useAuthStore } from "@/stores/auth.store";

const API_BASE = "/api";

export function Login() {
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  const [step, setStep] = useState<"credentials" | "2fa" | "token">("credentials");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [tempToken, setTempToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleCredentialsSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Échec de connexion");
        return;
      }
      if (data.requires2fa) {
        setTempToken(data.tempToken);
        setStep("2fa");
      } else {
        setSession(data.accessToken, null);
        navigate("/");
      }
    } catch {
      setError("Erreur réseau");
    } finally {
      setLoading(false);
    }
  }

  async function handleTokenSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/token-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token: accessToken }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Jeton invalide");
        return;
      }
      setSession(data.accessToken, null);
      navigate("/");
    } catch {
      setError("Erreur réseau");
    } finally {
      setLoading(false);
    }
  }

  async function handle2faSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/2fa/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ tempToken, code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Code invalide");
        return;
      }
      setSession(data.accessToken, null);
      navigate("/");
    } catch {
      setError("Erreur réseau");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardTitle>Server Admin — Connexion</CardTitle>
        {step === "credentials" ? (
          <form onSubmit={handleCredentialsSubmit} className="flex flex-col gap-3">
            <input
              type="text"
              placeholder="Identifiant"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              className="rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
              required
            />
            <input
              type="password"
              placeholder="Mot de passe"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
              required
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={loading}>
              {loading ? "Connexion…" : "Se connecter"}
            </Button>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setStep("token");
              }}
              className="text-sm text-muted-foreground underline underline-offset-2"
            >
              Connexion par jeton
            </button>
          </form>
        ) : step === "2fa" ? (
          <form onSubmit={handle2faSubmit} className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">Entrez le code de votre application 2FA.</p>
            <input
              type="text"
              inputMode="numeric"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={6}
              className="rounded-md border border-border bg-transparent px-3 py-2 text-center text-lg tracking-widest outline-none focus:ring-2 focus:ring-primary"
              required
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={loading}>
              {loading ? "Vérification…" : "Valider"}
            </Button>
          </form>
        ) : (
          <form onSubmit={handleTokenSubmit} className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Collez le jeton d'accès généré depuis un autre appareil connecté (Paramètres → Jetons d'accès).
            </p>
            <input
              type="password"
              placeholder="Jeton d'accès"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              autoComplete="off"
              className="rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
              required
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={loading}>
              {loading ? "Connexion…" : "Se connecter"}
            </Button>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setStep("credentials");
              }}
              className="text-sm text-muted-foreground underline underline-offset-2"
            >
              Retour au mot de passe
            </button>
          </form>
        )}
      </Card>
    </div>
  );
}
