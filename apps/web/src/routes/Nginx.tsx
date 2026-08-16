import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import type {
  WebServerStatus,
  VhostSummary,
  VhostDetail,
  ConfigSnapshot,
  CertStatus,
  VhostAccessibility,
  VhostErrorSummary,
  ConfigBackupRun,
  GuidedFormModel,
  TopPageEntry,
  VisitorStats,
} from "@pwa-admin/shared";
import { useTranslation } from "react-i18next";
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
  Wand2,
  X,
  Plus,
  Upload,
} from "lucide-react";

function vhostCardClass(v: VhostSummary): string {
  if (!v.enabled) return "border-muted-foreground/30 bg-muted/30";
  if (v.maintenanceMode) return "border-warning/50 bg-warning/5";
  return "border-primary/40 bg-primary/5";
}

export function Nginx() {
  const { t } = useTranslation("nginx");
  const [status, setStatus] = useState<WebServerStatus | null>(null);
  const [vhosts, setVhosts] = useState<VhostSummary[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [s, v] = await Promise.all([
        apiJson<WebServerStatus>("/nginx/status"),
        apiJson<VhostSummary[]>("/nginx/vhosts"),
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
        <CardTitle>{t("status.title")}</CardTitle>
        {status ? (
          <div className="flex flex-col gap-1 text-sm">
            <div className="flex items-center gap-2">
              {status.active ? (
                <CheckCircle2 className="h-4 w-4 text-primary" />
              ) : (
                <XCircle className="h-4 w-4 text-destructive" />
              )}
              <span>{status.active ? t("status.active") : t("status.inactive")}</span>
              {status.version && <span className="text-muted-foreground">· {status.version}</span>}
            </div>
            <div className="flex items-center gap-2">
              {status.configTestOk ? (
                <CheckCircle2 className="h-4 w-4 text-primary" />
              ) : (
                <XCircle className="h-4 w-4 text-destructive" />
              )}
              <span>
                {t("status.configTest", {
                  result: status.configTestOk ? t("status.configTestOk") : t("status.configTestFailed"),
                })}
              </span>
            </div>
            {status.stubStatus && (
              <p className="text-xs text-muted-foreground">
                {t("status.connectionsInfo", {
                  count: status.stubStatus.activeConnections,
                  rps: status.stubStatus.requestsPerSecond.toFixed(1),
                })}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("status.loading")}</p>
        )}

        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={reload}>
            <RotateCw className="h-3.5 w-3.5" /> {t("status.reload")}
          </Button>
          <ConfirmDialog
            trigger={
              <Button size="sm" variant="destructive">
                {t("status.restart")}
              </Button>
            }
            title={t("status.restartConfirm.title")}
            description={t("status.restartConfirm.description")}
            confirmLabel={t("status.restart")}
            onConfirm={restart}
          />
        </div>
      </Card>

      <NginxConfigBackupCard />

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground">{t("vhosts.sectionTitle")}</h2>
          <GuidedConfigEditorDialog
            mode="create"
            trigger={
              <Button size="sm" variant="outline">
                <Plus className="h-3.5 w-3.5" /> {t("vhosts.newSite")}
              </Button>
            }
            onCreated={load}
          />
        </div>
        <div className="flex flex-col gap-3">
          {!vhosts && <Card className="text-sm text-muted-foreground">{t("vhosts.loading")}</Card>}
          {vhosts?.length === 0 && <Card className="text-sm text-muted-foreground">{t("vhosts.empty")}</Card>}
          {vhosts?.map((v) => (
            <Card key={v.name} className={vhostCardClass(v)}>
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
                      t("vhosts.noServerName")
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("vhosts.ports", { ports: v.listenPorts.join(", ") })}
                    {v.proxyPassTarget ? t("vhosts.proxySuffix", { target: v.proxyPassTarget }) : ""}
                  </p>
                  {v.root && (
                    <p className="truncate text-xs text-muted-foreground">
                      {v.root}
                      {v.documentRootExists === false && (
                        <span className="ml-1 inline-flex items-center gap-0.5 text-destructive">
                          <FolderX className="h-3 w-3" /> {t("vhosts.rootNotFound")}
                        </span>
                      )}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {v.enabled && v.maintenanceMode && (
                    <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">
                      {t("vhosts.maintenanceBadge")}
                    </span>
                  )}
                  <span
                    className={
                      "rounded-full px-2 py-0.5 text-xs font-medium " +
                      (v.enabled ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")
                    }
                  >
                    {v.enabled ? t("vhosts.enabled") : t("vhosts.disabled")}
                  </span>
                  {expanded === v.name ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                {v.enabled ? (
                  <ConfirmDialog
                    trigger={
                      <Button size="sm" variant="destructive">
                        {t("vhosts.disable")}
                      </Button>
                    }
                    title={t("vhosts.disableConfirm.title", { name: v.name })}
                    description={t("vhosts.disableConfirm.description")}
                    confirmLabel={t("vhosts.disable")}
                    onConfirm={() => toggleVhost(v.name, v.enabled)}
                  />
                ) : (
                  <Button size="sm" variant="outline" onClick={() => toggleVhost(v.name, v.enabled)}>
                    {t("vhosts.enable")}
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
  const { t } = useTranslation("nginx");
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<ConfigBackupRun | null>(null);
  const [useDrive, setUseDrive] = useState(true);

  async function runBackup() {
    setRunning(true);
    try {
      const run = await apiJson<ConfigBackupRun>("/nginx/config/backup", {
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
        <DatabaseBackup className="h-4 w-4" /> {t("backup.title")}
      </CardTitle>
      <p className="text-xs text-muted-foreground">{t("backup.description")}</p>
      <div className="mt-3 flex items-center gap-3">
        <Button size="sm" disabled={running} onClick={runBackup}>
          {running ? t("backup.running") : t("backup.runNow")}
        </Button>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={useDrive} onChange={(e) => setUseDrive(e.target.checked)} />
          {t("backup.includeDrive")}
        </label>
      </div>
      {lastRun && (
        <p className={`mt-2 text-xs ${lastRun.status === "success" ? "text-primary" : "text-destructive"}`}>
          {lastRun.status === "success"
            ? t("backup.successWithSize", { size: lastRun.sizeBytes ? formatBytes(lastRun.sizeBytes) : "" }) +
              (lastRun.driveFileId ? t("backup.successDriveSuffix") : "")
            : t("backup.failed", { error: lastRun.error })}
        </p>
      )}
    </Card>
  );
}

function VhostDetailPanel({ name, onChanged }: { name: string; onChanged: () => void }) {
  const { t } = useTranslation("nginx");
  const [detail, setDetail] = useState<VhostDetail | null>(null);
  const [cert, setCert] = useState<CertStatus | null>(null);
  const [history, setHistory] = useState<ConfigSnapshot[] | null>(null);
  const [content, setContent] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [logType, setLogType] = useState<"access" | "error">("error");
  const [logChunk, setLogChunk] = useState<string | null>(null);
  const [initialLog, setInitialLog] = useState<string>("");
  const [accessibility, setAccessibility] = useState<VhostAccessibility | null>(null);
  const [checkingAccess, setCheckingAccess] = useState(false);
  const [errorSummary, setErrorSummary] = useState<VhostErrorSummary | null>(null);
  const [topPages, setTopPages] = useState<TopPageEntry[] | null>(null);
  const [visitors, setVisitors] = useState<VisitorStats | null>(null);

  async function load() {
    const [d, c, h] = await Promise.all([
      apiJson<VhostDetail>(`/nginx/vhosts/${name}`),
      apiJson<CertStatus>(`/nginx/vhosts/${name}/cert`),
      apiJson<ConfigSnapshot[]>(`/nginx/vhosts/${name}/history`),
    ]);
    setDetail(d);
    setContent(d.rawConfig);
    setCert(c);
    setHistory(h);
  }

  async function checkAccess() {
    setCheckingAccess(true);
    try {
      setAccessibility(await apiJson<VhostAccessibility>(`/nginx/vhosts/${name}/accessibility`));
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
    apiJson<VhostErrorSummary>(`/nginx/vhosts/${name}/errors?window=24&limit=20`)
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
          <p className="mb-1 text-xs font-medium text-muted-foreground">{t("detail.certificate")}</p>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${certBadgeClass(cert.daysRemaining)}`}>
            {cert.found
              ? cert.daysRemaining != null
                ? t("detail.certExpires", { days: cert.daysRemaining })
                : t("detail.certPresent")
              : t("detail.certAbsent")}
          </span>
          {cert.subject && <p className="mt-1 text-xs text-muted-foreground">{cert.subject}</p>}
        </div>
      )}

      <div>
        <p className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <Globe className="h-3.5 w-3.5" /> {t("detail.accessibility")}
        </p>
        {accessibility ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span
              className={
                "rounded-full px-2 py-0.5 font-medium " +
                (accessibility.reachable ? "bg-primary/15 text-primary" : "bg-destructive/15 text-destructive")
              }
            >
              {accessibility.reachable
                ? t("detail.accessible", { statusCode: accessibility.statusCode })
                : t("detail.inaccessible")}
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
              {checkingAccess ? t("detail.testing") : t("detail.retest")}
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t("detail.testInProgress")}</p>
        )}
        {accessibility?.error && <p className="mt-1 text-xs text-destructive">{accessibility.error}</p>}
      </div>

      <div>
        <p className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <Users className="h-3.5 w-3.5" /> {t("detail.traffic")}
        </p>
        {visitors ? (
          <p className="text-xs text-muted-foreground">
            {t("detail.uniqueVisitors", { count: visitors.uniqueIps, requests: visitors.totalRequests })}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">{t("detail.noLogData")}</p>
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
          <AlertTriangle className="h-3.5 w-3.5" /> {t("detail.recentErrors")}
        </p>
        {errorSummary ? (
          errorSummary.recentCount === 0 ? (
            <p className="text-xs text-muted-foreground">{t("detail.noRecentErrors")}</p>
          ) : (
            <div className="flex flex-col gap-1">
              <p className="text-xs text-muted-foreground">{t("detail.errorCount", { count: errorSummary.recentCount })}</p>
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
          <p className="text-xs text-muted-foreground">{t("status.loading")}</p>
        )}
      </div>

      <div>
        <p className="mb-1 text-xs font-medium text-muted-foreground">{t("detail.rawConfigTitle")}</p>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
          className="h-56 w-full resize-y rounded-md border border-border bg-black/90 p-2 font-mono text-xs text-green-400 outline-none focus:ring-2 focus:ring-primary"
        />
        {saveError && <p className="mt-1 text-xs text-destructive">{saveError}</p>}
        <div className="mt-2 flex gap-2">
          <Button size="sm" disabled={saving} onClick={save}>
            {saving ? t("detail.saving") : t("detail.save")}
          </Button>
          <GuidedConfigEditorDialog
            mode="edit"
            vhostName={name}
            content={content}
            trigger={
              <Button size="sm" variant="outline">
                <Wand2 className="h-3.5 w-3.5" /> {t("detail.guidedEditor")}
              </Button>
            }
            onApply={(newContent) => setContent(newContent)}
          />
        </div>
      </div>

      {history && history.length > 0 && (
        <div>
          <p className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <History className="h-3.5 w-3.5" /> {t("detail.history")}
          </p>
          <div className="flex flex-col gap-1">
            {history.map((h) => (
              <div key={h.id} className="flex items-center justify-between rounded-md border border-border p-2 text-xs">
                <span>{new Date(h.createdAt).toLocaleString()}</span>
                <ConfirmDialog
                  trigger={
                    <Button size="sm" variant="outline">
                      {t("detail.restore")}
                    </Button>
                  }
                  title={t("detail.restoreConfirm.title")}
                  description={t("detail.restoreConfirm.description")}
                  confirmLabel={t("detail.restore")}
                  onConfirm={() => restoreSnapshot(h.id)}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="mb-1 flex gap-1">
          {(["access", "error"] as const).map((tabKey) => (
            <button
              key={tabKey}
              onClick={() => setLogType(tabKey)}
              className={
                "rounded-md px-2 py-1 text-xs font-medium " +
                (logType === tabKey ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")
              }
            >
              {tabKey === "access" ? t("detail.tabAccess") : t("detail.tabErrors")}
            </button>
          ))}
        </div>
        <LiveLogPanel chunk={logChunk} initialText={initialLog} />
      </div>
    </div>
  );
}

const DEFAULT_GUIDED_MODEL: GuidedFormModel = {
  sslEnabled: false,
  certPath: null,
  certKeyPath: null,
  clientMaxBodySize: null,
  headers: {
    frameOptions: false,
    contentTypeOptions: false,
    referrerPolicy: false,
    hsts: false,
    xssProtection: false,
    permissionsPolicy: false,
    contentSecurityPolicy: false,
  },
  mode: "root",
  rootPath: null,
  proxyPassTarget: null,
  tls: { protocols: null, ciphers: null, sessionCache: null, sessionTimeout: null },
  gzip: { enabled: false, types: null },
  locations: { blockDotfiles: false, cacheStaticAssets: false, spaFallback: false },
};

type GuidedConfigEditorDialogProps =
  | {
      mode: "edit";
      vhostName: string;
      content: string;
      trigger: React.ReactNode;
      onApply: (newContent: string) => void;
    }
  | {
      mode: "create";
      trigger: React.ReactNode;
      onCreated: () => void;
    };

/**
 * Guided editor for the v1 field set (SSL toggle + cert paths,
 * client_max_body_size, common security headers, root/proxy_pass mode) —
 * checkboxes/inputs instead of hand-writing nginx directives, with a short
 * explanation under each field. Never writes anything on its own: in "edit"
 * mode it only produces a new candidate `content` string handed back to the
 * parent via onApply (the existing "Enregistrer" button does the actual
 * save through the already-validated PUT .../config path); in "create" mode
 * it calls POST /nginx/vhosts directly since there's no existing file/save
 * button to defer to.
 */
function HeaderCheckbox({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2">
      <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="block">{label}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}

/**
 * Cert import UI for the guided editor's SSL section — only shown in "edit"
 * mode (a real vhostName is required to key the managed-certs folder; a
 * brand-new vhost doesn't have one yet). Two independent paths: paste raw
 * PEM text, or upload cert/key files — both land on the same backend
 * endpoint family and, on success, overwrite certPath/certKeyPath in the
 * form model so the admin doesn't have to copy the resulting paths by hand.
 */
function CertImportPanel({
  vhostName,
  onImported,
}: {
  vhostName: string;
  onImported: (result: { certPath: string; keyPath: string }) => void;
}) {
  const [mode, setMode] = useState<"closed" | "paste" | "upload">("closed");
  const [certPem, setCertPem] = useState("");
  const [keyPem, setKeyPem] = useState("");
  const [certFile, setCertFile] = useState<File | null>(null);
  const [keyFile, setKeyFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function submitPaste() {
    setBusy(true);
    setError(null);
    setSuccess(false);
    try {
      const result = await apiJson<{ certPath: string; keyPath: string }>("/nginx/cert-paths/import-text", {
        method: "POST",
        body: JSON.stringify({ vhostName, certPem, keyPem }),
      });
      onImported(result);
      setSuccess(true);
      setCertPem("");
      setKeyPem("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitUpload() {
    if (!certFile || !keyFile) return;
    setBusy(true);
    setError(null);
    setSuccess(false);
    try {
      const form = new FormData();
      form.append("vhostName", vhostName);
      form.append("cert", certFile);
      form.append("key", keyFile);
      const res = await apiFetch("/nginx/cert-paths/import-file", { method: "POST", body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "import_failed" }));
        throw new Error(body.error ?? "import_failed");
      }
      const result = await res.json();
      onImported(result);
      setSuccess(true);
      setCertFile(null);
      setKeyFile(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (mode === "closed") {
    return (
      <div className="mt-2 flex gap-2">
        <Button size="sm" variant="outline" onClick={() => setMode("paste")}>
          Coller un certificat
        </Button>
        <Button size="sm" variant="outline" onClick={() => setMode("upload")}>
          <Upload className="h-3.5 w-3.5" /> Importer des fichiers
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-md border border-border p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium">{mode === "paste" ? "Coller le certificat et la clé" : "Importer les fichiers"}</p>
        <button type="button" onClick={() => setMode("closed")} className="text-muted-foreground hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {mode === "paste" && (
        <div className="flex flex-col gap-2">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Certificat (PEM, ex: fullchain.pem)</label>
            <textarea
              value={certPem}
              onChange={(e) => setCertPem(e.target.value)}
              rows={4}
              placeholder="-----BEGIN CERTIFICATE-----"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs font-mono outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Clé privée (PEM, ex: privkey.pem)</label>
            <textarea
              value={keyPem}
              onChange={(e) => setKeyPem(e.target.value)}
              rows={4}
              placeholder="-----BEGIN PRIVATE KEY-----"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs font-mono outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <Button size="sm" disabled={busy || !certPem.trim() || !keyPem.trim()} onClick={submitPaste}>
            {busy ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </div>
      )}

      {mode === "upload" && (
        <div className="flex flex-col gap-2">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Fichier certificat (.pem/.crt)</label>
            <input
              type="file"
              accept=".pem,.crt,.cer"
              onChange={(e) => setCertFile(e.target.files?.[0] ?? null)}
              className="w-full text-xs"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Fichier clé privée (.pem/.key)</label>
            <input
              type="file"
              accept=".pem,.key"
              onChange={(e) => setKeyFile(e.target.files?.[0] ?? null)}
              className="w-full text-xs"
            />
          </div>
          <Button size="sm" disabled={busy || !certFile || !keyFile} onClick={submitUpload}>
            {busy ? "Import en cours…" : "Importer"}
          </Button>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      {success && (
        <p className="mt-2 flex items-center gap-1 text-xs text-primary">
          <CheckCircle2 className="h-3.5 w-3.5" /> Certificat enregistré et chemins renseignés ci-dessus.
        </p>
      )}
    </div>
  );
}

function GuidedConfigEditorDialog(props: GuidedConfigEditorDialogProps) {
  const [open, setOpen] = useState(false);
  const [model, setModel] = useState<GuidedFormModel>(DEFAULT_GUIDED_MODEL);
  const [serverName, setServerName] = useState("");
  const [listenPort, setListenPort] = useState(80);
  const [newVhostName, setNewVhostName] = useState("");
  // Cert import (create mode) is keyed by the "Nom du fichier" field at
  // import time — if the admin edits that field afterward, the already-
  // filled certPath/certKeyPath silently point at the WRONG managed-cert
  // folder (data/nginx-certs/<old-name>/) unless flagged.
  const [certImportedForName, setCertImportedForName] = useState<string | null>(null);
  const [certCheck, setCertCheck] = useState<"idle" | "checking" | "found" | "missing">("idle");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setCertCheck("idle");
    if (props.mode === "edit") {
      apiJson<GuidedFormModel>(`/nginx/vhosts/${props.vhostName}/guided/parse`, {
        method: "POST",
        body: JSON.stringify({ content: props.content }),
      })
        .then(setModel)
        .catch((err) => setError((err as Error).message));
    } else {
      setModel(DEFAULT_GUIDED_MODEL);
      setServerName("");
      setListenPort(80);
      setNewVhostName("");
      setCertImportedForName(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function checkCertPath() {
    if (!model.certPath) return;
    setCertCheck("checking");
    try {
      const { exists } = await apiJson<{ exists: boolean }>(
        `/nginx/cert-paths/check?path=${encodeURIComponent(model.certPath)}`
      );
      setCertCheck(exists ? "found" : "missing");
    } catch {
      setCertCheck("missing");
    }
  }

  function applyImportedCertPaths(result: { certPath: string; keyPath: string }) {
    setCertCheck("idle");
    setModel((m) => ({ ...m, certPath: result.certPath, certKeyPath: result.keyPath }));
    if (props.mode === "create") setCertImportedForName(newVhostName.trim());
  }

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      if (props.mode === "edit") {
        const { content: newContent } = await apiJson<{ content: string }>(
          `/nginx/vhosts/${props.vhostName}/guided/apply`,
          { method: "POST", body: JSON.stringify({ content: props.content, model }) }
        );
        props.onApply(newContent);
        setOpen(false);
      } else {
        if (!newVhostName.trim() || !serverName.trim()) {
          setError("Nom de fichier et server_name requis.");
          return;
        }
        const { content } = await apiJson<{ content: string }>("/nginx/vhosts/guided/build", {
          method: "POST",
          body: JSON.stringify({ model, serverName: serverName.trim(), listenPort }),
        });
        await apiJson("/nginx/vhosts", {
          method: "POST",
          body: JSON.stringify({ name: newVhostName.trim(), content }),
        });
        props.onCreated();
        setOpen(false);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>{props.trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[92vw] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-border bg-card p-4 shadow-xl outline-none">
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-base font-semibold">
              {props.mode === "create" ? "Nouveau site — configuration guidée" : "Éditeur guidé"}
            </Dialog.Title>
            <Dialog.Close className="rounded-md p-1 hover:bg-muted" aria-label="Fermer">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <div className="mt-3 flex flex-col gap-4 text-sm">
            {props.mode === "create" && (
              <div className="flex flex-col gap-2">
                <div>
                  <label className="mb-1 block text-xs font-medium">Nom du fichier (sites-available)</label>
                  <input
                    type="text"
                    value={newVhostName}
                    onChange={(e) => setNewVhostName(e.target.value)}
                    placeholder="mon-site"
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">server_name</label>
                  <input
                    type="text"
                    value={serverName}
                    onChange={(e) => setServerName(e.target.value)}
                    placeholder="exemple.fr www.exemple.fr"
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">Port d'écoute</label>
                  <input
                    type="number"
                    value={listenPort}
                    onChange={(e) => setListenPort(Number(e.target.value) || 80)}
                    className="w-32 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="flex items-center gap-2 font-medium">
                <input
                  type="checkbox"
                  checked={model.sslEnabled}
                  onChange={(e) => setModel((m) => ({ ...m, sslEnabled: e.target.checked }))}
                />
                Activer SSL (HTTPS)
              </label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Active HTTPS pour ce site en référençant un certificat et sa clé déjà présents sur le serveur.
              </p>
              {model.sslEnabled && (
                <div className="mt-2 flex flex-col gap-2 pl-6">
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">Chemin du certificat</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={model.certPath ?? ""}
                        onChange={(e) => {
                          setCertCheck("idle");
                          setModel((m) => ({ ...m, certPath: e.target.value || null }));
                        }}
                        placeholder="/etc/letsencrypt/live/exemple.fr/fullchain.pem"
                        className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-xs font-mono outline-none focus:ring-2 focus:ring-primary"
                      />
                      <Button size="sm" variant="outline" disabled={!model.certPath} onClick={checkCertPath}>
                        Vérifier
                      </Button>
                    </div>
                    {certCheck === "checking" && <p className="mt-1 text-xs text-muted-foreground">Vérification…</p>}
                    {certCheck === "found" && (
                      <p className="mt-1 flex items-center gap-1 text-xs text-primary">
                        <CheckCircle2 className="h-3 w-3" /> Fichier trouvé.
                      </p>
                    )}
                    {certCheck === "missing" && (
                      <p className="mt-1 flex items-center gap-1 text-xs text-destructive">
                        <XCircle className="h-3 w-3" /> Fichier introuvable à cet emplacement.
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">Chemin de la clé privée</label>
                    <input
                      type="text"
                      value={model.certKeyPath ?? ""}
                      onChange={(e) => setModel((m) => ({ ...m, certKeyPath: e.target.value || null }))}
                      placeholder="/etc/letsencrypt/live/exemple.fr/privkey.pem"
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs font-mono outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  {props.mode === "edit" ? (
                    <CertImportPanel vhostName={props.vhostName} onImported={applyImportedCertPaths} />
                  ) : newVhostName.trim() ? (
                    <>
                      {certImportedForName && certImportedForName !== newVhostName.trim() && (
                        <p className="mt-2 flex items-center gap-1 text-xs text-warning">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          Le certificat importé était lié au nom « {certImportedForName} » — réimportez-le pour « {newVhostName.trim()} » avant d'enregistrer.
                        </p>
                      )}
                      <CertImportPanel vhostName={newVhostName.trim()} onImported={applyImportedCertPaths} />
                    </>
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Renseignez le nom du fichier ci-dessus pour pouvoir importer un certificat.
                    </p>
                  )}
                </div>
              )}
            </div>

            <div>
              <label className="mb-1 block font-medium">Taille maximale des requêtes</label>
              <p className="mb-1 text-xs text-muted-foreground">
                Limite la taille des fichiers/formulaires envoyés par les visiteurs (ex : 20m pour 20 Mo). Laisser
                vide pour garder la valeur par défaut de Nginx (1 Mo).
              </p>
              <input
                type="text"
                value={model.clientMaxBodySize ?? ""}
                onChange={(e) => setModel((m) => ({ ...m, clientMaxBodySize: e.target.value || null }))}
                placeholder="20m"
                className="w-32 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div>
              <p className="mb-1 font-medium">En-têtes de sécurité</p>
              <div className="flex flex-col gap-2">
                <HeaderCheckbox
                  label="X-Frame-Options"
                  description="Empêche le site d'être affiché dans un iframe sur un autre domaine (anti-clickjacking)."
                  checked={model.headers.frameOptions}
                  onChange={(v) => setModel((m) => ({ ...m, headers: { ...m.headers, frameOptions: v } }))}
                />
                <HeaderCheckbox
                  label="X-Content-Type-Options"
                  description="Empêche le navigateur de deviner le type d'un fichier différemment de ce que déclare le serveur."
                  checked={model.headers.contentTypeOptions}
                  onChange={(v) => setModel((m) => ({ ...m, headers: { ...m.headers, contentTypeOptions: v } }))}
                />
                <HeaderCheckbox
                  label="Referrer-Policy"
                  description="Limite les informations envoyées aux autres sites quand un visiteur clique sur un lien sortant."
                  checked={model.headers.referrerPolicy}
                  onChange={(v) => setModel((m) => ({ ...m, headers: { ...m.headers, referrerPolicy: v } }))}
                />
                <HeaderCheckbox
                  label="Strict-Transport-Security (HSTS)"
                  description="Force les navigateurs à toujours utiliser HTTPS pour ce site. À activer seulement si SSL est bien configuré."
                  checked={model.headers.hsts}
                  onChange={(v) => setModel((m) => ({ ...m, headers: { ...m.headers, hsts: v } }))}
                />
                <HeaderCheckbox
                  label="X-XSS-Protection"
                  description="Ancienne protection navigateur contre les attaques XSS réfléchies (dépréciée mais encore acceptée)."
                  checked={model.headers.xssProtection}
                  onChange={(v) => setModel((m) => ({ ...m, headers: { ...m.headers, xssProtection: v } }))}
                />
                <HeaderCheckbox
                  label="Permissions-Policy"
                  description="Désactive l'accès à la caméra, au micro, à la géolocalisation, etc. pour ce site."
                  checked={model.headers.permissionsPolicy}
                  onChange={(v) => setModel((m) => ({ ...m, headers: { ...m.headers, permissionsPolicy: v } }))}
                />
                <HeaderCheckbox
                  label="Content-Security-Policy"
                  description="Restreint les sources de scripts/styles autorisées (protection XSS avancée). Valeur générique de base — à adapter si le site charge des ressources externes (polices, CDN, etc.)."
                  checked={model.headers.contentSecurityPolicy}
                  onChange={(v) => setModel((m) => ({ ...m, headers: { ...m.headers, contentSecurityPolicy: v } }))}
                />
              </div>
            </div>

            {model.sslEnabled && (
              <div>
                <p className="mb-1 font-medium">TLS avancé</p>
                <p className="mb-1 text-xs text-muted-foreground">
                  Réglages optionnels pour durcir/aligner la configuration TLS. Laisser vide pour garder les valeurs
                  par défaut de Nginx. Les valeurs se collent généralement depuis un générateur externe (ex :
                  Mozilla SSL Config Generator).
                </p>
                <div className="flex flex-col gap-2">
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">Protocoles (ssl_protocols)</label>
                    <input
                      type="text"
                      value={model.tls.protocols ?? ""}
                      onChange={(e) => setModel((m) => ({ ...m, tls: { ...m.tls, protocols: e.target.value || null } }))}
                      placeholder="TLSv1.2 TLSv1.3"
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs font-mono outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">Suites de chiffrement (ssl_ciphers)</label>
                    <input
                      type="text"
                      value={model.tls.ciphers ?? ""}
                      onChange={(e) => setModel((m) => ({ ...m, tls: { ...m.tls, ciphers: e.target.value || null } }))}
                      placeholder="ECDHE-ECDSA-AES128-GCM-SHA256:..."
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs font-mono outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="mb-1 block text-xs text-muted-foreground">Cache de session</label>
                      <input
                        type="text"
                        value={model.tls.sessionCache ?? ""}
                        onChange={(e) =>
                          setModel((m) => ({ ...m, tls: { ...m.tls, sessionCache: e.target.value || null } }))
                        }
                        placeholder="shared:SSL:10m"
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs font-mono outline-none focus:ring-2 focus:ring-primary"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="mb-1 block text-xs text-muted-foreground">Durée de session</label>
                      <input
                        type="text"
                        value={model.tls.sessionTimeout ?? ""}
                        onChange={(e) =>
                          setModel((m) => ({ ...m, tls: { ...m.tls, sessionTimeout: e.target.value || null } }))
                        }
                        placeholder="1d"
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs font-mono outline-none focus:ring-2 focus:ring-primary"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div>
              <label className="flex items-center gap-2 font-medium">
                <input
                  type="checkbox"
                  checked={model.gzip.enabled}
                  onChange={(e) => setModel((m) => ({ ...m, gzip: { ...m.gzip, enabled: e.target.checked } }))}
                />
                Compression Gzip
              </label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Compresse les réponses avant envoi pour accélérer le chargement (texte, CSS, JS, JSON...).
              </p>
              {model.gzip.enabled && (
                <input
                  type="text"
                  value={model.gzip.types ?? ""}
                  onChange={(e) => setModel((m) => ({ ...m, gzip: { ...m.gzip, types: e.target.value || null } }))}
                  placeholder="text/plain text/css application/javascript application/json"
                  className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-xs font-mono outline-none focus:ring-2 focus:ring-primary"
                />
              )}
            </div>

            <div>
              <p className="mb-1 font-medium">Blocs de contenu prédéfinis</p>
              <p className="mb-1 text-xs text-muted-foreground">
                Modèles courants prêts à l'emploi — pas de saisie libre, pour éviter une erreur de syntaxe dans un
                bloc <span className="font-mono">location</span>.
              </p>
              <div className="flex flex-col gap-2">
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={model.locations.blockDotfiles}
                    onChange={(e) =>
                      setModel((m) => ({ ...m, locations: { ...m.locations, blockDotfiles: e.target.checked } }))
                    }
                  />
                  <span>
                    <span className="block">Bloquer les fichiers cachés (.git, .htaccess...)</span>
                    <span className="block text-xs text-muted-foreground">
                      Interdit l'accès direct aux fichiers/dossiers sensibles commençant par un point.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={model.locations.cacheStaticAssets}
                    onChange={(e) =>
                      setModel((m) => ({ ...m, locations: { ...m.locations, cacheStaticAssets: e.target.checked } }))
                    }
                  />
                  <span>
                    <span className="block">Cache long pour /assets/</span>
                    <span className="block text-xs text-muted-foreground">
                      Cache navigateur d'un an pour les fichiers statiques versionnés (JS/CSS avec hash dans le nom,
                      généré par Vite/Webpack).
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={model.locations.spaFallback}
                    onChange={(e) =>
                      setModel((m) => ({ ...m, locations: { ...m.locations, spaFallback: e.target.checked } }))
                    }
                  />
                  <span>
                    <span className="block">Fallback SPA (React/Vue/Vite)</span>
                    <span className="block text-xs text-muted-foreground">
                      Toutes les routes inconnues renvoient index.html — nécessaire pour une application une-page
                      avec routage côté client.
                    </span>
                  </span>
                </label>
              </div>
            </div>

            <div>
              <p className="mb-1 font-medium">Mode de service</p>
              <p className="mb-1 text-xs text-muted-foreground">
                « Fichiers statiques » sert directement un dossier du serveur ; « Proxy » relaie les requêtes vers
                une autre adresse (ex : une application Node.js/Docker sur un port local).
              </p>
              <div className="flex gap-4">
                <label className="flex items-center gap-1.5 text-xs">
                  <input
                    type="radio"
                    checked={model.mode === "root"}
                    onChange={() => setModel((m) => ({ ...m, mode: "root" }))}
                  />
                  Fichiers statiques
                </label>
                <label className="flex items-center gap-1.5 text-xs">
                  <input
                    type="radio"
                    checked={model.mode === "proxy_pass"}
                    onChange={() => setModel((m) => ({ ...m, mode: "proxy_pass" }))}
                  />
                  Proxy
                </label>
              </div>
              {model.mode === "root" && (
                <input
                  type="text"
                  value={model.rootPath ?? ""}
                  onChange={(e) => setModel((m) => ({ ...m, rootPath: e.target.value || null }))}
                  placeholder="/var/www/mon-site"
                  className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-xs font-mono outline-none focus:ring-2 focus:ring-primary"
                />
              )}
              {model.mode === "proxy_pass" && (
                <input
                  type="text"
                  value={model.proxyPassTarget ?? ""}
                  onChange={(e) => setModel((m) => ({ ...m, proxyPassTarget: e.target.value || null }))}
                  placeholder="http://127.0.0.1:3000"
                  className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-xs font-mono outline-none focus:ring-2 focus:ring-primary"
                />
              )}
            </div>

            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="outline" size="sm" disabled={saving}>
                Annuler
              </Button>
            </Dialog.Close>
            <Button size="sm" disabled={saving} onClick={submit}>
              {saving ? "..." : props.mode === "create" ? "Créer le site" : "Appliquer"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

