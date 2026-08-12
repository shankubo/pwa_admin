import { existsSync } from "node:fs";
import type { NginxVhostSummary } from "@pwa-admin/shared";

/**
 * Minimal server-block parser for the fields the UI needs (server_name, listen,
 * root, proxy_pass). Not a full nginx-config-grammar parser — good enough for
 * listing/summary purposes; the raw config is always shown/edited verbatim.
 */
export function parseVhostSummary(
  name: string,
  rawConfig: string,
  enabled: boolean,
  maintenanceMode = false
): NginxVhostSummary {
  const serverNames = new Set<string>();
  const listenPorts = new Set<number>();
  let proxyPassTarget: string | null = null;
  let root: string | null = null;

  const serverNameMatches = rawConfig.matchAll(/server_name\s+([^;]+);/g);
  for (const m of serverNameMatches) {
    for (const n of m[1].trim().split(/\s+/)) serverNames.add(n);
  }

  const listenMatches = rawConfig.matchAll(/listen\s+([^;]+);/g);
  for (const m of listenMatches) {
    const portMatch = /(\d+)/.exec(m[1]);
    if (portMatch) listenPorts.add(Number(portMatch[1]));
  }

  const proxyPassMatch = /proxy_pass\s+([^;]+);/.exec(rawConfig);
  if (proxyPassMatch) proxyPassTarget = proxyPassMatch[1].trim();

  const rootMatch = /^\s*root\s+([^;]+);/m.exec(rawConfig);
  if (rootMatch) root = rootMatch[1].trim();

  return {
    engine: "nginx",
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
 * Splits a vhost file into top-level `server { ... }` blocks by brace
 * depth (nginx configs can nest braces inside e.g. `location` or `if`),
 * returning each block's full text plus its start/end offsets in the source.
 */
export function splitServerBlocks(rawConfig: string): { start: number; end: number; text: string }[] {
  const blocks: { start: number; end: number; text: string }[] = [];
  const re = /server\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(rawConfig))) {
    const blockStart = match.index;
    let depth = 1;
    let i = match.index + match[0].length;
    while (i < rawConfig.length && depth > 0) {
      if (rawConfig[i] === "{") depth++;
      else if (rawConfig[i] === "}") depth--;
      i++;
    }
    if (depth === 0) {
      blocks.push({ start: blockStart, end: i, text: rawConfig.slice(blockStart, i) });
      re.lastIndex = i;
    }
  }
  return blocks;
}

/**
 * A server block whose only job is bouncing HTTP to HTTPS (or to another
 * host/path) — swapping its location for the maintenance page would be a
 * no-op for visitors anyway (they'd just get redirected again), so it's
 * left untouched.
 */
