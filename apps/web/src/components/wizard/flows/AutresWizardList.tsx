import { useNavigate } from "react-router-dom";
import { Globe, Package, Wrench, ShieldCheck, ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { WizardShell } from "@/components/wizard/WizardShell";

/** v1: a small, hand-picked list of existing Advanced-mode screens — not a
 * mirror of the full nav, which would defeat Easy Mode's simplification
 * purpose. Extending this list later is a one-line addition. */
export function AutresWizardList({ onExit }: { onExit: () => void }) {
  const { t } = useTranslation("wizard");
  const navigate = useNavigate();

  const LINKS = [
    { to: "/sites", labelKey: "otherList.links.sites", icon: Globe },
    { to: "/os", labelKey: "otherList.links.osUpdates", icon: Package },
    { to: "/services", labelKey: "otherList.links.services", icon: Wrench },
    { to: "/security", labelKey: "otherList.links.security", icon: ShieldCheck },
  ] as const;

  return (
    <WizardShell title={t("actions.other.label")} stepLabel={t("actions.other.description")} onBack={onExit}>
      <div className="flex flex-col gap-2">
        {LINKS.map(({ to, labelKey, icon: Icon }) => (
          <Card key={to} className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm">
              <Icon className="h-4 w-4 text-primary" /> {t(labelKey)}
            </span>
            <Button size="sm" variant="outline" onClick={() => navigate(to)}>
              {t("otherList.open")} <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </Card>
        ))}
      </div>
    </WizardShell>
  );
}
