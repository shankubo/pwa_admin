import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ServicesOverview, ServiceStatusEntry, ServiceUpdateResult } from "@pwa-admin/shared";
import { apiJson } from "@/lib/api";
import { Card, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Network, Container, Hexagon, Server, CheckCircle2, XCircle, RefreshCw, Loader2 } from "lucide-react";

const ICONS = { tailscale: Network, docker: Container, pm2: Hexagon, webserver: Server } as const;

export function Services() {
  const { t } = useTranslation("services");
  const [overview, setOverview] = useState<ServicesOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ServiceUpdateResult>>({});

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setOverview(await apiJson<ServicesOverview>("/services/overview"));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function runAction(key: string, path: string) {
    setBusyAction(key);
    setError(null);
    try {
      const result = await apiJson<ServiceUpdateResult>(path, {
        method: "POST",
        body: JSON.stringify({ confirm: true }),
      });
      setResults((prev) => ({ ...prev, [key]: result }));
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">{t("installedServices")}</h2>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {t("refresh")}
        </Button>
      </div>

      {error && <Card className="text-sm text-destructive">{error}</Card>}
      {!overview && !error && <Card className="text-sm text-muted-foreground">{t("loading")}</Card>}

      {overview?.services.map((service) => (
        <ServiceCard
          key={service.name}
          service={service}
          busyAction={busyAction}
          result={results[service.name]}
          onAction={runAction}
        />
      ))}
    </div>
  );
}

function ServiceCard({
  service,
  busyAction,
  result,
  onAction,
}: {
  service: ServiceStatusEntry;
  busyAction: string | null;
  result: ServiceUpdateResult | undefined;
  onAction: (key: string, path: string) => void;
}) {
  const { t } = useTranslation("services");
  const Icon = ICONS[service.name];

  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-1">
            <Icon className="h-4 w-4" /> {service.label}
          </CardTitle>
          {service.installed ? (
            <p className="mt-1 flex items-center gap-1 text-sm text-primary">
              <CheckCircle2 className="h-4 w-4" />
              {service.running ? t("running") : t("installedStopped")}
              {service.version ? ` · ${service.version}` : ""}
            </p>
          ) : (
            <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
              <XCircle className="h-4 w-4" /> {t("notInstalled")}
            </p>
          )}
          {service.detail && (
            <p className="mt-1 text-xs text-muted-foreground">
              {Object.entries(service.detail)
                .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
                .join(" · ")}
            </p>
          )}
        </div>
      </div>

      {service.installed && (
        <div className="mt-3 flex flex-wrap gap-2">
          {service.name === "tailscale" && (
            <ConfirmDialog
              trigger={
                <Button size="sm" variant="outline" disabled={busyAction === "tailscale-update"}>
                  {busyAction === "tailscale-update" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("update")}
                </Button>
              }
              title={t("updateTailscaleTitle")}
              description={t("updateTailscaleDescription")}
              confirmLabel={t("update")}
              onConfirm={() => onAction("tailscale-update", "/services/tailscale/update")}
            />
          )}
          {service.name === "docker" && (
            <>
              <ConfirmDialog
                trigger={
                  <Button size="sm" variant="outline" disabled={busyAction === "docker-update"}>
                    {busyAction === "docker-update" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("update")}
                  </Button>
                }
                title={t("updateDockerTitle")}
                description={t("updateDockerDescription")}
                confirmLabel={t("update")}
                onConfirm={() => onAction("docker-update", "/services/docker/update")}
              />
              <ConfirmDialog
                trigger={
                  <Button size="sm" variant="destructive" disabled={busyAction === "docker-restart"}>
                    {busyAction === "docker-restart" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("restart")}
                  </Button>
                }
                title={t("restartDockerTitle")}
                description={t("restartDockerDescription")}
                requireTypedConfirmation="RESTART"
                confirmLabel={t("restart")}
                onConfirm={() => onAction("docker-restart", "/services/docker/restart")}
              />
            </>
          )}
          {service.name === "pm2" && (
            <ConfirmDialog
              trigger={
                <Button size="sm" variant="outline" disabled={busyAction === "pm2-reload"}>
                  {busyAction === "pm2-reload" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("reloadDaemon")}
                </Button>
              }
              title={t("reloadPm2Title")}
              description={t("reloadPm2Description")}
              confirmLabel={t("reload")}
              onConfirm={() => onAction("pm2-reload", "/services/pm2/reload-daemon")}
            />
          )}
        </div>
      )}

      {result && (
        <details className="mt-3 text-xs">
          <summary className={result.ok ? "cursor-pointer text-primary" : "cursor-pointer text-destructive"}>
            {result.ok ? t("resultSuccess") : t("resultFailure")}
          </summary>
          <pre className="mt-1 max-h-40 overflow-auto rounded-md bg-muted p-2 text-[10px]">{result.output}</pre>
        </details>
      )}
    </Card>
  );
}
