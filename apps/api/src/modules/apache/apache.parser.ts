import { existsSync } from "node:fs";
import type { VhostSummary } from "@pwa-admin/shared";

/**
 * A directive value containing a double-quote or a line break could break
 * out of the quoted-value substitution applyMaintenanceMode/
 * applyFailoverRewrite do below and inject an additional directive into the
 * rewritten config — apache2ctl configtest would still accept the result
 * (it'd be syntactically valid Apache config, just not the single-directive
 * substitution the caller intended). Every current caller derives these
 * values from already-validated same-server paths/ports/env config, never
 * raw HTTP input, so this is defense-in-depth rather than a live exploit
 * path — but the check costs nothing and keeps both functions safe even if
 * a future caller widens what feeds them.
 */
function assertSafeDirectiveValue(value: string): void {
  if (/["\r\n]/.test(value)) throw new Error("unsafe_directive_value");
}

/**
 * Minimal <VirtualHost> block parser for the fields the UI needs (ServerName/
 * ServerAlias, the port from the VirtualHost declaration itself, DocumentRoot,
 * ProxyPass). Direct Apache counterpart of nginx.parser.ts's
 * parseVhostSummary — same "good enough for listing/summary, raw config
 * always shown/edited verbatim" scope, not a full Apache-config-grammar
 * parser.
 *
 * Apache's port lives in the VirtualHost declaration itself
 * (`<VirtualHost *:443>`), unlike nginx where `listen` is a directive inside
 * the block — matched separately from ServerName/DocumentRoot for that
 * reason. A file can also declare multiple <VirtualHost> blocks (e.g. one
 * per port) sharing the same ServerName; all their ports are collected into
 * one listenPorts array, same aggregation nginx's multi-`listen`-directive
 * case already does.
 */
export function parseVhostSummary(
  name: string,
  rawConfig: string,
  enabled: boolean,
  maintenanceMode = false
): VhostSummary {
  const serverNames = new Set<string>();
  const listenPorts = new Set<number>();
  let proxyPassTarget: string | null = null;
  let root: string | null = null;

  const vhostOpenMatches = rawConfig.matchAll(/<VirtualHost\s+[^:>]*:(\d+)\s*>/gi);
  for (const m of vhostOpenMatches) {
    listenPorts.add(Number(m[1]));
  }

  const serverNameMatches = rawConfig.matchAll(/^\s*ServerName\s+([^\s#]+)/gim);
  for (const m of serverNameMatches) serverNames.add(m[1].trim());

  const serverAliasMatches = rawConfig.matchAll(/^\s*ServerAlias\s+([^\r\n#]+)/gim);
  for (const m of serverAliasMatches) {
    for (const n of m[1].trim().split(/\s+/)) serverNames.add(n);
  }

  // First ProxyPass whose path is "/" (or bare) — a vhost with several
  // path-scoped ProxyPass lines (e.g. /api -> one backend, / -> another)
  // reports the root one, same "one representative target" scope nginx's
  // single proxy_pass regex already has (nginx vhosts here are likewise
  // assumed single-proxy-target for summary purposes).
  const proxyPassMatch = /^\s*ProxyPass\s+\/\s+([^\s#]+)/im.exec(rawConfig);
  if (proxyPassMatch) proxyPassTarget = proxyPassMatch[1].trim();

  const rootMatch = /^\s*DocumentRoot\s+"?([^"#\r\n]+)"?/im.exec(rawConfig);
  if (rootMatch) root = rootMatch[1].trim();

  return {
    engine: "apache",
    name,
    enabled,
    serverNames: [...serverNames],
    listenPorts: [...listenPorts],
    proxyPassTarget,
    root,
    documentRootExists: root ? existsSync(root) : null,
    maintenanceMode,
  };
}

/**
 * Splits a vhost file into top-level <VirtualHost ...>...</VirtualHost>
 * blocks, returning each block's full text plus its start/end offsets —
 * direct Apache counterpart of nginx.parser.ts's splitServerBlocks. Apache
 * blocks are XML-style tag pairs rather than brace-depth-counted, so this
 * doesn't need splitServerBlocks' brace-counting walk: <VirtualHost> blocks
 * never nest (unlike nginx's location{} blocks inside server{}), a plain
 * open/close tag scan is sufficient.
 */
export function splitVirtualHostBlocks(rawConfig: string): { start: number; end: number; text: string }[] {
  const blocks: { start: number; end: number; text: string }[] = [];
  const re = /<VirtualHost\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(rawConfig))) {
    const blockStart = match.index;
    const closeMatch = /<\/VirtualHost>/i.exec(rawConfig.slice(match.index));
    if (!closeMatch) continue;
    const blockEnd = match.index + closeMatch.index + closeMatch[0].length;
    blocks.push({ start: blockStart, end: blockEnd, text: rawConfig.slice(blockStart, blockEnd) });
    re.lastIndex = blockEnd;
  }
  return blocks;
}

/**
 * A <VirtualHost> block whose only job is bouncing HTTP to HTTPS (or to
 * another host/path) — swapping its DocumentRoot for the maintenance page
 * would be a no-op for visitors anyway. Direct counterpart of
 * isRedirectOnlyBlock: `Redirect`/`RedirectMatch` to an https:// target, or
 * a `RewriteRule ... https://... [R=301,L]`, with no real content-serving
 * directive (DocumentRoot backed by a <Directory>/ProxyPass actually
 * routing content) elsewhere in the block.
 */
export function isRedirectOnlyBlock(blockText: string): boolean {
  const hasRedirect = /^\s*Redirect(Match)?\s+(30[12378]\s+)?\S+\s+https?:\/\//im.test(blockText);
  const hasRewriteRedirect = /^\s*RewriteRule\s+.*https:\/\/.*\[[^\]]*R=30[12378][^\]]*\]/im.test(blockText);
  if (!hasRedirect && !hasRewriteRedirect) return false;

  // A DocumentRoot or ProxyPass actually present alongside the redirect
  // means this vhost also serves real content — don't misclassify it, same
  // "don't over-detect" guard as nginx's location-block scan.
  if (/^\s*DocumentRoot\s+/im.test(blockText)) return false;
  if (/^\s*ProxyPass\s+\/\s+/im.test(blockText)) return false;
  return true;
}

/**
 * Swaps a content-serving <VirtualHost> block's DocumentRoot for the
 * maintenance page directory, and comments out any ProxyPass/ProxyPassReverse
 * lines (Apache has no location{}-equivalent sub-block to swap the way nginx
 * does — the whole vhost's content-serving directive is what gets replaced).
 * `Listen`/`ServerName`/`ServerAlias`/`SSLEngine`/`SSLCertificateFile`/
 * `SSLCertificateKeyFile` are left untouched so the site's own certificate
 * keeps terminating TLS.
 *
 * The auth-shadow lesson nginx's applyMaintenanceMode already encodes has a
 * direct Apache parallel: if the block declares `AuthType`/`Require
 * valid-user` (whether at VirtualHost level or inside a <Directory> that
 * would otherwise still apply to the new DocumentRoot), Apache's
 * authentication would block the maintenance page itself exactly like
 * nginx's inherited auth_basic would — so an explicit
 * `<Directory "maintenanceRoot"> Require all granted </Directory>` block is
 * injected whenever auth directives are present, scoped only to the
 * maintenance root.
 */
export function applyMaintenanceMode(rawConfig: string, maintenanceRoot: string): string {
  assertSafeDirectiveValue(maintenanceRoot);
  const blocks = splitVirtualHostBlocks(rawConfig);
  let result = "";
  let cursor = 0;

  for (const block of blocks) {
    result += rawConfig.slice(cursor, block.start);

    if (isRedirectOnlyBlock(block.text)) {
      result += block.text;
    } else {
      const hasAuth = /^\s*(AuthType\s+|Require\s+valid-user)/im.test(block.text);
      const authOverride = hasAuth
        ? `    <Directory "${maintenanceRoot}">\n        Require all granted\n    </Directory>\n`
        : "";

      let rewritten = block.text.replace(/^(\s*)DocumentRoot\s+"?[^"#\r\n]+"?/im, `$1DocumentRoot "${maintenanceRoot}"`);
      rewritten = rewritten.replace(/^(\s*)(ProxyPass(Reverse)?\s+.*)$/gim, "$1#$2");

      // No DocumentRoot existed at all (a pure-proxy vhost with no fallback
      // content directive) — inject one right after the opening tag rather
      // than relying on the (now-absent) replace above having matched.
      if (!/^\s*DocumentRoot\s+/im.test(rewritten)) {
        rewritten = rewritten.replace(/(<VirtualHost\b[^>]*>\s*\n)/i, `$1    DocumentRoot "${maintenanceRoot}"\n`);
      }

      const closeTagIndex = rewritten.search(/<\/VirtualHost>/i);
      rewritten = rewritten.slice(0, closeTagIndex) + authOverride + rewritten.slice(closeTagIndex);

      result += rewritten;
    }
    cursor = block.end;
  }
  result += rawConfig.slice(cursor);
  return result;
}

/**
 * Rewrites a content-serving <VirtualHost> block's DocumentRoot and/or
 * ProxyPass target in place — direct Apache counterpart of nginx's
 * applyFailoverRewrite, same snapshot-before/test-after/revert-on-failure
 * caller contract (see apache.service.ts's switchToDuplicate).
 */
export function applyFailoverRewrite(
  rawConfig: string,
  target: { newRoot?: string; newProxyPass?: string }
): string {
  if (target.newRoot) assertSafeDirectiveValue(target.newRoot);
  if (target.newProxyPass) assertSafeDirectiveValue(target.newProxyPass);

  const blocks = splitVirtualHostBlocks(rawConfig);
  let result = "";
  let cursor = 0;

  for (const block of blocks) {
    result += rawConfig.slice(cursor, block.start);

    if (isRedirectOnlyBlock(block.text)) {
      result += block.text;
    } else {
      let rewritten = block.text;
      if (target.newRoot) {
        rewritten = rewritten.replace(/^(\s*)DocumentRoot\s+"?[^"#\r\n]+"?/im, `$1DocumentRoot "${target.newRoot}"`);
      }
      if (target.newProxyPass) {
        rewritten = rewritten.replace(/^(\s*)ProxyPass\s+\/\s+[^\s#]+/im, `$1ProxyPass / ${target.newProxyPass}`);
        rewritten = rewritten.replace(
          /^(\s*)ProxyPassReverse\s+\/\s+[^\s#]+/im,
          `$1ProxyPassReverse / ${target.newProxyPass}`
        );
      }
      result += rewritten;
    }
    cursor = block.end;
  }
  result += rawConfig.slice(cursor);
  return result;
}
