import { useEffect, useState } from "react";
import type {
  NginxStatus,
  NginxVhostSummary,
  NginxVhostDetail,
  NginxConfigSnapshot,
  NginxCertStatus,
  NginxVhostAccessibility,
  NginxVhostErrorSummary,
  NginxConfigBackupRun,
  TopPageEntry,
  VisitorStats,
} from "@pwa-admin/shared";
import { apiFetch, apiJson } from "@/lib/api";
import { useWsChannel } from "@/lib/ws";
import { Card, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { LiveLogPanel } from "@/components/LiveLogPanel";
import { formatBytes } from "./Docker";
import {
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
  RotateCw,
  History,
  Globe,
  AlertTriangle,
  Users,
  DatabaseBackup,
  FolderX,
} from "lucide-react";

export function Nginx() {
  const [status, setStatus] = useState<NginxStatus | null>(null);
  const [vhosts, setVhosts] = useState<NginxVhostSummary[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [s, v] = await Promise.all([
        apiJson<NginxStatus>("/nginx/status"),
        apiJson<NginxVhostSummary[]>("/nginx/vhosts"),
      ]);
      setStatus(s);
      setVhosts(v);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function reload() {
    setBusy(true);
    try {
      await apiJson("/nginx/reload", { method: "POST" });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function restart() {
    await apiJson("/nginx/restart", { method: "POST", body: JSON.stringify({ confirm: true }) });
    await load();
  }

  async function toggleVhost(name: string, enabled: boolean) {
    await apiJson(`/nginx/vhosts/${name}/${enabled ? "disable" : "enable"}`, { method: "POST" });
    await load();
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <Card className="text-sm text-destructive">{error}</Card>}

      <Card>
        <CardTitle>État Nginx</CardTitle>
        {status ? (
          <div className="flex flex-col gap-1 text-sm">
            <div className="flex items-center gap-2">
              {status.active ? (
                <CheckCircle2 className="h-4 w-4 text-primary" />
              ) : (
                <XCircle className="h-4 w-4 text-destructive" />
              )}
              <span>{status.active ? "Actif" : "Inactif"}</span>
              {status.version && <span className="text-muted-foreground">· {status.version}</span>}
            </div>
            <div className="flex items-center gap-2">
              {status.configTestOk ? (
                <CheckCircle2 className="h-4 w-4 text-primary" />
              ) : (
                <XCircle className="h-4 w-4 text-destructive" />
              )}
              <span>Test config : {status.configTestOk ? "OK" : "Échec"}</span>
            </div>
            {status.stubStatus && (
              <p className="text-xs text-muted-foreground">
                {status.stubStatus.activeConnections} connexions actives ·{" "}
                {status.stubStatus.requestsPerSecond.toFixed(1)} req/s
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        )}

        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={reload}>
            <RotateCw className="h-3.5 w-3.5" /> Recharger
          </Button>
          <ConfirmDialog
            trigger={
              <Button size="sm" variant="destructive">
                Redémarrer
              </Button>
            }
            title="Redémarrer Nginx ?"
            description="Cela peut interrompre brièvement tous les sites."
            confirmLabel="Redémarrer"
            onConfirm={restart}
          />
        </div>
      </Card>

      <NginxConfigBackupCard />

      <div>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Vhosts</h2>
        <div className="flex flex-col gap-3">
          {!vhosts && <Card className="text-sm text-muted-foreground">Chargement…</Card>}
          {vhosts?.length === 0 && <Card className="text-sm text-muted-foreground">Aucun vhost.</Card>}
          {vhosts?.map((v) => (
            <Card key={v.name}>
              <div
                className="flex cursor-pointer items-start justify-between gap-2"
                onClick={() => setExpanded(expanded === v.name ? null : v.name)}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{v.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {v.serverNames.length > 0 ? (
                      v.serverNames.map((sn, i) => (
                        <span key={sn}>
                          {i > 0 && ", "}
                          <SiteLink host={sn} usesTls={v.listenPorts.includes(443)} />
                        </span>
                      ))
                    ) : (
                      "(sans server_name)"
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Ports {v.listenPorts.join(", ")}
                    {v.proxyPassTarget ? ` · proxy → ${v.proxyPassTarget}` : ""}
                  </p>
                  {v.root && (
                    <p className="truncate text-xs text-muted-foreground">
                      {v.root}
                      {v.documentRootExists === false && (
                        <span className="ml-1 inline-flex items-center gap-0.5 text-destructive">
                          <FolderX className="h-3 w-3" /> introuvable
                        </span>
                      )}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={
                      "rounded-full px-2 py-0.5 text-xs font-medium " +
                      (v.enabled ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")
                    }
                  >
                    {v.enabled ? "activé" : "désactivé"}
                  </span>
                  {expanded === v.name ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              </div>

              <div className="mt-3 flex gap-2" onClick={(e) => e.stopPropagation()}>
                {v.enabled ? (
                  <ConfirmDialog
                    trigger={
                      <Button size="sm" variant="destructive">
                        Désactiver
                      </Button>
                    }
                    title={`Désactiver ${v.name} ?`}
                    description="Le site ne sera plus servi tant qu'il n'est pas réactivé."
                    confirmLabel="Désactiver"
                    onConfirm={() => toggleVhost(v.name, v.enabled)}
                  />
                ) : (
                  <Button size="sm" variant="outline" onClick={() => toggleVhost(v.name, v.enabled)}>
                    Activer
                  </Button>
                )}
              </div>

              {expanded === v.name && <VhostDetailPanel name={v.name} onChanged={load} />}
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

function SiteLink({ host, usesTls }: { host: string; usesTls: boolean }) {
  if (host === "_" || !host) return <span>{host}</span>;
  const url = `${usesTls ? "https" : "http"}://${host}/`;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="text-primary underline-offset-2 hover:underline"
    >
      {host}
    </a>
  );
}

function certBadgeClass(daysRemaining: number | null) {
  if (daysRemaining == null) return "bg-muted text-muted-foreground";
  if (daysRemaining < 14) return "bg-destructive/15 text-destructive";
  if (daysRemaining < 30) return "bg-warning/15 text-warning";
  return "bg-primary/15 text-primary";
}

function NginxConfigBackupCard() {
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<NginxConfigBackupRun | null>(null);
  const [useDrive, setUseDrive] = useState(true);

  async function runBackup() {
    setRunning(true);
    try {
      const run = await apiJson<NginxConfigBackupRun>("/nginx/config/backup", {
        method: "POST",
        body: JSON.stringify({ targets: useDrive ? ["local", "gdrive"] : ["local"] }),
      });
      setLastRun(run);
    } catch (err) {
      setLastRun({
        runId: "",
        status: "failed",
        sizeBytes: null,
        driveFileId: null,
        error: (err as Error).message,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      });
    } finally {
      setRunning(false);
    }
  }

  return (
    <Card>
      <CardTitle className="flex items-center gap-1">
        <DatabaseBackup className="h-4 w-4" /> Sauvegarde de la configuration Nginx
      </CardTitle>
      <p className="text-xs text-muted-foreground">
        Archive complète de sites-available et nginx.conf (local, et Google Drive si activé).
      </p>
      <div className="mt-3 flex items-center gap-3">
        <Button size="sm" disabled={running} onClick={runBackup}>
          {running ? "Sauvegarde en cours…" : "Sauvegarder maintenant"}
        </Button>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={useDrive} onChange={(e) => setUseDrive(e.target.checked)} />
          Inclure Google Drive
        </label>
      </div>
      {lastRun && (
        <p className={`mt-2 text-xs ${lastRun.status === "success" ? "text-primary" : "text-destructive"}`}>
          {lastRun.status === "success"
            ? `OK · ${lastRun.sizeBytes ? formatBytes(lastRun.sizeBytes) : ""}${lastRun.driveFileId ? " · envoyé sur Drive" : ""}`
            : `Échec : ${lastRun.error}`}
        </p>
      )}
    </Card>
  );
}

function VhostDetailPanel({ name, onChanged }: { name: string; onChanged: () => void }) {
  const [detail, setDetail] = useState<NginxVhostDetail | null>(null);
  const [cert, setCert] = useState<NginxCertStatus | null>(null);
  const [history, setHistory] = useState<NginxConfigSnapshot[] | null>(null);
  const [content, setContent] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [logType, setLogType] = useState<"access" | "error">("error");
  const [logChunk, setLogChunk] = useState<string | null>(null);
  const [initialLog, setInitialLog] = useState<string>("");
  const [accessibility, setAccessibility] = useState<NginxVhostAccessibility | null>(null);
  const [checkingAccess, setCheckingAccess] = useState(false);
  const [errorSummary, setErrorSummary] = useState<NginxVhostErrorSummary | null>(null);
  const [topPages, setTopPages] = useState<TopPageEntry[] | null>(null);
  const [visitors, setVisitors] = useState<VisitorStats | null>(null);

  async function load() {
    const [d, c, h] = await Promise.all([
      apiJson<NginxVhostDetail>(`/nginx/vhosts/${name}`),
      apiJson<NginxCertStatus>(`/nginx/vhosts/${name}/cert`),
      apiJson<NginxConfigSnapshot[]>(`/nginx/vhosts/${name}/history`),
    ]);
    setDetail(d);
    setContent(d.rawConfig);
    setCert(c);
    setHistory(h);
  }

  async function checkAccess() {
    setCheckingAccess(true);
    try {
      setAccessibility(await apiJson<NginxVhostAccessibility>(`/nginx/vhosts/${name}/accessibility`));
    } catch (err) {
      setAccessibility({
        checkedUrl: null,
        reachable: false,
        statusCode: null,
        latencyMs: null,
        error: (err as Error).message,
        checkedAt: new Date().toISOString(),
      });
    } finally {
      setCheckingAccess(false);
    }
  }

  useEffect(() => {
    load().catch(() => {});
    checkAccess().catch(() => {});
    apiJson<NginxVhostErrorSummary>(`/nginx/vhosts/${name}/errors?window=24&limit=20`)
      .then(setErrorSummary)
      .catch(() => setErrorSummary(null));
    apiJson<TopPageEntry[]>(`/analytics/sites/${name}/top-pages?window=7`)
      .then(setTopPages)
      .catch(() => setTopPages(null));
    apiJson<VisitorStats>(`/analytics/sites/${name}/visitors?window=7`)
      .then(setVisitors)
      .catch(() => setVisitors(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  useEffect(() => {
    setLogChunk(null);
    apiFetch(`/nginx/vhosts/${name}/logs?type=${logType}&tail=200`)
      .then((res) => (res.ok ? res.text() : ""))
      .then(setInitialLog)
      .catch(() => setInitialLog(""));
  }, [name, logType]);

  useWsChannel("nginx.logs", (frame) => setLogChunk(frame.data as string), { name, type: logType });

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await apiFetch(`/nginx/vhosts/${name}/config`, {
        method: "PUT",
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "save_failed" }));
        setSaveError(body.output ? `${body.error}: ${body.output}` : body.error ?? "save_failed");
        return;
      }
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function restoreSnapshot(id: number) {
    await apiJson(`/nginx/vhosts/${name}/history/${id}/restore`, { method: "POST" });
    await load();
    onChanged();
  }

  return (
    <div className="mt-3 flex flex-col gap-4 border-t border-border pt-3">
      {cert && (
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Certificat</p>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${certBadgeClass(cert.daysRemaining)}`}>
            {cert.found
              ? cert.daysRemaining != null
                ? `expire dans ${cert.daysRemaining}j`
                : "présent"
              : "absent"}
          </span>
          {cert.subject && <p className="mt-1 text-xs text-muted-foreground">{cert.subject}</p>}
        </div>
      )}

      <div>
        <p className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <Globe className="h-3.5 w-3.5" /> Accessibilité
        </p>
        {accessibility ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span
              className={
                "rounded-full px-2 py-0.5 font-medium " +
                (accessibility.reachable ? "bg-primary/15 text-primary" : "bg-destructive/15 text-destructive")
              }
            >
              {accessibility.reachable ? `accessible · HTTP ${accessibility.statusCode}` : "inaccessible"}
            </span>
            {accessibility.latencyMs != null && (
              <span className="text-muted-foreground">{accessibility.latencyMs} ms</span>
            )}
            {accessibility.checkedUrl && (
              <a
                href={accessibility.checkedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline-offset-2 hover:underline"
              >
                {accessibility.checkedUrl}
              </a>
            )}
            <Button size="sm" variant="outline" disabled={checkingAccess} onClick={checkAccess}>
              {checkingAccess ? "Test…" : "Retester"}
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Test en cours…</p>
        )}
        {accessibility?.error && <p className="mt-1 text-xs text-destructive">{accessibility.error}</p>}
      </div>

      <div>
        <p className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <Users className="h-3.5 w-3.5" /> Trafic (7 derniers jours)
        </p>
        {visitors ? (
          <p className="text-xs text-muted-foreground">
            {visitors.uniqueIps} visiteur{visitors.uniqueIps > 1 ? "s" : ""} unique
            {visitors.uniqueIps > 1 ? "s" : ""} · {visitors.totalRequests} requêtes
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">Pas de données de log disponibles.</p>
        )}
        {topPages && topPages.length > 0 && (
          <div className="mt-1 flex flex-col gap-0.5">
            {topPages.slice(0, 5).map((p) => (
              <div key={p.path} className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="truncate">{p.path}</span>
                <span className="shrink-0 pl-2">{p.hits}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <p className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5" /> Erreurs récentes (24h)
        </p>
        {errorSummary ? (
          errorSummary.recentCount === 0 ? (
            <p className="text-xs text-muted-foreground">Aucune erreur récente.</p>
          ) : (
            <div className="flex flex-col gap-1">
              <p className="text-xs text-muted-foreground">{errorSummary.recentCount} erreur(s)</p>
              <div className="max-h-32 overflow-y-auto rounded-md border border-border bg-black/90 p-2 font-mono text-[10px] text-destructive">
                {errorSummary.entries.map((e, i) => (
                  <div key={i} className="truncate">
                    {e.raw}
                  </div>
                ))}
              </div>
            </div>
          )
        ) : (
          <p className="text-xs text-muted-foreground">Chargement…</p>
        )}
      </div>

      <div>
        <p className="mb-1 text-xs font-medium text-muted-foreground">
          Configuration brute (éditeur simple — CodeMirror différé)
        </p>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
          className="h-56 w-full resize-y rounded-md border border-border bg-black/90 p-2 font-mono text-xs text-green-400 outline-none focus:ring-2 focus:ring-primary"
        />
        {saveError && <p className="mt-1 text-xs text-destructive">{saveError}</p>}
        <Button size="sm" className="mt-2" disabled={saving} onClick={save}>
          {saving ? "Enregistrement…" : "Enregistrer"}
        </Button>
      </div>

      {history && history.length > 0 && (
        <div>
          <p className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <History className="h-3.5 w-3.5" /> Historique
          </p>
          <div className="flex flex-col gap-1">
            {history.map((h) => (
              <div key={h.id} className="flex items-center justify-between rounded-md border border-border p-2 text-xs">
                <span>{new Date(h.createdAt).toLocaleString()}</span>
                <ConfirmDialog
                  trigger={
                    <Button size="sm" variant="outline">
                      Restaurer
                    </Button>
                  }
                  title="Restaurer cette version ?"
                  description="La configuration actuelle sera remplacée."
                  confirmLabel="Restaurer"
                  onConfirm={() => restoreSnapshot(h.id)}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="mb-1 flex gap-1">
          {(["access", "error"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setLogType(t)}
              className={
                "rounded-md px-2 py-1 text-xs font-medium " +
                (logType === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")
              }
            >
              {t === "access" ? "Accès" : "Erreurs"}
            </button>
          ))}
        </div>
        <LiveLogPanel chunk={logChunk} initialText={initialLog} />
      </div>
    </div>
  );
}
