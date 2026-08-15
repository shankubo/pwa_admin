import { useState } from "react";
import { DatabaseBackup, RotateCcw, Shuffle, Wrench } from "lucide-react";
import { ActionTile } from "@/components/wizard/ActionTile";
import { BackupWizardFlow } from "@/components/wizard/flows/BackupWizardFlow";
import { RestoreWizardFlow } from "@/components/wizard/flows/RestoreWizardFlow";
import { MigrationWizardFlow } from "@/components/wizard/flows/MigrationWizardFlow";
import { AutresWizardList } from "@/components/wizard/flows/AutresWizardList";

type WizardAction = "backup" | "restore" | "migration" | "autres";

export function Wizard() {
  const [action, setAction] = useState<WizardAction | null>(null);

  if (action === "backup") return <BackupWizardFlow onExit={() => setAction(null)} />;
  if (action === "restore") return <RestoreWizardFlow onExit={() => setAction(null)} />;
  if (action === "migration") return <MigrationWizardFlow onExit={() => setAction(null)} />;
  if (action === "autres") return <AutresWizardList onExit={() => setAction(null)} />;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Assistant</h2>
        <p className="text-sm text-muted-foreground">Étape 1 — Que souhaitez-vous faire ?</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <ActionTile
          icon={DatabaseBackup}
          label="Sauvegarde"
          description="Créer une sauvegarde d'un site ou d'une donnée du serveur."
          enabled
          onClick={() => setAction("backup")}
        />
        <ActionTile
          icon={RotateCcw}
          label="Restauration"
          description="Restaurer une sauvegarde existante."
          enabled
          onClick={() => setAction("restore")}
        />
        <ActionTile
          icon={Shuffle}
          label="Migration"
          description="Créer ou restaurer un instantané complet du serveur, pour le déplacer ou le reconstruire."
          enabled
          onClick={() => setAction("migration")}
        />
        <ActionTile
          icon={Wrench}
          label="Autres"
          description="Accéder à d'autres opérations d'administration."
          enabled
          onClick={() => setAction("autres")}
        />
      </div>
    </div>
  );
}
