import { useNavigate } from "react-router-dom";
import { Globe, Package, Wrench, ShieldCheck, ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { WizardShell } from "@/components/wizard/WizardShell";

const LINKS = [
  { to: "/sites", label: "Sites & domaines", icon: Globe },
  { to: "/os", label: "Mises à jour système", icon: Package },
  { to: "/services", label: "Services (Docker/PM2/Tailscale)", icon: Wrench },
  { to: "/security", label: "Sécurité serveur", icon: ShieldCheck },
];

/** v1: a small, hand-picked list of existing Advanced-mode screens — not a
 * mirror of the full nav, which would defeat Easy Mode's simplification
 * purpose. Extending this list later is a one-line addition. */
export function AutresWizardList({ onExit }: { onExit: () => void }) {
  const navigate = useNavigate();
  return (
    <WizardShell title="Autres" stepLabel="Accéder à d'autres opérations d'administration" onBack={onExit}>
      <div className="flex flex-col gap-2">
        {LINKS.map(({ to, label, icon: Icon }) => (
          <Card key={to} className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm">
              <Icon className="h-4 w-4 text-primary" /> {label}
            </span>
            <Button size="sm" variant="outline" onClick={() => navigate(to)}>
              Ouvrir <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </Card>
        ))}
      </div>
    </WizardShell>
  );
}
