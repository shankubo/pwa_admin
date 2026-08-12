import { splitServerBlocks, isRedirectOnlyBlock } from "./nginx.parser.js";
import type { NginxGuidedFormModel, NginxGuidedHeaders } from "@pwa-admin/shared";

/**
 * "Detect known directives, opaque remainder" parser/serializer for the
 * guided config editor — deliberately NOT a full nginx-grammar round-trip
 * parser (nginx.parser.ts's own header comment already disclaims that for
 * parseVhostSummary, and the risk is worse here since this one WRITES back).
 * Only the directives listed in NginxGuidedFormModel are ever read or
 * touched; everything else in the raw config — comments, other locations,
 * unrelated directives — passes through byte-for-byte untouched. Serialize
 * always re-locates its insertion points against the CURRENT rawConfig
 * passed in at call time (never reuses offsets captured at parse time), so
 * a form model can never silently go stale relative to text edited in
 * between — the same reasoning restoreIfChanged's checksum comparison
 * documents elsewhere in this codebase, applied here to avoid a stale-parse
 * bug instead of a stale-restore one.
 */

const HEADER_DIRECTIVES: { key: keyof NginxGuidedHeaders; name: string; value: string }[] = [
  { key: "frameOptions", name: "X-Frame-Options", value: '"SAMEORIGIN"' },
  { key: "contentTypeOptions", name: "X-Content-Type-Options", value: '"nosniff"' },
  { key: "referrerPolicy", name: "Referrer-Policy", value: '"strict-origin-when-cross-origin"' },
  { key: "hsts", name: "Strict-Transport-Security", value: '"max-age=31536000; includeSubDomains"' },
];

/**
 * Picks the server{} block the guided editor should read/write — the real
 * site config, not an HTTP→HTTPS redirect shim. Reuses isRedirectOnlyBlock
 * (the same filter applyMaintenanceMode/applyFailoverRewrite already use)
 * as a first pass, but that heuristic alone is NOT reliable here: a
 * `:80` block whose only real job is redirecting to HTTPS commonly still
 * carries a `location /.well-known/acme-challenge/ { root ...; }` for
 * Let's Encrypt HTTP-01 validation — a legitimate `root` directive inside a
 * location block, which makes isRedirectOnlyBlock's "any location serving
 * real content disqualifies this as redirect-only" check (correctly, for
 * ITS purpose) call the block content-serving. For THIS purpose the intent
 * is different: among several non-"pure redirect" blocks, prefer the one
 * that's actually the site's own config — a block declaring `listen ...
 * ssl`/`443` or an `ssl_certificate` directive is a strong, unambiguous
 * signal of that, checked BEFORE falling back to isRedirectOnlyBlock's
 * first-match behavior (which is what a single-block, plain-HTTP vhost
 * still needs).
 */
function findEditableBlock(rawConfig: string): { start: number; end: number; text: string } | null {
  const blocks = splitServerBlocks(rawConfig);
  const tlsBlock = blocks.find((b) => /^\s*listen\s+[^;]*(ssl|443)/im.test(b.text) || /^\s*ssl_certificate\s+/im.test(b.text));
  if (tlsBlock) return tlsBlock;
  return blocks.find((b) => !isRedirectOnlyBlock(b.text)) ?? null;
}

export function parseGuidedFields(rawConfig: string): NginxGuidedFormModel {
  const block = findEditableBlock(rawConfig);
  const text = block?.text ?? "";

  const certMatch = /^\s*ssl_certificate\s+([^;]+);/m.exec(text);
  const certKeyMatch = /^\s*ssl_certificate_key\s+([^;]+);/m.exec(text);
  const bodySizeMatch = /^\s*client_max_body_size\s+([^;]+);/m.exec(text);
  const rootMatch = /^\s*root\s+([^;]+);/m.exec(text);
  const proxyPassMatch = /^\s*proxy_pass\s+([^;]+);/m.exec(text);

  const headers = {} as NginxGuidedHeaders;
  for (const h of HEADER_DIRECTIVES) {
    const re = new RegExp(`^\\s*add_header\\s+${h.name}\\s+`, "m");
    headers[h.key] = re.test(text);
  }

  const hasRoot = !!rootMatch;
  const hasProxyPass = !!proxyPassMatch;
  const mode = hasRoot && hasProxyPass ? "mixed" : hasRoot ? "root" : hasProxyPass ? "proxy_pass" : "unknown";

  return {
    sslEnabled: !!certMatch,
    certPath: certMatch ? certMatch[1].trim() : null,
    certKeyPath: certKeyMatch ? certKeyMatch[1].trim() : null,
    clientMaxBodySize: bodySizeMatch ? bodySizeMatch[1].trim() : null,
    headers,
    mode,
    rootPath: rootMatch ? rootMatch[1].trim() : null,
    proxyPassTarget: proxyPassMatch ? proxyPassMatch[1].trim() : null,
  };
}

/** Matches ONLY the server block's own top-level opening brace (the very
 * first `{` in the block's text, immediately after `server` and whitespace)
 * — deliberately NOT a bare /\{\r?\n/ search, which would happily match the
 * first nested `location { ... }` brace instead whenever the server block's
 * own `{` has trailing whitespace/a comment before its newline (a realistic
 * hand-edited config). Inserting there would silently narrow a directive's
 * scope into just that one location block instead of the whole server{} —
 * syntactically valid, so `nginx -t` would never catch it. Tolerates
 * anything (spaces, a trailing comment) between `{` and the newline via the
 * non-greedy `[^\n]*` before requiring the line break. */
