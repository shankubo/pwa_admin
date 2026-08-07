import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const MAX_LINES = 500;

interface LiveLogPanelProps {
  /** Raw text chunks to append, in order. Each call appends and re-splits into lines. */
  chunk?: string | null;
  /** Optional static/initial text to seed the panel with (e.g. from a REST fetch before WS connects). */
  initialText?: string;
  className?: string;
  heightClassName?: string;
  emptyLabel?: string;
}

/**
 * Auto-scrolling log viewer. Appends incoming text chunks to a capped buffer
 * (last ~500 lines) and renders them in a scrollable monospace <pre>.
 * Reused by Docker container logs, Nginx access/error logs, and OS upgrade job output.
 *
 * Note: virtualization (react-window) was deferred as a nice-to-have per the task brief —
 * the 500-line cap keeps DOM size bounded without it.
 */
export function LiveLogPanel({
  chunk,
  initialText,
  className,
  heightClassName = "max-h-80",
  emptyLabel = "En attente de données…",
}: LiveLogPanelProps) {
  const [lines, setLines] = useState<string[]>(() => (initialText ? splitLines(initialText) : []));
  const containerRef = useRef<HTMLDivElement>(null);
  const seededRef = useRef(false);

  // Re-seed if initialText arrives after mount (e.g. async fetch resolves later),
  // but only once, before any live chunks have started arriving.
  useEffect(() => {
    if (initialText && !seededRef.current && lines.length === 0) {
      seededRef.current = true;
      setLines(splitLines(initialText));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialText]);

  useEffect(() => {
    if (!chunk) return;
    setLines((prev) => {
      const merged = prev.concat(splitLines(chunk));
      return merged.length > MAX_LINES ? merged.slice(merged.length - MAX_LINES) : merged;
    });
  }, [chunk]);

  useEffect(() => {
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "overflow-y-auto rounded-md border border-border bg-black/90 p-2 font-mono text-xs text-green-400",
        heightClassName,
        className
      )}
    >
      {lines.length === 0 ? (
        <p className="text-muted-foreground">{emptyLabel}</p>
      ) : (
        <pre className="whitespace-pre-wrap break-all">{lines.join("\n")}</pre>
      )}
    </div>
  );
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/).filter((_, i, arr) => !(i === arr.length - 1 && arr[i] === ""));
}
