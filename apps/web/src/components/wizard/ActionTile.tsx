import type { LucideIcon } from "lucide-react";

interface ActionTileProps {
  icon: LucideIcon;
  label: string;
  description: string;
  enabled: boolean;
  disabledReason?: string;
  onClick: () => void;
}

/** Large tappable tile used for the Wizard's Action stage (and by any wizard
 * flow's own source/destination choices) — generalized from Restore.tsx's
 * private SourceTile so it isn't redefined per-flow. */
export function ActionTile({ icon: Icon, label, description, enabled, disabledReason, onClick }: ActionTileProps) {
  return (
    <button
      type="button"
      disabled={!enabled}
      onClick={onClick}
      className={`flex flex-col items-center gap-2 rounded-lg border p-6 text-center transition-colors ${
        enabled
          ? "border-border bg-background hover:border-primary hover:bg-primary/5"
          : "cursor-not-allowed border-border/50 bg-muted/30 text-muted-foreground"
      }`}
    >
      <Icon className={`h-8 w-8 ${enabled ? "text-primary" : "text-muted-foreground"}`} />
      <span className="text-sm font-medium">{label}</span>
      <span className="text-xs text-muted-foreground">{enabled ? description : disabledReason ?? description}</span>
    </button>
  );
}
