import { useState } from "react";
import { DatabaseBackup, RotateCcw, Shuffle, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ActionTile } from "@/components/wizard/ActionTile";
import { BackupWizardFlow } from "@/components/wizard/flows/BackupWizardFlow";
import { RestoreWizardFlow } from "@/components/wizard/flows/RestoreWizardFlow";
import { MigrationWizardFlow } from "@/components/wizard/flows/MigrationWizardFlow";
import { AutresWizardList } from "@/components/wizard/flows/AutresWizardList";

type WizardAction = "backup" | "restore" | "migration" | "autres";

export function Wizard() {
  const { t } = useTranslation("wizard");
  const [action, setAction] = useState<WizardAction | null>(null);

  if (action === "backup") return <BackupWizardFlow onExit={() => setAction(null)} />;
  if (action === "restore") return <RestoreWizardFlow onExit={() => setAction(null)} />;
  if (action === "migration") return <MigrationWizardFlow onExit={() => setAction(null)} />;
  if (action === "autres") return <AutresWizardList onExit={() => setAction(null)} />;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">{t("step1")}</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <ActionTile
          icon={DatabaseBackup}
          label={t("actions.backup.label")}
          description={t("actions.backup.description")}
          enabled
          onClick={() => setAction("backup")}
        />
        <ActionTile
          icon={RotateCcw}
          label={t("actions.restore.label")}
          description={t("actions.restore.description")}
          enabled
          onClick={() => setAction("restore")}
        />
        <ActionTile
          icon={Shuffle}
          label={t("actions.migration.label")}
          description={t("actions.migration.description")}
          enabled
          onClick={() => setAction("migration")}
        />
        <ActionTile
          icon={Wrench}
          label={t("actions.other.label")}
          description={t("actions.other.description")}
          enabled
          onClick={() => setAction("autres")}
        />
      </div>
    </div>
  );
}
