import { useEffect, useState } from "react";
import type {
  ListeningPort,
  TopPageEntry,
  VisitorStats,
  BlockedIpEntry,
  NginxVhostSummary,
} from "@pwa-admin-pi/shared";
import { apiJson } from "@/lib/api";
import { Card, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ShieldBan, Network as NetworkIcon } from "lucide-react";

const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_RE = /^[0-9a-fA-F:]+:[0-9a-fA-F:]*$/;

function isValidIp(ip: string): boolean {
  if (IPV4_RE.test(ip)) return ip.split(".").every((part) => Number(part) <= 255);
  return IPV6_RE.test(ip) && ip.includes(":");
}

export function NetworkSecurity() {
  return (
    <div className="flex flex-col gap-4">
      <OpenPortsSection />
      <AnalyticsSection />
      <BlockedIpsSection />
    </div>
  );
}

function OpenPortsSection() {
  const [ports, setPorts] = useState<ListeningPort[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiJson<ListeningPort[]>("/network/ports")
      .then(setPorts)
      .catch((err) => setError((err as Error).message));
  }, []);

  return (
    <Card>
      <CardTitle className="flex items-center gap-1">
        <NetworkIcon className="h-4 w-4" /> Ports ouverts
      </CardTitle>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!ports && !error && <p className="text-sm text-muted-foreground">Chargement…</p>}
      {ports && ports.length === 0 && <p className="text-sm text-muted-foreground">Aucun port ouvert détecté.</p>}
      {ports && ports.length > 0 && (
        <div className="flex flex-col gap-1">
          {ports.map((p, i) => (
            <div key={i} className="flex items-center justify-between border-b border-border/50 py-1 text-xs last:border-0">
              <span className="font-mono">
                {p.protocol}/{p.localAddress}:{p.port}
              </span>
              <span className="flex items-center gap-1 text-muted-foreground">
                {p.processName ?? "—"}
                {p.ownedByContainer && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium">
                    {p.ownedByContainer}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function AnalyticsSection() {
  const [sites, setSites] = useState<NginxVhostSummary[] | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [windowDays, setWindowDays] = useState(7);
  const [topPages, setTopPages] = useState<TopPageEntry[] | null>(null);
  const [visitors, setVisitors] = useState<VisitorStats | null>(null);

  useEffect(() => {
    apiJson<NginxVhostSummary[]>("/nginx/vhosts")
      .then((v) => {
        setSites(v);
        if (v.length > 0) setSelected(v[0].name);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selected) return;
    apiJson<TopPageEntry[]>(`/analytics/sites/${selected}/top-pages?window=${windowDays}`)
      .then(setTopPages)
      .catch(() => setTopPages(null));
    apiJson<VisitorStats>(`/analytics/sites/${selected}/visitors?window=${windowDays}`)
      .then(setVisitors)
      .catch(() => setVisitors(null));
  }, [selected, windowDays]);

  return (
    <Card>
      <CardTitle>Trafic par site</CardTitle>
      {sites && sites.length > 0 ? (
        <>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="mb-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
          >
            {sites.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>

          <div className="mb-3 flex gap-1">
            {[1, 7, 30].map((w) => (
              <button
                key={w}
                onClick={() => setWindowDays(w)}
                className={
                  "rounded-md px-2 py-1 text-xs font-medium " +
                  (windowDays === w ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")
                }
              >
                {w}j
              </button>
            ))}
          </div>

          {visitors && (
            <div className="mb-3 grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Visiteurs uniques</p>
                <p className="font-medium">{visitors.uniqueIps}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Requêtes totales</p>
                <p className="font-medium">{visitors.totalRequests}</p>
              </div>
            </div>
          )}

          {topPages && topPages.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Pages les plus visitées</p>
              <div className="flex flex-col gap-1">
                {topPages.map((p, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className="truncate font-mono">{p.path}</span>
                    <span className="shrink-0 text-muted-foreground">{p.hits}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Aucun site.</p>
      )}
    </Card>
  );
}

function BlockedIpsSection() {
  const [blocked, setBlocked] = useState<BlockedIpEntry[] | null>(null);
  const [newIp, setNewIp] = useState("");
  const [newJail, setNewJail] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    try {
      setBlocked(await apiJson<BlockedIpEntry[]>("/security/blocked-ips"));
    } catch {
      setBlocked([]);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function unban(ip: string) {
    await apiJson(`/security/blocked-ips/${ip}`, { method: "DELETE" });
    await load();
  }

  async function ban(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!isValidIp(newIp.trim())) {
      setFormError("Adresse IP invalide");
      return;
    }
    setSubmitting(true);
    try {
      await apiJson("/security/blocked-ips", {
        method: "POST",
        body: JSON.stringify({ ip: newIp.trim(), jail: newJail.trim() || undefined }),
      });
      setNewIp("");
      setNewJail("");
      await load();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardTitle className="flex items-center gap-1">
        <ShieldBan className="h-4 w-4" /> IPs bloquées
      </CardTitle>

      {blocked && blocked.length > 0 ? (
        <div className="mb-3 flex flex-col gap-1">
          {blocked.map((b) => (
            <div key={b.ip} className="flex items-center justify-between border-b border-border/50 py-1 text-xs last:border-0">
              <span className="font-mono">{b.ip}</span>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">{b.jail}</span>
                <ConfirmDialog
                  trigger={
                    <Button size="sm" variant="outline">
                      Débloquer
                    </Button>
                  }
                  title={`Débloquer ${b.ip} ?`}
                  confirmLabel="Débloquer"
                  onConfirm={() => unban(b.ip)}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mb-3 text-sm text-muted-foreground">Aucune IP bloquée.</p>
      )}

      <form onSubmit={ban} className="flex flex-col gap-2">
        <p className="text-xs font-medium text-muted-foreground">Bloquer une IP</p>
        <input
          type="text"
          placeholder="192.168.1.10"
          value={newIp}
          onChange={(e) => setNewIp(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
        />
        <input
          type="text"
          placeholder="jail (optionnel)"
          value={newJail}
          onChange={(e) => setNewJail(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
        />
        {formError && <p className="text-xs text-destructive">{formError}</p>}
        <Button type="submit" size="sm" variant="destructive" disabled={submitting}>
          Bloquer
        </Button>
      </form>
    </Card>
  );
}
