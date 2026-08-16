import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { SiteSummary, UsbStatus } from "@pwa-admin/shared";
import { useTranslation } from "react-i18next";
import { apiJson } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { WizardShell } from "@/components/wizard/WizardShell";
import { ActionTile } from "@/components/wizard/ActionTile";
import { useMigrationSnapshot } from "@/lib/useMigrationSnapshot";
import { Server, Globe, Camera, Download, CheckCircle2, XCircle, Loader2, AlertTriangle } from "lucide-react";

type WizardStage = "source" | "destination" | "confirmation" | "execution" | "result";
type Direction = "capture" | "restore" | null;
type Scope = "server" | "site" | null;

export function MigrationWizardFlow({ onExit }: { onExit: () => void }) {
  const { t } = useTranslation("wizard");
  const navigate = useNavigate();
  const [direction, setDirection] = useState<Direction>(null);
  const [stage, setStage] = useState<WizardStage>("source");
  const [scope, setScope] = useState<Scope>(null);
  const [sites, setSites] = useState<SiteSummary[] | null>(null);
  const [selectedSite, setSelectedSite] = useState<SiteSummary | null>(null);
  const [usbConfigured, setUsbConfigured] = useState(false);
  const [includeDuplicates, setIncludeDuplicates] = useState(false);

  const { starting, activeManifestId, error, startWholeServerSnapshot, startSiteSnapshot, snapshots } =
    useMigrationSnapshot();

  useEffect(() => {
    if (direction !== "restore") return;
    navigate("/restore");
  }, [direction, navigate]);

  useEffect(() => {
    apiJson<UsbStatus>("/backups/usb/status")
      .then((s) => setUsbConfigured(s.drives.some((d) => d.isBackupConfigured)))
      .catch(() => setUsbConfigured(false));
  }, []);

  useEffect(() => {
    if (scope !== "site" || sites) return;
    apiJson<SiteSummary[]>("/sites").then(setSites).catch(() => setSites([]));
  }, [scope, sites]);

  const lastManifestId = snapshots?.[0]?.manifestId ?? null;
  const lastStatus = snapshots?.[0]?.status ?? null;

  async function launch() {
    setStage("execution");
    try {
      if (scope === "site" && selectedSite) {
        await startSiteSnapshot(selectedSite.name);
      } else {
        await startWholeServerSnapshot(includeDuplicates);
      }
    } catch {
      // error already captured by the hook, surfaced on the result stage
    }
  }

  useEffect(() => {
    if (stage !== "execution") return;
    if (!starting && !activeManifestId) setStage("result");
  }, [stage, starting, activeManifestId]);

  if (direction === "restore") return null; // redirecting

  if (!direction) {
    return (
      <WizardShell title={t("actions.migration.label")} stepLabel={t("migrationFlow.step2Title")} onBack={onExit}>
        <div className="grid grid-cols-2 gap-3">
          <ActionTile
            icon={Camera}
            label={t("migrationFlow.captureSnapshot.label")}
            description={t("migrationFlow.captureSnapshot.description")}
            enabled
            onClick={() => setDirection("capture")}
          />
          <ActionTile
            icon={Download}
            label={t("migrationFlow.restoreSnapshot.label")}
            description={t("migrationFlow.restoreSnapshot.description")}
            enabled
            onClick={() => setDirection("restore")}
          />
        </div>
      </WizardShell>
    );
  }

  // direction === "capture"
  if (stage === "source") {
    return (
      <WizardShell title={t("actions.migration.label")} stepLabel={t("migrationFlow.step3Title")} onBack={() => setDirection(null)}>
        <div className="grid grid-cols-2 gap-3">
          <ActionTile
            icon={Server}
            label={t("migrationFlow.fullServer.label")}
            description={t("migrationFlow.fullServer.description")}
            enabled
            onClick={() => { setScope("server"); setStage("destination"); }}
          />
          <ActionTile
            icon={Globe}
            label={t("migrationFlow.singleSite.label")}
            description={t("migrationFlow.singleSite.description")}
            enabled
            onClick={() => setScope("site")}
          />
        </div>
        {scope === "site" && (
          <div className="flex flex-col gap-1">
            {sites === null && <p className="text-sm text-muted-foreground">{t("migrationFlow.loading")}</p>}
            {(sites ?? []).map((s) => (
              <button
                key={s.name}
                type="button"
                onClick={() => { setSelectedSite(s); setStage("destination"); }}
                className="rounded-md border border-border bg-background px-3 py-2 text-left text-sm hover:border-primary hover:bg-primary/5"
              >
                {s.name}
              </button>
            ))}
          </div>
        )}
      </WizardShell>
    );
  }

  if (stage === "destination") {
    return (
      <WizardShell title={t("actions.migration.label")} stepLabel={t("migrationFlow.step4Title")} onBack={() => setStage("source")}>
        {usbConfigured ? (
          <Card className="text-sm text-muted-foreground">{t("migrationFlow.usbConfigured")}</Card>
        ) : (
          <Card className="flex items-center gap-2 text-sm text-warning">
            <AlertTriangle className="h-4 w-4" /> {t("migrationFlow.usbNotConfigured")}{" "}
            <button type="button" className="underline" onClick={() => navigate("/backups")}>
              {t("migrationFlow.configureUsb")}
            </button>
          </Card>
        )}
        <Button size="sm" disabled={!usbConfigured} onClick={() => setStage("confirmation")}>
          {t("migrationFlow.next")}
        </Button>
      </WizardShell>
    );
  }

  if (stage === "confirmation") {
    return (
      <WizardShell title={t("actions.migration.label")} stepLabel={t("migrationFlow.step5Title")} onBack={() => setStage("destination")}>
        <Card className="flex flex-col gap-2 text-sm">
          <p>
            <span className="text-muted-foreground">{t("migrationFlow.scopeLabel")}</span>
            {scope === "site" ? t("migrationFlow.scopeSite", { name: selectedSite?.name }) : t("migrationFlow.scopeServer")}
          </p>
          {scope === "server" && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={includeDuplicates}
                onChange={(e) => setIncludeDuplicates(e.target.checked)}
              />
              {t("migrationFlow.includeDuplicates")}
            </label>
          )}
        </Card>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button onClick={launch}>{t("migrationFlow.start")}</Button>
      </WizardShell>
    );
  }

  if (stage === "execution") {
    return (
      <WizardShell title={t("actions.migration.label")} stepLabel={t("migrationFlow.step6Title")}>
        <Card className="flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("migrationFlow.capturing")}
        </Card>
      </WizardShell>
    );
  }

  // result
  return (
    <WizardShell title={t("actions.migration.label")} stepLabel={t("migrationFlow.step7Title")}>
      {error && (
        <Card className="flex items-center gap-2 text-sm text-destructive">
          <XCircle className="h-4 w-4" /> {error}
        </Card>
      )}
      {!error && lastManifestId && (
        <Card className="flex items-center gap-2 text-sm">
          {lastStatus === "success" ? (
            <>
              <CheckCircle2 className="h-4 w-4 text-primary" /> {t("migrationFlow.captureSuccess")}
            </>
          ) : lastStatus === "failed" ? (
            <>
              <XCircle className="h-4 w-4 text-destructive" /> {t("migrationFlow.captureFailed")}
            </>
          ) : (
            <>
              <CheckCircle2 className="h-4 w-4 text-primary" /> {t("migrationFlow.captureFinished", { status: lastStatus })}
            </>
          )}
        </Card>
      )}
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => navigate("/backups")}>
          {t("migrationFlow.viewInBackups")}
        </Button>
        <Button variant="ghost" onClick={onExit}>
          {t("migrationFlow.newOperation")}
        </Button>
      </div>
    </WizardShell>
  );
}
