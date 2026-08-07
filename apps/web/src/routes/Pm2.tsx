import { useEffect, useState } from "react";
import type { Pm2Process, Pm2Status } from "@pwa-admin-pi/shared";
import { apiJson, apiFetch } from "@/lib/api";
import { useWsChannel } from "@/lib/ws";
import { Card, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { LiveLogPanel } from "@/components/LiveLogPanel";
import { formatBytes } from "./Docker";
import { Hexagon, Play, Square, RotateCw, RefreshCw, FileText } from "lucide-react";

const STATUS_STYLES: Record<Pm2Status, string> = {
  online: "bg-primary/15 text-primary",
  stopped: "bg-muted text-muted-foreground",
  stopping: "bg-warning/15 text-warning",
  launching: "bg-warning/15 text-warning",
  errored: "bg-destructive/15 text-destructive",
  "one-launch-status": "bg-muted text-muted-foreground",
};

const STATUS_LABELS: Record<Pm2Status, string> = {
  online: "en ligne",
  stopped: "arrêté",
  stopping: "arrêt en cours",
  launching: "démarrage",
  errored: "en erreur",
  "one-launch-status": "unique",
};

function formatUptime(ms: number | null): string {
  if (ms == null) return "—";
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) return `${days}j ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function Pm2() {
  const [processes, setProcesses] = useState<Pm2Process[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [expandedName, setExpandedName] = useState<string | null>(null);

  function loadProcesses() {
    return apiJson<Pm2Process[]>("/pm2/processes")
      .then(setProcesses)
      .catch((err) => setError((err as Error).message));
  }

  useEffect(() => {
    loadProcesses();
    const interval = setInterval(loadProcesses, 5000);
    return () => clearInterval(interval);
  }, []);

  async function runAction(name: string, action: "start" | "stop" | "restart" | "reload") {
    setBusyName(name);
    setError(null);
    try {
      await apiJson(`/pm2/processes/${encodeURIComponent(name)}/${action}`, { method: "POST" });
      await loadProcesses();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyName(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardTitle className="flex items-center gap-1">
          <Hexagon className="h-4 w-4" /> Processus Node.js (PM2)
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Applications Node.js gérées par PM2 directement sur l'hôte (hors Docker). Les applications qui tournent
          dans des conteneurs Docker sont gérées depuis l'écran Docker.
        </p>
      </Card>

      {error && <Card className="text-sm text-destructive">{error}</Card>}

      {!processes && !error && <Card className="text-sm text-muted-foreground">Chargement…</Card>}
      {processes?.length === 0 && (
        <Card className="text-sm text-muted-foreground">Aucun processus PM2 détecté.</Card>
      )}

      <div className="flex flex-col gap-3">
        {processes?.map((p) => (
          <Card key={p.pmId}>
            <div className="flex items-start justify-between gap-2">
              <div
                className="min-w-0 cursor-pointer"
                onClick={() => setExpandedName((prev) => (prev === p.name ? null : p.name))}
              >
                <p className="flex items-center gap-2 truncate font-medium">
                  {p.name}
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[p.status]}`}>
                    {STATUS_LABELS[p.status]}
                  </span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {p.status === "online" ? (
                    <>
                      CPU {p.cpuPercent.toFixed(0)}% · RAM {formatBytes(p.memoryBytes)} · uptime{" "}
                      {formatUptime(p.uptimeMs)}
                    </>
                  ) : (
                    "—"
                  )}
                  {p.restarts > 0 ? ` · ${p.restarts} redémarrage${p.restarts > 1 ? "s" : ""}` : ""}
                </p>
                {p.scriptPath && (
                  <p className="mt-1 truncate text-xs text-muted-foreground">{p.scriptPath}</p>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-2">
                {p.status === "online" ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyName === p.name}
                      onClick={() => runAction(p.name, "restart")}
                      title="Redémarrer"
                    >
                      <RotateCw className="h-3.5 w-3.5" />
                    </Button>
                    <ConfirmDialog
                      trigger={
                        <Button size="sm" variant="destructive" disabled={busyName === p.name} title="Arrêter">
                          <Square className="h-3.5 w-3.5" />
                        </Button>
                      }
                      title={`Arrêter ${p.name} ?`}
                      description="Le processus ne répondra plus tant qu'il n'est pas redémarré."
                      confirmLabel="Arrêter"
                      onConfirm={() => runAction(p.name, "stop")}
                    />
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyName === p.name}
                    onClick={() => runAction(p.name, "start")}
                    title="Démarrer"
                  >
                    <Play className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setExpandedName((prev) => (prev === p.name ? null : p.name))}
                  title="Logs"
                >
                  <FileText className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {expandedName === p.name && <Pm2ProcessDetail name={p.name} />}
          </Card>
        ))}
      </div>
    </div>
  );
}

function Pm2ProcessDetail({ name }: { name: string }) {
  const [initialLogs, setInitialLogs] = useState<string>("");
  const [liveChunk, setLiveChunk] = useState<string | null>(null);

  useEffect(() => {
    // Logs are served as text/plain, not JSON — use apiFetch directly rather than apiJson.
    apiFetch(`/pm2/processes/${encodeURIComponent(name)}/logs?lines=200`)
      .then((res) => res.text())
      .then(setInitialLogs)
      .catch(() => {});
  }, [name]);

  useWsChannel(
    "pm2.logs",
    (frame) => {
      setLiveChunk(frame.data as string);
    },
    { name }
  );

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
      <p className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
        <RefreshCw className="h-3.5 w-3.5" /> Logs en direct
      </p>
      <LiveLogPanel initialText={initialLogs} chunk={liveChunk} />
    </div>
  );
}
