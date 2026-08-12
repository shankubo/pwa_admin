import { useEffect, useState } from "react";
import type {
  ListeningPort,
  TopPageEntry,
  VisitorStats,
  BlockedIpEntry,
  NginxVhostSummary,
  HardwareOverview,
} from "@pwa-admin/shared";
import { apiJson } from "@/lib/api";
import { Card, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ShieldBan, Network as NetworkIcon, Ban, Square, Loader2 } from "lucide-react";

const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_RE = /^[0-9a-fA-F:]+:[0-9a-fA-F:]*$/;

function isValidIp(ip: string): boolean {
  if (IPV4_RE.test(ip)) return ip.split(".").every((part) => Number(part) <= 255);
  return IPV6_RE.test(ip) && ip.includes(":");
}

// Same protected-name set as NetworkService.PROTECTED_PROCESS_NAMES
// (apps/api/src/modules/network/network.service.ts) — mirrored here purely
// as a client-side UX safety net (disable the button before the admin
// clicks through a confirm dialog just to be refused), NOT the actual
// security boundary — the backend re-checks all of this independently and
// is what actually matters if this list ever drifts out of sync.
const PROTECTED_PROCESS_NAMES = new Set(["node", "sshd", "systemd", "systemd-resolve", "systemd-network"]);

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
  const [rowError, setRowError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  // Purement local — /network/ports ne rapporte pas les règles UFW
  // existantes, donc rien ne réapparaît "débloqué" tout seul après un
  // rechargement ; ce badge indique juste "bloqué depuis cette page,
  // cette session". Le pare-feu reste la source de vérité.
  const [blockedKeys, setBlockedKeys] = useState<Set<string>>(new Set());
  const [sshPort, setSshPort] = useState<number | null>(null);

  function load() {
    apiJson<ListeningPort[]>("/network/ports")
      .then(setPorts)
      .catch((err) => setError((err as Error).message));
  }

  useEffect(() => {
    load();
    apiJson<HardwareOverview>("/hardware/overview")
      .then((o) => setSshPort(o.ssh.port))
      .catch(() => setSshPort(null));
  }, []);

  const portKey = (p: ListeningPort) => `${p.protocol}/${p.port}`;

  // window.location.port is this exact browser tab's own connection to
  // pwa-admin — the most direct possible signal for "which port is THIS
  // app listening on", no extra API round-trip needed. Falls back to 443
  // for the (rare) case of a bare-HTTPS URL with an implicit port.
  const ownPort = Number(window.location.port) || 443;

  function isProtectedRow(p: ListeningPort): boolean {
    return p.port === ownPort || p.port === sshPort || (!!p.processName && PROTECTED_PROCESS_NAMES.has(p.processName));
  }

  async function blockPort(p: ListeningPort) {
    const key = portKey(p);
    setBusyKey(key);
    setRowError(null);
    try {
      await apiJson("/network/ports/block", {
        method: "POST",
        body: JSON.stringify({ port: p.port, protocol: p.protocol }),
      });
      setBlockedKeys((prev) => new Set(prev).add(key));
    } catch (err) {
      setRowError((err as Error).message);
    } finally {
      setBusyKey(null);
    }
  }

  async function unblockPort(p: ListeningPort) {
    const key = portKey(p);
    setBusyKey(key);
    setRowError(null);
    try {
      await apiJson("/network/ports/unblock", {
        method: "POST",
        body: JSON.stringify({ port: p.port, protocol: p.protocol }),
      });
      setBlockedKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    } catch (err) {
      setRowError((err as Error).message);
    } finally {
      setBusyKey(null);
    }
  }

  async function killPort(p: ListeningPort) {
    if (p.pid == null) return;
    const key = `kill:${portKey(p)}`;
    setBusyKey(key);
    setRowError(null);
    try {
      await apiJson("/network/ports/kill", {
        method: "POST",
        body: JSON.stringify({ port: p.port, pid: p.pid }),
      });
      load();
    } catch (err) {
      setRowError((err as Error).message);
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <Card>
      <CardTitle className="flex items-center gap-1">
        <NetworkIcon className="h-4 w-4" /> Ports ouverts
      </CardTitle>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {rowError && <p className="text-sm text-destructive">{rowError}</p>}
      {!ports && !error && <p className="text-sm text-muted-foreground">Chargement…</p>}
      {ports && ports.length === 0 && <p className="text-sm text-muted-foreground">Aucun port ouvert détecté.</p>}
      {ports && ports.length > 0 && (
        <div className="flex flex-col gap-1">
          {ports.map((p, i) => {
            const key = portKey(p);
            const isBlocked = blockedKeys.has(key);
            const protectedRow = isProtectedRow(p);
            return (
              <div
                key={i}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 py-1.5 text-xs last:border-0"
              >
                <div className="flex items-center gap-2">
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
                    {isBlocked && (
                      <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-medium text-destructive">
                        bloqué
                      </span>
                    )}
                    {protectedRow && (
                      <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
                        protégé
                      </span>
                    )}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  {protectedRow ? (
                    <span className="text-[10px] text-muted-foreground">
                      Port protégé — ni blocage ni arrêt possibles depuis cet écran.
                    </span>
                  ) : (
                    <>
                      {isBlocked ? (
                        <Button size="sm" variant="outline" disabled={busyKey === key} onClick={() => unblockPort(p)}>
                          {busyKey === key ? <Loader2 className="h-3 w-3 animate-spin" /> : "Débloquer"}
                        </Button>
                      ) : (
                        <ConfirmDialog
                          trigger={
                            <Button size="sm" variant="outline" disabled={busyKey === key}>
                              {busyKey === key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Ban className="h-3 w-3" />}
                              Bloquer
                            </Button>
                          }
                          title={`Bloquer le port ${p.port}/${p.protocol} ?`}
                          description="Ferme l'accès à ce port depuis l'extérieur via le pare-feu (ufw deny). Le processus continue de tourner — seule sa joignabilité réseau change. Réversible."
                          confirmLabel="Bloquer"
                          onConfirm={() => blockPort(p)}
                        />
                      )}
                      {p.pid != null && !p.ownedByContainer && (
                        <ConfirmDialog
                          trigger={
                            <Button size="sm" variant="destructive" disabled={busyKey === `kill:${key}`}>
                              {busyKey === `kill:${key}` ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Square className="h-3 w-3" />
                              )}
                              Arrêter
                            </Button>
                          }
                          title={`Arrêter le processus « ${p.processName ?? "?"} » (PID ${p.pid}) ?`}
                          description="Envoie un signal d'arrêt (SIGTERM) au processus qui écoute sur ce port. Contrairement à « Bloquer », le processus lui-même s'arrête — tout ce qu'il servait devient indisponible, pas seulement injoignable depuis l'extérieur. Action irréversible (il faudra le relancer manuellement)."
                          requireTypedConfirmation="STOP"
                          confirmLabel="Arrêter"
                          onConfirm={() => killPort(p)}
                        />
                      )}
                      {p.pid != null && p.ownedByContainer && (
                        <span className="text-[10px] text-muted-foreground">
                          Conteneur — utilisez Docker pour l'arrêter.
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
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
