import { cn } from "@/lib/utils";

export type StatusLedTone = "ok" | "warning" | "critical" | "idle";

const TONE_STYLES: Record<StatusLedTone, string> = {
  ok: "bg-primary shadow-[0_0_0_3px_rgba(var(--primary-rgb),0.18),0_0_10px_1px_rgba(var(--primary-rgb),0.55)]",
  warning:
    "bg-warning shadow-[0_0_0_3px_rgba(var(--warning-rgb),0.2),0_0_10px_1px_rgba(var(--warning-rgb),0.6)] animate-pulse",
  critical:
    "bg-destructive shadow-[0_0_0_3px_rgba(var(--destructive-rgb),0.22),0_0_10px_2px_rgba(var(--destructive-rgb),0.65)] animate-pulse",
  idle: "bg-muted-foreground/40",
};

/**
 * Voyant façon panneau d'instrument : halo lumineux à l'arrêt, pulse doux
 * uniquement en warning/critical (jamais en ok/idle, pour ne pas transformer
 * chaque carte en distraction permanente).
 */
export function StatusLed({ tone, className }: { tone: StatusLedTone; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full motion-reduce:animate-none", TONE_STYLES[tone], className)}
    />
  );
}
