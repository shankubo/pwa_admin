import { splitVirtualHostBlocks, isRedirectOnlyBlock } from "./apache.parser.js";
import type { GuidedFormModel, GuidedHeaders, GuidedLocations } from "@pwa-admin/shared";

/**
 * "Detect known directives, opaque remainder" parser/serializer for the
 * guided config editor — direct Apache counterpart of nginx.guidedEditor.ts,
 * same scope discipline (only the directives GuidedFormModel lists are ever
 * read/touched, everything else in the raw config passes through
 * byte-for-byte untouched, serialize always re-locates insertion points
 * against the CURRENT rawConfig rather than reusing parse-time offsets).
 *
 * Directive-mapping table vs. nginx (see the Apache-parity implementation
 * plan for the full rationale of each row):
 *   ssl_certificate          -> SSLCertificateFile
 *   ssl_certificate_key      -> SSLCertificateKeyFile
 *   ssl_protocols             -> SSLProtocol
 *   ssl_ciphers               -> SSLCipherSuite
 *   ssl_session_cache         -> SSLSessionCache
 *   ssl_session_timeout       -> SSLSessionCacheTimeout
 *   client_max_body_size      -> LimitRequestBody (BYTES, not "10m" shorthand
 *                                — see parseBodySizeToBytes/formatBytesForDisplay)
 *   add_header (7 headers)    -> Header always set (mod_headers)
 *   gzip on/off                -> SetOutputFilter DEFLATE (mod_deflate)
 *   gzip_types                 -> AddOutputFilterByType DEFLATE <mime...> (mod_deflate)
 *   root/proxy_pass             -> DocumentRoot/ProxyPass+ProxyPassReverse
 *   blockDotfiles location      -> <FilesMatch "^\."> Require all denied </FilesMatch>
 *   cacheStaticAssets location  -> <Directory> ExpiresActive/Header (mod_expires+mod_headers)
 *   spaFallback location        -> FallbackResource (mod_dir)
 */

