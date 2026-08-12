import { NginxService } from "../nginx/nginx.service.js";
import { ApacheService } from "../apache/apache.service.js";
import { NullWebServerService } from "./webserver.nullService.js";
import { detectWebServerEngine } from "./detect.js";
import type { WebServerService } from "./webserver.types.js";

let resolved: WebServerService | null = null;

/**
 * Called once, at boot, in server.ts — before route registration. Never
 * re-run at runtime (see detect.ts's own doc comment for why). Module-level
 * singleton, not a DI container or factory: every other *Service in this
 * codebase (NginxService itself, DbBackupService, ServicesService, env,
 * the docker client, ...) is already a plain module-level singleton
 * imported directly by consumers — this is the one mechanism that doesn't
 * introduce a foreign pattern into an otherwise uniform codebase.
 */
export async function resolveWebServerService(): Promise<WebServerService> {
  const engine = await detectWebServerEngine();
  resolved = engine === "nginx" ? NginxService : engine === "apache" ? ApacheService : NullWebServerService;
  return resolved;
}

/**
 * Realistically never throws in production: server.ts awaits
 * resolveWebServerService() before api.register(...), and route HANDLERS
 * only ever run after app.listen() succeeds, long after boot-time detection
 * resolves. The throw exists purely to fail loudly instead of silently
 * returning undefined if a future refactor reorders server.ts.
 *
 * The private, git-untracked imanote plugin is the one documented exception
 * to "every consumer goes through webServer()" — it imports NginxService
 * directly by its unchanged export name/path, so it will only ever see
 * Nginx state even on a box where Apache is the detected engine. Not
 * fixable without editing a plugin this repo doesn't control the source of;
 * left as a known follow-up for that plugin's own maintainer.
 */
export function webServer(): WebServerService {
  if (!resolved) throw new Error("webserver_not_yet_resolved");
  return resolved;
}