const BLOCK_OPEN_RE = /^server\s*\{[^\n]*\r?\n/;

/** Replaces a directive's value if present, inserts a fresh line right
 * after the block's own opening `{` (see BLOCK_OPEN_RE) if the model wants
 * it present but it isn't yet, or removes the line entirely if the model
 * wants it absent. Insertion ordering is deliberately not
 * directive-order-sensitive (nginx doesn't care), matching
 * applyFailoverRewrite's existing "value substitution, order untouched"
 * philosophy.
 *
 * `directiveRe` matches ONLY the directive statement itself (leading
 * whitespace captured as group 1, e.g. /^(\s*)root\s+[^;]+;/m) — the
 * removal branch below builds its OWN regex that additionally consumes the
 * trailing newline, since removal must delete the whole line, not just
 * blank out the statement text.
 *
 * Only touches the FIRST match of a directive — a server block with a
 * genuine top-level duplicate directive (nginx itself applies only the
 * LAST occurrence at runtime) is a pre-existing oddity in the source config
 * this editor doesn't attempt to clean up; the guided editor's own writes
 * never produce duplicates since insert only fires when directiveRe found
 * no existing match at all.
 */
function upsertDirective(blockText: string, directiveRe: RegExp, wantPresent: boolean, line: string): string {
  const existing = directiveRe.exec(blockText);
  if (wantPresent) {
    if (existing) return blockText.replace(directiveRe, `$1${line}`);
    if (!BLOCK_OPEN_RE.test(blockText)) throw new Error("cannot_locate_server_block_opening_brace");
    return blockText.replace(BLOCK_OPEN_RE, (m) => `${m}    ${line}\n`);
  }
  if (existing) {
    const lineRe = new RegExp(directiveRe.source + "\\r?\\n?", directiveRe.flags);
    return blockText.replace(lineRe, "");
  }
  return blockText;
}

export function applyGuidedFields(rawConfig: string, model: NginxGuidedFormModel): string {
  const block = findEditableBlock(rawConfig);
  if (!block) throw new Error("no_editable_server_block");

  let text = block.text;

  text = upsertDirective(
    text,
    /^(\s*)ssl_certificate\s+[^;]+;/m,
    model.sslEnabled && !!model.certPath,
    `ssl_certificate ${model.certPath};`
  );
  text = upsertDirective(
    text,
    /^(\s*)ssl_certificate_key\s+[^;]+;/m,
    model.sslEnabled && !!model.certKeyPath,
    `ssl_certificate_key ${model.certKeyPath};`
  );
  text = upsertDirective(
    text,
    /^(\s*)client_max_body_size\s+[^;]+;/m,
    !!model.clientMaxBodySize,
    `client_max_body_size ${model.clientMaxBodySize};`
  );

  for (const h of HEADER_DIRECTIVES) {
    const re = new RegExp(`^(\\s*)add_header\\s+${h.name}\\s+[^;]+;`, "m");
    text = upsertDirective(text, re, model.headers[h.key], `add_header ${h.name} ${h.value} always;`);
  }

  if (model.mode === "root" || model.mode === "mixed") {
    text = upsertDirective(text, /^(\s*)root\s+[^;]+;/m, !!model.rootPath, `root ${model.rootPath};`);
  } else if (model.mode !== "unknown") {
    text = upsertDirective(text, /^(\s*)root\s+[^;]+;/m, false, "");
  }
  if (model.mode === "proxy_pass" || model.mode === "mixed") {
    text = upsertDirective(
      text,
      /^(\s*)proxy_pass\s+[^;]+;/m,
      !!model.proxyPassTarget,
      `proxy_pass ${model.proxyPassTarget};`
    );
  } else if (model.mode !== "unknown") {
    text = upsertDirective(text, /^(\s*)proxy_pass\s+[^;]+;/m, false, "");
  }

  return rawConfig.slice(0, block.start) + text + rawConfig.slice(block.end);
}

/** "Create" mode counterpart to applyGuidedFields — there's no existing
 * block to splice into, so this builds one whole server{} block from
 * scratch using the same directive templates as upsertDirective's insert
 * branch, then wraps it in the fixed listen/server_name skeleton the create
 * form always provides. */
export function buildInitialVhostConfig(
  model: NginxGuidedFormModel & { serverName: string; listenPort: number }
): string {
  const lines: string[] = [`server {`, `    listen ${model.listenPort};`, `    server_name ${model.serverName};`, ""];

  if (model.sslEnabled && model.certPath) lines.push(`    ssl_certificate ${model.certPath};`);
  if (model.sslEnabled && model.certKeyPath) lines.push(`    ssl_certificate_key ${model.certKeyPath};`);
  if (model.clientMaxBodySize) lines.push(`    client_max_body_size ${model.clientMaxBodySize};`);
  for (const h of HEADER_DIRECTIVES) {
    if (model.headers[h.key]) lines.push(`    add_header ${h.name} ${h.value} always;`);
  }
  lines.push("");
  if (model.mode === "proxy_pass" && model.proxyPassTarget) {
    lines.push(`    location / {`, `        proxy_pass ${model.proxyPassTarget};`, `    }`);
  } else if (model.rootPath) {
    lines.push(`    root ${model.rootPath};`, `    location / {`, `        try_files $uri $uri/ =404;`, `    }`);
  }
  lines.push("}", "");

  return lines.join("\n");
}