export function isRedirectOnlyBlock(blockText: string): boolean {
  const withoutLocations = stripLocationBlocks(blockText);
  // Whatever remains outside location{} blocks must contain no directive
  // besides the handful that are safe on a bare server{} (listen,
  // server_name, comments, braces) — a real content-serving directive
  // (root/proxy_pass/return inside a location) only shows up inside those
  // location blocks we already stripped, EXCEPT a server-level `return`,
  // which is exactly the redirect-only pattern this function detects.
  const hasServerLevelReturn = /^\s*return\s+30[12378]\s+https?:\/\//im.test(withoutLocations);
  const hasServerLevelRewrite = /^\s*rewrite\s+.*\bhttps:\/\//im.test(withoutLocations);
  if (!hasServerLevelReturn && !hasServerLevelRewrite) return false;

  // If there's also a real location block serving content, this isn't a
  // pure redirect vhost — don't misclassify it.
  const locationMatches = blockText.matchAll(/location\s+[^{]*\{([^{}]|\{[^{}]*\})*\}/g);
  for (const loc of locationMatches) {
    if (/proxy_pass|root\s+|try_files/.test(loc[0]) && !/return\s+30[12378]/.test(loc[0])) {
      return false;
    }
  }
  return true;
}

/**
 * Replaces every top-level `location` block inside content-serving `server
 * {}` blocks with a single maintenance-page location, leaving `listen`,
 * `server_name`, and `ssl_*` directives untouched — those still need to
 * keep serving the site's own certificate for TLS to terminate correctly
 * when present. A block is skipped only if it's a pure HTTP->HTTPS (or
 * similar) redirect with no content of its own — TLS-terminated blocks
 * (443/ssl) AND plain-HTTP blocks that actually serve the site directly
 * (e.g. TLS terminated upstream by a proxy/tunnel in front of this host)
 * are both eligible. Server-level directives that apply to every location
 * by inheritance (auth_basic, etc.) are explicitly turned off in the
 * maintenance location so visitors aren't blocked from seeing the
 * maintenance page itself.
 */
export function applyMaintenanceMode(rawConfig: string, maintenanceRoot: string): string {
  const blocks = splitServerBlocks(rawConfig);
  let result = "";
  let cursor = 0;

  for (const block of blocks) {
    const redirectOnly = isRedirectOnlyBlock(block.text);
    result += rawConfig.slice(cursor, block.start);

    if (redirectOnly) {
      result += block.text;
    } else {
      const withoutLocations = stripLocationBlocks(block.text);
      const closingBraceIndex = withoutLocations.lastIndexOf("}");
      const hasAuthBasic = /^\s*auth_basic\s+/m.test(block.text);
      const maintenanceLocation = `
    location / {
        ${hasAuthBasic ? "auth_basic off;\n        " : ""}root ${maintenanceRoot};
        try_files /index.html =503;
    }
`;
      result +=
        withoutLocations.slice(0, closingBraceIndex) +
        maintenanceLocation +
        withoutLocations.slice(closingBraceIndex);
    }
    cursor = block.end;
  }
  result += rawConfig.slice(cursor);
  return result;
}

/**
 * Rewrites every content-serving server{} block's `root` and/or `proxy_pass`
 * directive value in place — sibling to applyMaintenanceMode, but substitutes
 * directive values instead of swapping in a synthetic location block, so
 * every existing `location` block's own structure (headers, rewrites, etc.)
 * is preserved verbatim. Which directive(s) get rewritten is driven by which
 * of newRoot/newProxyPass is passed — a mixed vhost (both root and proxy_pass
 * present) gets both rewritten in the same pass, matching the current shape
 * of the vhost being switched.
 */
export function applyFailoverRewrite(
  rawConfig: string,
  target: { newRoot?: string; newProxyPass?: string }
): string {
  const blocks = splitServerBlocks(rawConfig);
  let result = "";
  let cursor = 0;

  for (const block of blocks) {
    result += rawConfig.slice(cursor, block.start);

    if (isRedirectOnlyBlock(block.text)) {
      result += block.text;
    } else {
      let rewritten = block.text;
      if (target.newRoot) {
        rewritten = rewritten.replace(/^(\s*)root\s+[^;]+;/m, `$1root ${target.newRoot};`);
      }
      if (target.newProxyPass) {
        rewritten = rewritten.replace(/^(\s*)proxy_pass\s+[^;]+;/m, `$1proxy_pass ${target.newProxyPass};`);
      }
      result += rewritten;
    }
    cursor = block.end;
  }
  result += rawConfig.slice(cursor);
  return result;
}

function stripLocationBlocks(serverBlockText: string): string {
  let result = "";
  let cursor = 0;
  const re = /location\s+[^{]*\{/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(serverBlockText))) {
    result += serverBlockText.slice(cursor, match.index);
    let depth = 1;
    let i = match.index + match[0].length;
    while (i < serverBlockText.length && depth > 0) {
      if (serverBlockText[i] === "{") depth++;
      else if (serverBlockText[i] === "}") depth--;
      i++;
    }
    cursor = i;
    re.lastIndex = i;
  }
  result += serverBlockText.slice(cursor);
  return result;
}
