import { useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Button } from "./Button";
import { cn } from "@/lib/utils";

interface ConfirmDialogProps {
  /** Trigger element, usually a Button. */
  trigger: ReactNode;
  title: string;
  description?: ReactNode;
  /** If set, the user must type this exact text before confirming (e.g. "RESTORE"). */
  requireTypedConfirmation?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "destructive";
  onConfirm: () => void | Promise<void>;
}

export function ConfirmDialog({
  trigger,
  title,
  description,
  requireTypedConfirmation,
  confirmLabel = "Confirmer",
  cancelLabel = "Annuler",
  variant = "destructive",
  onConfirm,
}: ConfirmDialogProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [typedValue, setTypedValue] = useState("");

  const canConfirm = !requireTypedConfirmation || typedValue === requireTypedConfirmation;

  async function handleConfirm() {
    setPending(true);
    try {
      await onConfirm();
      setOpen(false);
      setTypedValue("");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setTypedValue("");
      }}
    >
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[90vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-md border border-border bg-card p-4 shadow-2xl outline-none"
          aria-describedby={description ? "confirm-dialog-desc" : undefined}
        >
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
            <Dialog.Close className="rounded-sm p-1 hover:bg-muted" aria-label="Fermer">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          {description && (
            <Dialog.Description id="confirm-dialog-desc" className="mt-2 text-sm text-muted-foreground">
              {description}
            </Dialog.Description>
          )}

          {requireTypedConfirmation && (
            <div className="mt-3">
              <label className="mb-1 block text-xs text-muted-foreground">
                Tapez <span className="font-display font-semibold text-foreground">{requireTypedConfirmation}</span>{" "}
                pour confirmer
              </label>
              <input
                type="text"
                value={typedValue}
                onChange={(e) => setTypedValue(e.target.value)}
                className="w-full rounded-sm border border-border bg-background px-3 py-2 font-display text-sm outline-none focus:ring-2 focus:ring-primary"
                autoComplete="off"
                autoFocus
              />
            </div>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="outline" size="sm" disabled={pending}>
                {cancelLabel}
              </Button>
            </Dialog.Close>
            <Button
              variant={variant}
              size="sm"
              disabled={pending || !canConfirm}
              className={cn(pending && "opacity-70")}
              onClick={handleConfirm}
            >
              {pending ? "..." : confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
