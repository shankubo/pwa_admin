import { splitServerBlocks, isRedirectOnlyBlock } from "./nginx.parser.js";
import type { NginxGuidedFormModel, NginxGuidedHeaders, NginxGuidedLocations } from "@pwa-admin/shared";

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
  { key: "xssProtection", name: "X-XSS-Protection", value: '"1; mode=block"' },
  {
    key: "permissionsPolicy",
    name: "Permissions-Policy",
    value: '"geolocation=(), microphone=(), camera=(), payment=()"',
  },
  {
    key: "contentSecurityPolicy",
    name: "Content-Security-Policy",
    value: '"default-src \'self\'; script-src \'self\'; style-src \'self\'"',
  },
];

/**
 * Fixed library of known-good `location {}` snippets — the "checkbox, not
 * free text" approach requested for this feature. Each entry is delimited
 * by its own leading `# guided:<key>` marker comment, which is how both
 * detection (parse) and removal (serialize) find the WHOLE block reliably
 * without depending on brace-counting across a re-generated insert (unlike
 * splitServerBlocks, which only ever reads existing blocks, never needs to
 * re-locate one it just wrote). The marker is placed on its own line
 * immediately before `location`, invisible to nginx itself (`#` comments).
 */
const LOCATION_TEMPLATES: { key: keyof NginxGuidedLocations; marker: string; block: string }[] = [
  {
    key: "blockDotfiles",
    marker: "guided:blockDotfiles",
    block: [
      "    # guided:blockDotfiles",
      "    location ~ /\\.git { deny all; }",
      "    location ~ /\\.ht { deny all; }",
    ].join("\n"),
  },
  {
    key: "cacheStaticAssets",
    marker: "guided:cacheStaticAssets",
    block: [
      "    # guided:cacheStaticAssets",
      "    location /assets/ {",
      "        access_log off;",
      "        expires 1y;",
      '        add_header Cache-Control "public, immutable";',
      "    }",
    ].join("\n"),
  },
  {
    key: "spaFallback",
    marker: "guided:spaFallback",
    block: [
      "    # guided:spaFallback",
      "    location / {",
      "        try_files $uri $uri/ /index.html;",
      "    }",
    ].join("\n"),
  },
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

/** Detects a location{} template as "present" two ways: its own guided:
 * marker comment (a block THIS editor previously inserted), OR an existing
 * unmarked block already hand-written in the config that serves the same
 * purpose. spaFallback (`location / { try_files ...; }`) and
 * cacheStaticAssets (`location /assets/ { ...; }`) both get an unmarked-form
 * check — both paths are common enough in hand-written configs (spaFallback
 * confirmed via barber373k's own config; `/assets/` is exactly what
 * Vite/Webpack's own default build output convention uses, not an obscure
 * path) that skipping this check would risk inserting a second, redundant
 * location under the SAME path. blockDotfiles is the one template without
 * this check: `location ~ /\.git`/`/\.ht` are specific enough regex paths
 * that an unmarked collision is unlikely, and duplicate `location ~ /\.git`
 * blocks (unlike duplicate `location /` or `location /assets/`) aren't a
 * hard nginx conflict — the first match simply wins, so a redundant second
 * copy is inert, not silently broken.
 */
function hasLocationTemplate(text: string, key: keyof NginxGuidedLocations): boolean {
  const template = LOCATION_TEMPLATES.find((t) => t.key === key)!;
  if (text.includes(`# ${template.marker}`)) return true;
  if (key === "spaFallback") {
    return /location\s+\/\s*\{[^{}]*try_files[^{}]*\}/.test(text);
  }
  if (key === "cacheStaticAssets") {
    return /location\s+\/assets\/?\s*\{/.test(text);
  }
  return false;
}

export function parseGuidedFields(rawConfig: string): NginxGuidedFormModel {
  const block = findEditableBlock(rawConfig);
  const text = block?.text ?? "";

  // Every value regex below tries a QUOTED alternative first
  // ("[^"]*"[^;]*) before falling back to plain [^;]+ — several real
  // directive values contain internal semicolons inside their quotes
  // (Strict-Transport-Security's "max-age=31536000; includeSubDomains;
  // preload", multi-directive Content-Security-Policy values), so a bare
  // [^;]+ truncates at the FIRST semicolon, mid-string. A bare greedy .+
  // was tried and reverted: it fixed that case but broke the opposite one —
  // two SEPARATE directives sharing one physical line (e.g.
  // `root /var/www/html; index index.html index.htm;`, valid nginx) would
  // have their boundary silently swallowed, deleting the sibling directive
  // on replace/remove. The quoted-or-plain alternation handles both: a
  // quoted value's internal semicolons are protected by the quotes
  // themselves, while an unquoted value (root, proxy_pass, etc.) still
  // correctly stops at ITS OWN first semicolon.
  const certMatch = /^\s*ssl_certificate\s+("[^"]*"[^;]*|[^;]+);/m.exec(text);
  const certKeyMatch = /^\s*ssl_certificate_key\s+("[^"]*"[^;]*|[^;]+);/m.exec(text);
  const bodySizeMatch = /^\s*client_max_body_size\s+("[^"]*"[^;]*|[^;]+);/m.exec(text);
  const rootMatch = /^\s*root\s+("[^"]*"[^;]*|[^;]+);/m.exec(text);
  const proxyPassMatch = /^\s*proxy_pass\s+("[^"]*"[^;]*|[^;]+);/m.exec(text);
  const tlsProtocolsMatch = /^\s*ssl_protocols\s+("[^"]*"[^;]*|[^;]+);/m.exec(text);
  const tlsCiphersMatch = /^\s*ssl_ciphers\s+("[^"]*"[^;]*|[^;]+);/m.exec(text);
  const tlsSessionCacheMatch = /^\s*ssl_session_cache\s+("[^"]*"[^;]*|[^;]+);/m.exec(text);
  const tlsSessionTimeoutMatch = /^\s*ssl_session_timeout\s+("[^"]*"[^;]*|[^;]+);/m.exec(text);
  const gzipEnabledMatch = /^\s*gzip\s+on\s*;/m.exec(text);
  const gzipTypesMatch = /^\s*gzip_types\s+("[^"]*"[^;]*|[^;]+);/m.exec(text);

  const headers = {} as NginxGuidedHeaders;
  for (const h of HEADER_DIRECTIVES) {
    const re = new RegExp(`^\\s*add_header\\s+${h.name}\\s+`, "m");
    headers[h.key] = re.test(text);
  }

  const locations = {} as NginxGuidedLocations;
  for (const t of LOCATION_TEMPLATES) {
    locations[t.key] = hasLocationTemplate(text, t.key);
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
    tls: {
      protocols: tlsProtocolsMatch ? tlsProtocolsMatch[1].trim() : null,
      ciphers: tlsCiphersMatch ? tlsCiphersMatch[1].trim() : null,
      sessionCache: tlsSessionCacheMatch ? tlsSessionCacheMatch[1].trim() : null,
      sessionTimeout: tlsSessionTimeoutMatch ? tlsSessionTimeoutMatch[1].trim() : null,
    },
    gzip: {
      enabled: !!gzipEnabledMatch,
      types: gzipTypesMatch ? gzipTypesMatch[1].trim() : null,
    },
    locations,
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
 * whitespace captured as group 1, e.g.
 * /^(\s*)root\s+("[^"]*"[^;]*|[^;]+);/m — see parseGuidedFields's own doc
 * comment for why the value alternation is quoted-first, not a bare
 * `[^;]+` or `.+`) — the removal branch below builds its OWN regex that
 * additionally consumes the trailing newline, since removal must delete
 * the whole line, not just blank out the statement text.
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

/**
 * Insert/remove a whole marked location{} template — the multi-line
 * counterpart to upsertDirective. Insertion always appends just before the
 * block's own closing `}` (simpler and safer than trying to find "the right
 * spot" among existing locations — nginx doesn't care about location
 * ordering for distinct paths).
 *
 * Removal deletes from the marker comment through to the point where every
 * `{`/`}` pair opened INSIDE the template has been closed — walking until
 * the running depth returns to 0 the SAME number of times the template's
 * own known text opens a brace (counted from LOCATION_TEMPLATES itself, not
 * assumed to be exactly one pair). This matters because blockDotfiles is
 * two separate single-line `location {}` statements under one marker: a
 * naive "stop at the first balanced `{...}`" walk (an earlier version of
 * this function did exactly that) stops after only the FIRST location,
 * leaving the second (`location ~ /\.ht { deny all; }`) behind, orphaned
 * with no marker above it — invisible to hasLocationTemplate on a later
 * parse, and duplicated if the admin re-checks the box. Counting total
 * opens up front and requiring that many depth-0 returns handles any
 * number of sibling location{} statements under one marker uniformly.
 *
 * spaFallback is the one template with a "pre-existing unmarked form"
 * (see hasLocationTemplate) — toggling it OFF when only an unmarked
 * `location / {}` exists intentionally does nothing (there's no marker to
 * find), matching this function's "only ever touch what it can
 * unambiguously identify as its own" contract; the admin can still remove
 * a hand-written block themselves via the raw editor.
 */
function upsertLocationTemplate(blockText: string, key: keyof NginxGuidedLocations, wantPresent: boolean): string {
  const template = LOCATION_TEMPLATES.find((t) => t.key === key)!;
  const markerIndex = blockText.indexOf(`# ${template.marker}`);

  if (wantPresent) {
    // Reuses the SAME broader "already present" check parseGuidedFields's
    // hasLocationTemplate uses (marker OR, for spaFallback, an equivalent
    // unmarked block) — checking markerIndex alone here would insert a
    // second, redundant `location /` alongside an existing hand-written one
    // parseGuidedFields already reported as "already checked" to the admin.
    if (hasLocationTemplate(blockText, key)) return blockText;
    const closingBraceIndex = blockText.lastIndexOf("}");
    if (closingBraceIndex === -1) throw new Error("cannot_locate_server_block_closing_brace");
    return blockText.slice(0, closingBraceIndex) + template.block + "\n" + blockText.slice(closingBraceIndex);
  }

  if (markerIndex === -1) return blockText; // nothing marked to remove (see spaFallback note above)
  const totalOpens = (template.block.match(/\{/g) ?? []).length;
  let depth = 0;
  let closesAtDepthZero = 0;
  let i = markerIndex;
  for (; i < blockText.length; i++) {
    if (blockText[i] === "{") {
      depth++;
    } else if (blockText[i] === "}") {
      depth--;
      if (depth === 0) {
        closesAtDepthZero++;
        if (closesAtDepthZero === totalOpens) {
          i++;
          break;
        }
      }
    }
  }
  // Also consume the trailing newline so removal doesn't leave a blank line.
  if (blockText[i] === "\r") i++;
  if (blockText[i] === "\n") i++;
  return blockText.slice(0, markerIndex) + blockText.slice(i);
}

export function applyGuidedFields(rawConfig: string, model: NginxGuidedFormModel): string {
  const block = findEditableBlock(rawConfig);
  if (!block) throw new Error("no_editable_server_block");

  let text = block.text;

  text = upsertDirective(
    text,
    /^(\s*)ssl_certificate\s+("[^"]*"[^;]*|[^;]+);/m,
    model.sslEnabled && !!model.certPath,
    `ssl_certificate ${model.certPath};`
  );
  text = upsertDirective(
    text,
    /^(\s*)ssl_certificate_key\s+("[^"]*"[^;]*|[^;]+);/m,
    model.sslEnabled && !!model.certKeyPath,
    `ssl_certificate_key ${model.certKeyPath};`
  );
  text = upsertDirective(
    text,
    /^(\s*)client_max_body_size\s+("[^"]*"[^;]*|[^;]+);/m,
    !!model.clientMaxBodySize,
    `client_max_body_size ${model.clientMaxBodySize};`
  );

  for (const h of HEADER_DIRECTIVES) {
    const re = new RegExp(`^(\\s*)add_header\\s+${h.name}\\s+("[^"]*"[^;]*|[^;]+);`, "m");
    text = upsertDirective(text, re, model.headers[h.key], `add_header ${h.name} ${h.value} always;`);
  }

  if (model.mode === "root" || model.mode === "mixed") {
    text = upsertDirective(text, /^(\s*)root\s+("[^"]*"[^;]*|[^;]+);/m, !!model.rootPath, `root ${model.rootPath};`);
  } else if (model.mode !== "unknown") {
    text = upsertDirective(text, /^(\s*)root\s+("[^"]*"[^;]*|[^;]+);/m, false, "");
  }
  if (model.mode === "proxy_pass" || model.mode === "mixed") {
    text = upsertDirective(
      text,
      /^(\s*)proxy_pass\s+("[^"]*"[^;]*|[^;]+);/m,
      !!model.proxyPassTarget,
      `proxy_pass ${model.proxyPassTarget};`
    );
  } else if (model.mode !== "unknown") {
    text = upsertDirective(text, /^(\s*)proxy_pass\s+("[^"]*"[^;]*|[^;]+);/m, false, "");
  }

  text = upsertDirective(
    text,
    /^(\s*)ssl_protocols\s+("[^"]*"[^;]*|[^;]+);/m,
    model.sslEnabled && !!model.tls.protocols,
    `ssl_protocols ${model.tls.protocols};`
  );
  text = upsertDirective(
    text,
    /^(\s*)ssl_ciphers\s+("[^"]*"[^;]*|[^;]+);/m,
    model.sslEnabled && !!model.tls.ciphers,
    `ssl_ciphers ${model.tls.ciphers};`
  );
  text = upsertDirective(
    text,
    /^(\s*)ssl_session_cache\s+("[^"]*"[^;]*|[^;]+);/m,
    model.sslEnabled && !!model.tls.sessionCache,
    `ssl_session_cache ${model.tls.sessionCache};`
  );
  text = upsertDirective(
    text,
    /^(\s*)ssl_session_timeout\s+("[^"]*"[^;]*|[^;]+);/m,
    model.sslEnabled && !!model.tls.sessionTimeout,
    `ssl_session_timeout ${model.tls.sessionTimeout};`
  );

  text = upsertDirective(text, /^(\s*)gzip\s+on\s*;/m, model.gzip.enabled, `gzip on;`);
  text = upsertDirective(
    text,
    /^(\s*)gzip_types\s+("[^"]*"[^;]*|[^;]+);/m,
    model.gzip.enabled && !!model.gzip.types,
    `gzip_types ${model.gzip.types};`
  );

  for (const t of LOCATION_TEMPLATES) {
    text = upsertLocationTemplate(text, t.key, model.locations[t.key]);
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
  if (model.sslEnabled && model.tls.protocols) lines.push(`    ssl_protocols ${model.tls.protocols};`);
  if (model.sslEnabled && model.tls.ciphers) lines.push(`    ssl_ciphers ${model.tls.ciphers};`);
  if (model.sslEnabled && model.tls.sessionCache) lines.push(`    ssl_session_cache ${model.tls.sessionCache};`);
  if (model.sslEnabled && model.tls.sessionTimeout) lines.push(`    ssl_session_timeout ${model.tls.sessionTimeout};`);
  if (model.clientMaxBodySize) lines.push(`    client_max_body_size ${model.clientMaxBodySize};`);
  for (const h of HEADER_DIRECTIVES) {
    if (model.headers[h.key]) lines.push(`    add_header ${h.name} ${h.value} always;`);
  }
  if (model.gzip.enabled) {
    lines.push(`    gzip on;`);
    if (model.gzip.types) lines.push(`    gzip_types ${model.gzip.types};`);
  }
  if (model.locations.blockDotfiles) {
    const t = LOCATION_TEMPLATES.find((x) => x.key === "blockDotfiles")!;
    lines.push("", t.block);
  }
  if (model.locations.cacheStaticAssets) {
    const t = LOCATION_TEMPLATES.find((x) => x.key === "cacheStaticAssets")!;
    lines.push("", t.block);
  }
  lines.push("");
  // proxy_pass mode, rootPath's own try_files fallback, and the spaFallback
  // template are THREE different ways of filling the exact same `location /`
  // slot — nginx only honors one `location /` per server block, so exactly
  // one of them must win, never two stacked. Precedence: proxy_pass mode
  // first (an explicit, deliberate choice of "not a static site" that
  // should never be silently overridden by a checkbox), then spaFallback's
  // own try_files (identical shape to the root-mode default below, but
  // still routed through the single shared LOCATION_TEMPLATES definition so
  // there's one source of truth for that snippet's exact text), then the
  // plain root-mode default as the fallback when neither is requested.
  if (model.mode === "proxy_pass" && model.proxyPassTarget) {
    lines.push(`    location / {`, `        proxy_pass ${model.proxyPassTarget};`, `    }`);
  } else if (model.rootPath && model.locations.spaFallback) {
    const t = LOCATION_TEMPLATES.find((x) => x.key === "spaFallback")!;
    lines.push(`    root ${model.rootPath};`, "", t.block);
  } else if (model.rootPath) {
    lines.push(`    root ${model.rootPath};`, `    location / {`, `        try_files $uri $uri/ =404;`, `    }`);
  }
  lines.push("}", "");

  return lines.join("\n");
}
