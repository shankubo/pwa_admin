import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";

interface WizardShellProps {
  title: string;
  stepLabel: string;
  onBack?: () => void;
  children: ReactNode;
}

/** Shared back-button + step-label chrome for the Wizard's flows — the same
 * layout Restore.tsx hand-rolls inline, factored out so Backup/Restore/
 * Migration don't each redefine it. */
export function WizardShell({ title, stepLabel, onBack, children }: WizardShellProps) {
  const { t } = useTranslation("wizard");
  return (
    <div className="flex flex-col gap-4">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 self-start text-sm text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> {t("back")}
        </button>
      )}
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{stepLabel}</p>
      </div>
      {children}
    </div>
  );
}