const HEADER_DIRECTIVES: { key: keyof GuidedHeaders; name: string; value: string }[] = [
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

/** Apache module each guided field depends on, for the auto-a2enmod check
 * apache.service.ts's applyGuidedFields runs before writing — see that
 * function's own doc comment for why auto-enable (rather than refuse) was
 * chosen. */
export const GUIDED_FIELD_MODULES = {
  ssl: "ssl",
  headers: "headers",
  gzip: "deflate",
  cacheStaticAssets: "expires",
} as const;

/** Converts nginx-style shorthand ("10m", "512k", a bare number of bytes,
 * or nothing) to the raw byte integer Apache's LimitRequestBody requires —
 * Apache has no shorthand suffix support at all, unlike nginx's
 * client_max_body_size, so this conversion is a real semantic translation,
 * not just a directive rename. Returns null for anything unparseable rather
 * than guessing, so the caller can decide whether to skip the directive. */
export function parseBodySizeToBytes(value: string): number | null {
  const match = /^(\d+(?:\.\d+)?)\s*([kKmMgG]?)$/.exec(value.trim());
  if (!match) return null;
  const num = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier = unit === "g" ? 1024 ** 3 : unit === "m" ? 1024 ** 2 : unit === "k" ? 1024 : 1;
  return Math.round(num * multiplier);
}

/** Inverse of parseBodySizeToBytes, for round-tripping an existing
 * LimitRequestBody value back into the shared GuidedFormModel's
 * clientMaxBodySize field as a human-readable "10m"-style string (parity
 * with what an admin would see if the same vhost were served by nginx). */
function formatBytesAsShorthand(bytes: number): string {
  if (bytes % 1024 ** 3 === 0 && bytes >= 1024 ** 3) return `${bytes / 1024 ** 3}g`;
  if (bytes % 1024 ** 2 === 0 && bytes >= 1024 ** 2) return `${bytes / 1024 ** 2}m`;
  if (bytes % 1024 === 0 && bytes >= 1024) return `${bytes / 1024}k`;
  return String(bytes);
}

/**
 * Fixed library of known-good directive snippets, the Apache counterpart to
 * nginx's LOCATION_TEMPLATES — same "checkbox, not free text" approach.
 * Each entry is delimited by its own leading marker comment (Apache config
 * comments use `#`, same syntax as nginx here) for reliable detect/remove,
 * same reasoning as nginx.guidedEditor.ts's own doc comment.
 */
const SNIPPET_TEMPLATES: { key: keyof GuidedLocations; marker: string; block: string }[] = [
  {
    key: "blockDotfiles",
    marker: "guided:blockDotfiles",
    block: [
      "    # guided:blockDotfiles",
      '    <FilesMatch "^\\.">',
      "        Require all denied",
      "    </FilesMatch>",
    ].join("\n"),
  },
  {
    key: "cacheStaticAssets",
    marker: "guided:cacheStaticAssets",
    block: [
      "    # guided:cacheStaticAssets",
      '    <Directory "ASSETS_DIR">',
      "        ExpiresActive On",
      '        ExpiresDefault "access plus 1 year"',
      '        Header set Cache-Control "public, immutable"',
      "    </Directory>",
    ].join("\n"),
  },
  {
    key: "spaFallback",
    marker: "guided:spaFallback",
    block: ["    # guided:spaFallback", "    FallbackResource /index.html"].join("\n"),
  },
];

/**
 * Picks the <VirtualHost> block the guided editor should read/write — Apache
 * counterpart of nginx.guidedEditor.ts's findEditableBlock, same "prefer the
 * TLS-terminating/real-content block over a pure HTTP->HTTPS redirect shim"
 * priority. A block declaring SSLEngine on or an SSLCertificateFile is a
 * strong, unambiguous signal, checked before falling back to
 * isRedirectOnlyBlock's first-non-redirect-match behavior.
 */
function findEditableBlock(rawConfig: string): { start: number; end: number; text: string } | null {
  const blocks = splitVirtualHostBlocks(rawConfig);
  const tlsBlock = blocks.find(
    (b) => /^\s*SSLEngine\s+on/im.test(b.text) || /^\s*SSLCertificateFile\s+/im.test(b.text)
  );
  if (tlsBlock) return tlsBlock;
  return blocks.find((b) => !isRedirectOnlyBlock(b.text)) ?? null;
}

function hasSnippetTemplate(text: string, key: keyof GuidedLocations): boolean {
  const template = SNIPPET_TEMPLATES.find((t) => t.key === key)!;
  if (text.includes(`# ${template.marker}`)) return true;
  if (key === "spaFallback") return /^\s*FallbackResource\s+/im.test(text);
  if (key === "cacheStaticAssets") return /<Directory\s+"[^"]*assets[^"]*"/i.test(text);
  return false;
}

export function parseGuidedFields(rawConfig: string): GuidedFormModel {
  const block = findEditableBlock(rawConfig);
  const text = block?.text ?? "";

  const certMatch = /^\s*SSLCertificateFile\s+"?([^"#\r\n]+)"?/im.exec(text);
  const certKeyMatch = /^\s*SSLCertificateKeyFile\s+"?([^"#\r\n]+)"?/im.exec(text);
  const bodySizeMatch = /^\s*LimitRequestBody\s+(\d+)/im.exec(text);
  const rootMatch = /^\s*DocumentRoot\s+"?([^"#\r\n]+)"?/im.exec(text);
  const proxyPassMatch = /^\s*ProxyPass\s+\/\s+([^\s#\r\n]+)/im.exec(text);
  const tlsProtocolsMatch = /^\s*SSLProtocol\s+([^#\r\n]+)/im.exec(text);
  const tlsCiphersMatch = /^\s*SSLCipherSuite\s+([^#\r\n]+)/im.exec(text);
  const tlsSessionCacheMatch = /^\s*SSLSessionCache\s+([^#\r\n]+)/im.exec(text);
  const tlsSessionTimeoutMatch = /^\s*SSLSessionCacheTimeout\s+(\d+)/im.exec(text);
  const gzipEnabledMatch = /^\s*SetOutputFilter\s+.*DEFLATE/im.exec(text);
  const gzipTypesMatches = [...text.matchAll(/^\s*AddOutputFilterByType\s+DEFLATE\s+([^#\r\n]+)/gim)];

  const headers = {} as GuidedHeaders;
  for (const h of HEADER_DIRECTIVES) {
    const re = new RegExp(`^\\s*Header\\s+always\\s+set\\s+${h.name}\\s+`, "im");
    headers[h.key] = re.test(text);
  }

  const locations = {} as GuidedLocations;
  for (const t of SNIPPET_TEMPLATES) {
    locations[t.key] = hasSnippetTemplate(text, t.key);
  }

  const hasRoot = !!rootMatch;
  const hasProxyPass = !!proxyPassMatch;
  const mode = hasRoot && hasProxyPass ? "mixed" : hasRoot ? "root" : hasProxyPass ? "proxy_pass" : "unknown";

  return {
    sslEnabled: !!certMatch,
    certPath: certMatch ? certMatch[1].trim() : null,
    certKeyPath: certKeyMatch ? certKeyMatch[1].trim() : null,
    clientMaxBodySize: bodySizeMatch ? formatBytesAsShorthand(Number(bodySizeMatch[1])) : null,
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
      // AddOutputFilterByType expresses "which types" as one line per MIME
      // group rather than nginx's single space-separated directive value —
      // joined back into one space-separated string for the shared model,
      // split apart again on serialize (see applyGuidedFields below).
      types: gzipTypesMatches.length > 0 ? gzipTypesMatches.map((m) => m[1].trim()).join(" ") : null,
    },
    locations,
  };
}

const BLOCK_OPEN_RE = /^<VirtualHost\b[^>]*>[^\n]*\r?\n/;

function upsertDirective(blockText: string, directiveRe: RegExp, wantPresent: boolean, line: string): string {
  const existing = directiveRe.exec(blockText);
  if (wantPresent) {
    if (existing) return blockText.replace(directiveRe, `$1${line}`);
    if (!BLOCK_OPEN_RE.test(blockText)) throw new Error("cannot_locate_virtualhost_opening_tag");
    return blockText.replace(BLOCK_OPEN_RE, (m) => `${m}    ${line}\n`);
  }
  if (existing) {
    const lineRe = new RegExp(directiveRe.source + "\\r?\\n?", directiveRe.flags);
    return blockText.replace(lineRe, "");
  }
  return blockText;
}

/** Same multi-line insert/remove idea as nginx.guidedEditor.ts's
 * upsertLocationTemplate, adapted for Apache's tag-pair blocks
 * (<FilesMatch>/<Directory>) instead of brace-depth-counted ones — walks
 * matching open/close TAG pairs rather than `{`/`}` characters. */
function upsertSnippetTemplate(
  blockText: string,
  key: keyof GuidedLocations,
  wantPresent: boolean,
  assetsDir: string | null
): string {
  const template = SNIPPET_TEMPLATES.find((t) => t.key === key)!;
  const markerIndex = blockText.indexOf(`# ${template.marker}`);

  if (wantPresent) {
    if (hasSnippetTemplate(blockText, key)) return blockText;
    const closeTagIndex = blockText.search(/<\/VirtualHost>/i);
    if (closeTagIndex === -1) throw new Error("cannot_locate_virtualhost_closing_tag");
    const resolvedBlock =
      key === "cacheStaticAssets" ? template.block.replace("ASSETS_DIR", assetsDir ?? "/var/www/html/assets") : template.block;
    return blockText.slice(0, closeTagIndex) + resolvedBlock + "\n" + blockText.slice(closeTagIndex);
  }

  if (markerIndex === -1) return blockText;
  // FallbackResource is a single directive line, not a tag pair — remove
  // through the end of that line only.
  if (key === "spaFallback") {
    const lineEnd = blockText.indexOf("\n", markerIndex);
    return blockText.slice(0, markerIndex) + blockText.slice(lineEnd === -1 ? blockText.length : lineEnd + 1);
  }

  const tagName = key === "blockDotfiles" ? "FilesMatch" : "Directory";
  const closeTag = `</${tagName}>`;
  const closeIndex = blockText.indexOf(closeTag, markerIndex);
  if (closeIndex === -1) return blockText;
  let end = closeIndex + closeTag.length;
  if (blockText[end] === "\r") end++;
  if (blockText[end] === "\n") end++;
  return blockText.slice(0, markerIndex) + blockText.slice(end);
}

export function applyGuidedFields(rawConfig: string, model: GuidedFormModel): string {
  const block = findEditableBlock(rawConfig);
  if (!block) throw new Error("no_editable_virtualhost_block");

  let text = block.text;

  text = upsertDirective(
    text,
    /^(\s*)SSLCertificateFile\s+"?[^"#\r\n]+"?/im,
    model.sslEnabled && !!model.certPath,
    `SSLCertificateFile "${model.certPath}"`
  );
  text = upsertDirective(
    text,
    /^(\s*)SSLCertificateKeyFile\s+"?[^"#\r\n]+"?/im,
    model.sslEnabled && !!model.certKeyPath,
    `SSLCertificateKeyFile "${model.certKeyPath}"`
  );
  text = upsertDirective(
    text,
    /^(\s*)SSLEngine\s+on/im,
    model.sslEnabled,
    `SSLEngine on`
  );

  const bodyBytes = model.clientMaxBodySize ? parseBodySizeToBytes(model.clientMaxBodySize) : null;
  text = upsertDirective(
    text,
    /^(\s*)LimitRequestBody\s+\d+/im,
    bodyBytes != null,
    `LimitRequestBody ${bodyBytes ?? 0}`
  );

  for (const h of HEADER_DIRECTIVES) {
    const re = new RegExp(`^(\\s*)Header\\s+always\\s+set\\s+${h.name}\\s+[^#\\r\\n]+`, "im");
    text = upsertDirective(text, re, model.headers[h.key], `Header always set ${h.name} ${h.value}`);
  }

  if (model.mode === "root" || model.mode === "mixed") {
    text = upsertDirective(
      text,
      /^(\s*)DocumentRoot\s+"?[^"#\r\n]+"?/im,
      !!model.rootPath,
      `DocumentRoot "${model.rootPath}"`
    );
  } else if (model.mode !== "unknown") {
    text = upsertDirective(text, /^(\s*)DocumentRoot\s+"?[^"#\r\n]+"?/im, false, "");
  }
  if (model.mode === "proxy_pass" || model.mode === "mixed") {
    text = upsertDirective(
      text,
      /^(\s*)ProxyPass\s+\/\s+[^\s#\r\n]+/im,
      !!model.proxyPassTarget,
      `ProxyPass / ${model.proxyPassTarget}`
    );
    text = upsertDirective(
      text,
      /^(\s*)ProxyPassReverse\s+\/\s+[^\s#\r\n]+/im,
      !!model.proxyPassTarget,
      `ProxyPassReverse / ${model.proxyPassTarget}`
    );
  } else if (model.mode !== "unknown") {
    text = upsertDirective(text, /^(\s*)ProxyPass\s+\/\s+[^\s#\r\n]+/im, false, "");
    text = upsertDirective(text, /^(\s*)ProxyPassReverse\s+\/\s+[^\s#\r\n]+/im, false, "");
  }

  text = upsertDirective(
    text,
    /^(\s*)SSLProtocol\s+[^#\r\n]+/im,
    model.sslEnabled && !!model.tls.protocols,
    `SSLProtocol ${model.tls.protocols}`
  );
  text = upsertDirective(
    text,
    /^(\s*)SSLCipherSuite\s+[^#\r\n]+/im,
    model.sslEnabled && !!model.tls.ciphers,
    `SSLCipherSuite ${model.tls.ciphers}`
  );
  text = upsertDirective(
    text,
    /^(\s*)SSLSessionCache\s+[^#\r\n]+/im,
    model.sslEnabled && !!model.tls.sessionCache,
    `SSLSessionCache ${model.tls.sessionCache}`
  );
  text = upsertDirective(
    text,
    /^(\s*)SSLSessionCacheTimeout\s+\d+/im,
    model.sslEnabled && !!model.tls.sessionTimeout,
    `SSLSessionCacheTimeout ${model.tls.sessionTimeout}`
  );

  text = upsertDirective(text, /^(\s*)SetOutputFilter\s+.*DEFLATE/im, model.gzip.enabled, `SetOutputFilter DEFLATE`);
  // Multiple AddOutputFilterByType lines (one per MIME group) are removed as
  // a set and re-inserted as a set — upsertDirective's single-line
  // present/absent contract doesn't fit a variable-count directive, so this
  // block handles it directly rather than forcing it through upsertDirective.
  text = text.replace(/^\s*AddOutputFilterByType\s+DEFLATE\s+[^#\r\n]+\r?\n?/gim, "");
  if (model.gzip.enabled && model.gzip.types) {
    const mimeTypes = model.gzip.types.trim().split(/\s+/);
    const line = `    AddOutputFilterByType DEFLATE ${mimeTypes.join(" ")}\n`;
    if (!BLOCK_OPEN_RE.test(text)) throw new Error("cannot_locate_virtualhost_opening_tag");
    text = text.replace(BLOCK_OPEN_RE, (m) => `${m}${line}`);
  }

  for (const t of SNIPPET_TEMPLATES) {
    text = upsertSnippetTemplate(text, t.key, model.locations[t.key], model.rootPath ? `${model.rootPath}/assets` : null);
  }

  return rawConfig.slice(0, block.start) + text + rawConfig.slice(block.end);
}

/** "Create" mode counterpart to applyGuidedFields — Apache equivalent of
 * nginx.guidedEditor.ts's buildInitialVhostConfig, same
 * proxy_pass-mode-first / spaFallback-second / plain-root-default
 * precedence for the single content-serving slot every vhost needs exactly
 * one of. */
export function buildInitialVhostConfig(model: GuidedFormModel & { serverName: string; listenPort: number }): string {
  const lines: string[] = [
    `<VirtualHost *:${model.listenPort}>`,
    `    ServerName ${model.serverName}`,
    "",
  ];

  if (model.sslEnabled) lines.push(`    SSLEngine on`);
  if (model.sslEnabled && model.certPath) lines.push(`    SSLCertificateFile "${model.certPath}"`);
  if (model.sslEnabled && model.certKeyPath) lines.push(`    SSLCertificateKeyFile "${model.certKeyPath}"`);
  if (model.sslEnabled && model.tls.protocols) lines.push(`    SSLProtocol ${model.tls.protocols}`);
  if (model.sslEnabled && model.tls.ciphers) lines.push(`    SSLCipherSuite ${model.tls.ciphers}`);
  if (model.sslEnabled && model.tls.sessionCache) lines.push(`    SSLSessionCache ${model.tls.sessionCache}`);
  if (model.sslEnabled && model.tls.sessionTimeout) lines.push(`    SSLSessionCacheTimeout ${model.tls.sessionTimeout}`);
  if (model.clientMaxBodySize) {
    const bytes = parseBodySizeToBytes(model.clientMaxBodySize);
    if (bytes != null) lines.push(`    LimitRequestBody ${bytes}`);
  }
  for (const h of HEADER_DIRECTIVES) {
    if (model.headers[h.key]) lines.push(`    Header always set ${h.name} ${h.value}`);
  }
  if (model.gzip.enabled) {
    lines.push(`    SetOutputFilter DEFLATE`);
    if (model.gzip.types) lines.push(`    AddOutputFilterByType DEFLATE ${model.gzip.types}`);
  }
  if (model.locations.blockDotfiles) {
    const t = SNIPPET_TEMPLATES.find((x) => x.key === "blockDotfiles")!;
    lines.push("", t.block);
  }
  if (model.locations.cacheStaticAssets) {
    const t = SNIPPET_TEMPLATES.find((x) => x.key === "cacheStaticAssets")!;
    const assetsDir = model.rootPath ? `${model.rootPath}/assets` : "/var/www/html/assets";
    lines.push("", t.block.replace("ASSETS_DIR", assetsDir));
  }
  lines.push("");

  // Same "exactly one content-serving slot" precedence as nginx's
  // buildInitialVhostConfig: proxy_pass mode first, then root+spaFallback,
  // then plain root.
  if (model.mode === "proxy_pass" && model.proxyPassTarget) {
    lines.push(`    ProxyPass / ${model.proxyPassTarget}`, `    ProxyPassReverse / ${model.proxyPassTarget}`);
  } else if (model.rootPath && model.locations.spaFallback) {
    const t = SNIPPET_TEMPLATES.find((x) => x.key === "spaFallback")!;
    lines.push(`    DocumentRoot "${model.rootPath}"`, "", t.block);
  } else if (model.rootPath) {
    lines.push(`    DocumentRoot "${model.rootPath}"`);
  }
  lines.push("</VirtualHost>", "");

  return lines.join("\n");
}
