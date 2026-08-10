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
function splitServerBlocks(rawConfig: string): { start: number; end: number; text: string }[] {
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
 * Replaces every top-level `location` block inside HTTPS/443 `server {}`
 * blocks with a single maintenance-page location, leaving `listen`,
 * `server_name`, and `ssl_*` directives (and any plain-HTTP redirect
 * blocks) untouched — those still need to keep serving the site's own
 * certificate for TLS to terminate correctly. Server-level directives that
 * apply to every location by inheritance (auth_basic, etc.) are explicitly
 * turned off in the maintenance location so visitors aren't blocked from
 * seeing the maintenance page itself.
 */
export function applyMaintenanceMode(rawConfig: string, maintenanceRoot: string): string {
  const blocks = splitServerBlocks(rawConfig);
  let result = "";
  let cursor = 0;

  for (const block of blocks) {
    const isTls = /listen\s+[^;]*(443|ssl)/i.test(block.text);
    result += rawConfig.slice(cursor, block.start);

    if (!isTls) {
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
