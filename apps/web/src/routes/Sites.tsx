import { useEffect, useState } from "react";
import type { NginxVhostSummary, NginxVhostDetail, NginxCertStatus } from "@pwa-admin-pi/shared";
import { apiFetch, apiJson } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { LiveLogPanel } from "@/components/LiveLogPanel";
import { ChevronDown, ChevronUp, Globe } from "lucide-react";

interface LinkedContainer {
  id: string;
  name: string;
  state: string;
}

interface SiteSummary extends NginxVhostSummary {
  linkedContainer: LinkedContainer | null;
}

interface SiteDetail {
  vhost: NginxVhostDetail;
  cert: NginxCertStatus;
  linkedContainer: LinkedContainer | null;
}

function certBadgeClass(daysRemaining: number | null) {
  if (daysRemaining == null) return "bg-muted text-muted-foreground";
  if (daysRemaining < 14) return "bg-destructive/15 text-destructive";
  if (daysRemaining < 30) return "bg-warning/15 text-warning";
  return "bg-primary/15 text-primary";
}

export function Sites() {
  const [sites, setSites] = useState<SiteSummary[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setSites(await apiJson<SiteSummary[]>("/sites"));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function toggle(name: string, enabled: boolean) {
    await apiJson(`/sites/${name}/${enabled ? "disable" : "enable"}`, { method: "POST" });
    await load();
  }

  if (error) return <Card className="text-sm text-destructive">{error}</Card>;
  if (!sites) return <Card className="text-sm text-muted-foreground">Chargement…</Card>;
  if (sites.length === 0) return <Card className="text-sm text-muted-foreground">Aucun site.</Card>;

  return (
    <div className="flex flex-col gap-3">
      {sites.map((s) => (
        <Card key={s.name}>
          <div
            className="flex cursor-pointer items-start justify-between gap-2"
            onClick={() => setExpanded(expanded === s.name ? null : s.name)}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate font-medium">{s.name}</span>
              </div>
              <p className="truncate text-xs text-muted-foreground">{s.serverNames.join(", ") || "—"}</p>
              {s.linkedContainer && (
                <span className="mt-1 inline-block rounded-full bg-muted px-2 py-0.5 text-xs">
                  conteneur : {s.linkedContainer.name} ({s.linkedContainer.state})
                </span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span
                className={
                  "rounded-full px-2 py-0.5 text-xs font-medium " +
                  (s.enabled ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")
                }
              >
                {s.enabled ? "activé" : "désactivé"}
              </span>
              {expanded === s.name ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          </div>

          <div className="mt-3 flex gap-2" onClick={(e) => e.stopPropagation()}>
            {s.enabled ? (
              <ConfirmDialog
                trigger={
                  <Button size="sm" variant="destructive">
                    Désactiver
                  </Button>
                }
                title={`Désactiver ${s.name} ?`}
                description="Le site ne sera plus accessible."
                confirmLabel="Désactiver"
                onConfirm={() => toggle(s.name, s.enabled)}
              />
            ) : (
              <Button size="sm" variant="outline" onClick={() => toggle(s.name, s.enabled)}>
                Activer
              </Button>
            )}
          </div>

          {expanded === s.name && <SiteDetailPanel name={s.name} />}
        </Card>
      ))}
    </div>
  );
}

function SiteDetailPanel({ name }: { name: string }) {
  const [detail, setDetail] = useState<SiteDetail | null>(null);
  const [logTab, setLogTab] = useState<"nginx-access" | "nginx-error" | "docker">("nginx-error");
  const [logText, setLogText] = useState("");

  useEffect(() => {
    apiJson<SiteDetail>(`/sites/${name}`)
      .then(setDetail)
      .catch(() => {});
  }, [name]);

  useEffect(() => {
    setLogText("");
    if (logTab === "docker") {
      if (!detail?.linkedContainer) return;
      apiFetch(`/docker/containers/${detail.linkedContainer.id}/logs?tail=200`)
        .then((res) => (res.ok ? res.text() : ""))
        .then(setLogText)
        .catch(() => {});
    } else {
      const type = logTab === "nginx-access" ? "access" : "error";
      apiFetch(`/sites/${name}/logs?type=${type}&tail=200`)
        .then((res) => (res.ok ? res.text() : ""))
        .then(setLogText)
        .catch(() => {});
    }
  }, [logTab, name, detail?.linkedContainer]);

  if (!detail) return <p className="mt-3 border-t border-border pt-3 text-sm text-muted-foreground">Chargement…</p>;

  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3 text-sm">
      <div>
        <p className="text-xs text-muted-foreground">Racine : {detail.vhost.root ?? "—"}</p>
        <p className="text-xs text-muted-foreground">Proxy : {detail.vhost.proxyPassTarget ?? "—"}</p>
        <p className="text-xs text-muted-foreground">Ports : {detail.vhost.listenPorts.join(", ")}</p>
      </div>

      <div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${certBadgeClass(detail.cert.daysRemaining)}`}>
          {detail.cert.found
            ? detail.cert.daysRemaining != null
              ? `cert. expire dans ${detail.cert.daysRemaining}j`
              : "cert. présent"
            : "pas de certificat"}
        </span>
      </div>

      <div>
        <div className="mb-1 flex flex-wrap gap-1">
          <button
            onClick={() => setLogTab("nginx-access")}
            className={
              "rounded-md px-2 py-1 text-xs font-medium " +
              (logTab === "nginx-access" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")
            }
          >
            Accès Nginx
          </button>
          <button
            onClick={() => setLogTab("nginx-error")}
            className={
              "rounded-md px-2 py-1 text-xs font-medium " +
              (logTab === "nginx-error" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")
            }
          >
            Erreurs Nginx
          </button>
          {detail.linkedContainer && (
            <button
              onClick={() => setLogTab("docker")}
              className={
                "rounded-md px-2 py-1 text-xs font-medium " +
                (logTab === "docker" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")
              }
            >
              Conteneur
            </button>
          )}
        </div>
        <LiveLogPanel initialText={logText} emptyLabel="Aucun log." />
      </div>
    </div>
  );
}
