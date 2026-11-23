import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  FileKey,
  HardDrive,
  Lock,
  Monitor,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { Card } from "@/components/ui/Card";

type GuideBlock =
  | { type: "p"; text: string }
  | { type: "list"; items: string[] }
  | { type: "steps"; title?: string; items: string[] }
  | { type: "warn"; text: string }
  | { type: "code"; lines: string[] };

interface GuideCard {
  id: string;
  title: string;
  summary: string;
  blocks: GuideBlock[];
}

interface Guide {
  heading: string;
  intro: string;
  downloadTool: string;
  cards: GuideCard[];
}

const ICONS: Record<string, typeof Lock> = {
  overview: ShieldCheck,
  archives: FileKey,
  luks: HardDrive,
  readluks: Monitor,
  decrypt: Lock,
  troubleshoot: Wrench,
};

function CodeBlock({ lines }: { lines: string[] }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be unavailable (non-secure context): the text stays selectable.
    }
  }

  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-md bg-muted p-2 pr-9 text-[11px] leading-relaxed text-foreground">
        {lines.join("\n")}
      </pre>
      <button
        type="button"
        onClick={copy}
        className="absolute right-1.5 top-1.5 rounded p-1 text-muted-foreground hover:bg-background"
        aria-label="Copy"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

function Block({ block }: { block: GuideBlock }) {
  switch (block.type) {
    case "p":
      return <p className="text-xs text-muted-foreground">{block.text}</p>;
    case "list":
      return (
        <ul className="flex flex-col gap-1.5">
          {block.items.map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      );
    case "steps":
      return (
        <div>
          {block.title && <p className="mb-1 text-xs font-medium">{block.title}</p>}
          <ol className="flex flex-col gap-1.5">
            {block.items.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
                  {i + 1}
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ol>
        </div>
      );
    case "warn":
      return (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          <span>{block.text}</span>
        </div>
      );
    case "code":
      return <CodeBlock lines={block.lines} />;
  }
}

function GuideCardView({ card, downloadLabel }: { card: GuideCard; downloadLabel: string }) {
  const [open, setOpen] = useState(false);
  const Icon = ICONS[card.id] ?? ShieldCheck;

  return (
    <Card>
      <button className="flex w-full items-center justify-between gap-2 text-left" onClick={() => setOpen((v) => !v)}>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
            <Icon className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-medium">{card.title}</p>
            <p className="text-xs text-muted-foreground">{card.summary}</p>
          </div>
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </button>
      {open && (
        <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
          {card.blocks.map((block, i) => (
            <Block key={i} block={block} />
          ))}
          {card.id === "decrypt" && (
            <a
              href="/tools/decrypt-backup.mjs"
              download
              className="inline-flex h-8 w-fit items-center justify-center gap-2 rounded-sm border border-border px-3 text-xs font-medium hover:border-primary/50 hover:bg-muted"
            >
              <Download className="h-3.5 w-3.5" /> {downloadLabel}
            </a>
          )}
        </div>
      )}
    </Card>
  );
}

/** Help section: how backups are protected (archive encryption, LUKS USB drive),
 * how to restore them, and how to read them on another machine. Content lives
 * in the `help` namespace (backupGuide); Tamil falls back to French. */
export function BackupGuide() {
  const { t } = useTranslation("help");
  const guide = t("backupGuide", { returnObjects: true }) as Guide | string;
  if (typeof guide === "string") return null;

  return (
    <div>
      <h2 className="mb-1 flex items-center gap-1 text-sm font-semibold text-muted-foreground">
        <Lock className="h-4 w-4" /> {guide.heading}
      </h2>
      <p className="mb-2 text-xs text-muted-foreground">{guide.intro}</p>
      <div className="flex flex-col gap-2">
        {guide.cards.map((card) => (
          <GuideCardView key={card.id} card={card} downloadLabel={guide.downloadTool} />
        ))}
      </div>
    </div>
  );
}
