import { existsSync } from "node:fs";
import type { NginxVhostSummary } from "@pwa-admin-pi/shared";

/**
 * Minimal server-block parser for the fields the UI needs (server_name, listen,
 * root, proxy_pass). Not a full nginx-config-grammar parser — good enough for
 * listing/summary purposes; the raw config is always shown/edited verbatim.
 */
export function parseVhostSummary(name: string, rawConfig: string, enabled: boolean): NginxVhostSummary {
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
  };
}
