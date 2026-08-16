import { useEffect, useMemo, useState } from "react";
import type { OsInfo, InstalledPackage, UpgradablePackage, OsJob } from "@pwa-admin/shared";
import { useTranslation } from "react-i18next";
import { apiJson } from "@/lib/api";
import { useWsChannel } from "@/lib/ws";
import { Card, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { LiveLogPanel } from "@/components/LiveLogPanel";
import { AlertTriangle, PackageCheck, Lock, Unlock, RefreshCw } from "lucide-react";

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${days}j ${hours}h ${minutes}m`;
}

export function OsSystem() {
  const { t } = useTranslation("os");
  const [info, setInfo] = useState<OsInfo | null>(null);
  const [upgradable, setUpgradable] = useState<UpgradablePackage[] | null>(null);
  const [held, setHeld] = useState<string[] | null>(null);
  const [jobs, setJobs] = useState<OsJob[] | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [fullUpgradeAck, setFullUpgradeAck] = useState(false);
  const [upgradeMode, setUpgradeMode] = useState<"upgrade" | "full-upgrade">("upgrade");
  const [error, setError] = useState<string | null>(null);

  async function loadAll() {
    try {
      const [i, u, h, j] = await Promise.all([
        apiJson<OsInfo>("/os/info"),
        apiJson<UpgradablePackage[]>("/os/packages/upgradable"),
        apiJson<string[]>("/os/packages/held"),
        apiJson<OsJob[]>("/os/jobs"),
      ]);
      setInfo(i);
      setUpgradable(u);
      setHeld(h);
      setJobs(j);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function checkUpdates() {
    setChecking(true);
    try {
      await apiJson("/os/update-check", { method: "POST" });
      await loadAll();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setChecking(false);
    }
  }

  async function startUpgrade() {
    try {
      const { jobId } = await apiJson<{ jobId: string }>("/os/upgrade", {
        method: "POST",
        body: JSON.stringify({ mode: upgradeMode }),
      });
      setActiveJobId(jobId);
      setFullUpgradeAck(false);
      await loadAll();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function unhold(name: string) {
    await apiJson(`/os/packages/${name}/unhold`, { method: "POST" });
    await loadAll();
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <Card className="text-sm text-destructive">{error}</Card>}

      <Card>
        <CardTitle>{t("system.title")}</CardTitle>
        {info ? (
          <div className="text-sm">
            <p>{info.distro} {info.release}</p>
            <p className="text-xs text-muted-foreground">
              {t("system.kernel", { kernel: info.kernel, arch: info.arch, hostname: info.hostname })}
            </p>
            <p className="text-xs text-muted-foreground">{t("system.uptime", { uptime: formatUptime(info.uptimeSeconds) })}</p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("system.loading")}</p>
        )}
      </Card>

      {info?.rebootRequired && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-medium">{t("rebootRequired.title")}</p>
            {info.rebootRequiredPackages.length > 0 && (
              <p className="text-xs">{info.rebootRequiredPackages.join(", ")}</p>
            )}
          </div>
        </div>
      )}

      <Card>
        <CardTitle>{t("upgrades.title")}</CardTitle>
        <p className="text-sm">{upgradable ? t("upgrades.count", { count: upgradable.length }) : t("upgrades.loading")}</p>
        {upgradable && upgradable.length > 0 && (
          <div className="mt-2 flex max-h-56 flex-col gap-1 overflow-y-auto">
            {upgradable.map((p) => (
              <div key={p.name} className="flex items-center justify-between text-xs">
                <span className="truncate font-mono">{p.name}</span>
                <span className="shrink-0 text-muted-foreground">
                  {p.currentVersion} → {p.availableVersion}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={checking} onClick={checkUpdates}>
            <RefreshCw className="h-3.5 w-3.5" /> {t("upgrades.check")}
          </Button>
          <ConfirmDialog
            trigger={
              <Button size="sm" variant="destructive" disabled={!upgradable || upgradable.length === 0}>
                <PackageCheck className="h-3.5 w-3.5" /> {t("upgrades.upgrade")}
              </Button>
            }
            title={t("upgrades.confirmTitle")}
            description={
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="radio"
                    checked={upgradeMode === "upgrade"}
                    onChange={() => setUpgradeMode("upgrade")}
                  />
                  {t("upgrades.modeStandard")}
                </label>
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="radio"
                    checked={upgradeMode === "full-upgrade"}
                    onChange={() => setUpgradeMode("full-upgrade")}
                  />
                  {t("upgrades.modeFull")}
                </label>
                {upgradeMode === "full-upgrade" && (
                  <label className="flex items-center gap-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      checked={fullUpgradeAck}
                      onChange={(e) => setFullUpgradeAck(e.target.checked)}
                    />
                    {t("upgrades.fullAck")}
                  </label>
                )}
              </div>
            }
            confirmLabel={t("upgrades.confirmLaunch")}
            onConfirm={() => {
              if (upgradeMode === "full-upgrade" && !fullUpgradeAck) return;
              return startUpgrade();
            }}
          />
        </div>
      </Card>

      {activeJobId && (
        <Card>
          <CardTitle>{t("job.titlePrefix", { jobId: activeJobId })}</CardTitle>
          <OsUpgradeJobPanel jobId={activeJobId} onFinished={loadAll} />
        </Card>
      )}

      <Card>
        <CardTitle>{t("held.title")}</CardTitle>
        {held && held.length > 0 ? (
          <div className="flex flex-col gap-1">
            {held.map((name) => (
              <div key={name} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1 font-mono text-xs">
                  <Lock className="h-3.5 w-3.5" /> {name}
                </span>
                <Button size="sm" variant="outline" onClick={() => unhold(name)}>
                  <Unlock className="h-3.5 w-3.5" /> {t("held.release")}
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("held.empty")}</p>
        )}
      </Card>

      <Card>
        <CardTitle>{t("jobHistory.title")}</CardTitle>
        {jobs && jobs.length > 0 ? (
          <div className="flex flex-col gap-1">
            {jobs.map((j) => (
              <button
                key={j.jobId}
                onClick={() => setActiveJobId(j.jobId)}
                className="flex items-center justify-between rounded-md border border-border p-2 text-left text-xs hover:bg-muted"
              >
                <span>
                  {j.kind} · {new Date(j.startedAt).toLocaleString()}
                </span>
                <span
                  className={
                    "rounded-full px-2 py-0.5 font-medium " +
                    (j.status === "succeeded"
                      ? "bg-primary/15 text-primary"
                      : j.status === "failed"
                        ? "bg-destructive/15 text-destructive"
                        : "bg-warning/15 text-warning")
                  }
                >
                  {j.status}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("jobHistory.empty")}</p>
        )}
      </Card>

      <InstalledPackagesCard />
    </div>
  );
}

function OsUpgradeJobPanel({ jobId, onFinished }: { jobId: string; onFinished: () => void }) {
  const { t } = useTranslation("os");
  const [chunk, setChunk] = useState<string | null>(null);
  const [result, setResult] = useState<{ exitCode: number; status: string } | null>(null);

  useWsChannel(
    "os.upgrade",
    (frame) => {
      if (typeof frame.data === "string") {
        setChunk(frame.data);
      } else if (frame.data && typeof frame.data === "object" && (frame.data as any).done) {
        const d = frame.data as { exitCode: number; status: string };
        setResult(d);
        onFinished();
      }
    },
    { jobId }
  );

  return (
    <div className="flex flex-col gap-2">
      <LiveLogPanel chunk={chunk} />
      {result && (
        <p className={`text-xs font-medium ${result.status === "succeeded" ? "text-primary" : "text-destructive"}`}>
          {t("job.finished", { status: result.status, exitCode: result.exitCode })}
        </p>
      )}
    </div>
  );
}

function InstalledPackagesCard() {
  const { t } = useTranslation("os");
  const [packages, setPackages] = useState<InstalledPackage[] | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    apiJson<InstalledPackage[]>("/os/packages")
      .then(setPackages)
      .catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    if (!packages) return [];
    const f = filter.trim().toLowerCase();
    if (!f) return packages;
    return packages.filter((p) => p.name.toLowerCase().includes(f));
  }, [packages, filter]);

  return (
    <Card>
      <CardTitle>{t("installedPackages.title", { count: packages?.length ?? "…" })}</CardTitle>
      <input
        type="text"
        placeholder={t("installedPackages.filterPlaceholder")}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="mb-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
      />
      <div className="max-h-72 overflow-y-auto">
        {filtered.slice(0, 300).map((p) => (
          <div key={p.name} className="flex items-center justify-between border-b border-border/50 py-1 text-xs last:border-0">
            <span className="truncate font-mono">{p.name}</span>
            <span className="shrink-0 text-muted-foreground">{p.version}</span>
          </div>
        ))}
        {filtered.length > 300 && (
          <p className="pt-1 text-xs text-muted-foreground">{t("installedPackages.more", { count: filtered.length - 300 })}</p>
        )}
        {packages && filtered.length === 0 && <p className="py-2 text-xs text-muted-foreground">{t("installedPackages.empty")}</p>}
      </div>
    </Card>
  );
}
