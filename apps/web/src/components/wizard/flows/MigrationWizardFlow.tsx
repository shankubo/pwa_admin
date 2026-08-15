import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { SiteSummary, UsbStatus } from "@pwa-admin/shared";
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
      <WizardShell title="Migration" stepLabel="Étape 2 — Que voulez-vous faire ?" onBack={onExit}>
        <div className="grid grid-cols-2 gap-3">
          <ActionTile
            icon={Camera}
            label="Créer un instantané"
            description="Capturer le serveur (ou un site) pour le déplacer ou le reconstruire ailleurs."
            enabled
            onClick={() => setDirection("capture")}
          />
          <ActionTile
            icon={Download}
            label="Restaurer un instantané"
            description="Réinstaller un serveur depuis un instantané capturé précédemment."
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
      <WizardShell title="Migration" stepLabel="Étape 3 — Quelle portée ?" onBack={() => setDirection(null)}>
        <div className="grid grid-cols-2 gap-3">
          <ActionTile
            icon={Server}
            label="Serveur complet"
            description="Images/volumes Docker, bases de données, config Nginx, applications, paquets système."
            enabled
            onClick={() => { setScope("server"); setStage("destination"); }}
          />
          <ActionTile
            icon={Globe}
            label="Un site"
            description="Capture limitée à un site et à ses données."
            enabled
            onClick={() => setScope("site")}
          />
        </div>
        {scope === "site" && (
          <div className="flex flex-col gap-1">
            {sites === null && <p className="text-sm text-muted-foreground">Chargement…</p>}
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
      <WizardShell title="Migration" stepLabel="Étape 4 — Destination" onBack={() => setStage("source")}>
        {usbConfigured ? (
          <Card className="text-sm text-muted-foreground">
            L'instantané sera enregistré sur le disque USB de sauvegarde configuré.
          </Card>
        ) : (
          <Card className="flex items-center gap-2 text-sm text-warning">
            <AlertTriangle className="h-4 w-4" /> Aucun disque USB configuré comme sauvegarde.{" "}
            <button type="button" className="underline" onClick={() => navigate("/backups")}>
              Configurer
            </button>
          </Card>
        )}
        <Button size="sm" disabled={!usbConfigured} onClick={() => setStage("confirmation")}>
          Suivant
        </Button>
      </WizardShell>
    );
  }

  if (stage === "confirmation") {
    return (
      <WizardShell title="Migration" stepLabel="Étape 5 — Confirmation" onBack={() => setStage("destination")}>
        <Card className="flex flex-col gap-2 text-sm">
          <p><span className="text-muted-foreground">Portée : </span>{scope === "site" ? `Site ${selectedSite?.name}` : "Serveur complet"}</p>
          {scope === "server" && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={includeDuplicates}
                onChange={(e) => setIncludeDuplicates(e.target.checked)}
              />
              Inclure les conteneurs "-duplicate" (généralement inutile pour un nouveau serveur)
            </label>
          )}
        </Card>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button onClick={launch}>Démarrer</Button>
      </WizardShell>
    );
  }

  if (stage === "execution") {
    return (
      <WizardShell title="Migration" stepLabel="Étape 6 — Exécution">
        <Card className="flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Capture en cours…
        </Card>
      </WizardShell>
    );
  }

  // result
  return (
    <WizardShell title="Migration" stepLabel="Étape 7 — Résultat">
      {error && (
        <Card className="flex items-center gap-2 text-sm text-destructive">
          <XCircle className="h-4 w-4" /> {error}
        </Card>
      )}
      {!error && lastManifestId && (
        <Card className="flex items-center gap-2 text-sm">
          {lastStatus === "success" ? (
            <>
              <CheckCircle2 className="h-4 w-4 text-primary" /> Instantané capturé avec succès.
            </>
          ) : lastStatus === "failed" ? (
            <>
              <XCircle className="h-4 w-4 text-destructive" /> Échec de la capture.
            </>
          ) : (
            <>
              <CheckCircle2 className="h-4 w-4 text-primary" /> Capture terminée ({lastStatus}).
            </>
          )}
        </Card>
      )}
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => navigate("/backups")}>
          Voir dans Backups
        </Button>
        <Button variant="ghost" onClick={onExit}>
          Nouvelle opération
        </Button>
      </div>
    </WizardShell>
  );
}
