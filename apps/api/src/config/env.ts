import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { z } from "zod";

// Resolve paths relative to the monorepo root regardless of the process's cwd,
// which differs between `npm run --workspace=apps/api` (cwd=apps/api) during
// dev/scripts and the systemd unit's WorkingDirectory (repo root) in production.
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
loadDotenv({ path: join(REPO_ROOT, ".env") });

function resolveFromRoot(path: string): string {
  return path.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(path) ? path : join(REPO_ROOT, path);
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8443),
  HOST: z.string().default("0.0.0.0"),
  TLS_CERT_PATH: z.string().optional(),
  TLS_KEY_PATH: z.string().optional(),

  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 chars"),
  JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET must be at least 32 chars"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("7d"),
  TOTP_ISSUER: z.string().default("PiAdmin"),

  SQLITE_PATH: z.string().default("./data/app.db"),

  DOCKER_SOCKET_PATH: z.string().default("/var/run/docker.sock"),

  // The OS account this service runs as — read explicitly rather than
  // process.env.USER, which systemd's Type=simple + User= never populates
  // (that's a login-shell/PAM convention). Must match the sudoers "chown
  // ${SERVICE_USER} ..." rules exactly. "shan" as a default only matches the
  // two existing shan-based servers; a --create-user install sets this via
  // install.sh, and must not silently fall back to this default.
  SERVICE_USER: z.string().default("shan"),

  NGINX_SITES_AVAILABLE: z.string().default("/etc/nginx/sites-available"),
  NGINX_SITES_ENABLED: z.string().default("/etc/nginx/sites-enabled"),
  NGINX_CONF_D: z.string().default("/etc/nginx/conf.d"),
  NGINX_LOG_DIR: z.string().default("/var/log/nginx"),
  NGINX_BINARY_PATH: z.string().default("/usr/sbin/nginx"),
  NGINX_CONFIG_BACKUP_DIR: z.string().default("./data/nginx-config-history"),
  NGINX_MAINTENANCE_ROOT: z.string().default("/var/www/server-admin-maintenance"),
  CERTBOT_LIVE_DIR: z.string().default("/etc/letsencrypt/live"),
  // Certs imported (upload or paste) through the guided editor land here —
  // owned by the service user like the rest of data/, so writing a new cert
  // never needs a new sudo rule (unlike the read-only /etc/letsencrypt and
  // /etc/ssl paths checkCertPathExists probes for admin-placed certs).
  NGINX_MANAGED_CERTS_DIR: z.string().default("./data/nginx-certs"),

  // Apache (httpd) support — v1 targets Debian/Ubuntu's `apache2` package
  // conventions only (see the Apache-parity implementation plan for why
  // RHEL/httpd's differing layout is out of scope). Mirrors the NGINX_* set
  // above field-for-field so ApacheService's own logic stays a direct
  // parallel of NginxService's.
  APACHE_SITES_AVAILABLE: z.string().default("/etc/apache2/sites-available"),
  APACHE_SITES_ENABLED: z.string().default("/etc/apache2/sites-enabled"),
  APACHE_LOG_DIR: z.string().default("/var/log/apache2"),
  APACHE_BINARY_PATH: z.string().default("/usr/sbin/apache2"),
  APACHE_CTL_PATH: z.string().default("/usr/sbin/apache2ctl"),
  APACHE_CONFIG_BACKUP_DIR: z.string().default("./data/apache-config-history"),
  APACHE_MAINTENANCE_ROOT: z.string().default("/var/www/server-admin-maintenance"),
  APACHE_MANAGED_CERTS_DIR: z.string().default("./data/apache-certs"),

  OS_MODULE_ENABLED: z.coerce.boolean().default(true),
  APT_ALLOW_INSTALL_REMOVE: z.coerce.boolean().default(false),
  APT_JOB_LOG_DIR: z.string().default("./data/apt-job-logs"),

  NETWORK_MODULE_ENABLED: z.coerce.boolean().default(true),
  FAIL2BAN_ENABLED: z.coerce.boolean().default(true),
  FAIL2BAN_CLIENT_PATH: z.string().default("/usr/bin/fail2ban-client"),
  FAIL2BAN_DEFAULT_JAIL: z.string().default("sshd"),
  ANALYTICS_LOG_LINE_CAP: z.coerce.number().int().positive().default(200000),

  BACKUP_LOCAL_ROOT: z.string().default("./data/backups"),
  BACKUP_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  BACKUP_RETENTION_MIN_COPIES: z.coerce.number().int().nonnegative().default(3),

  // Google Drive backup: OAuth2 (not a Service Account — service accounts have no
  // storage quota on personal/consumer Drive, only on Workspace Shared Drives).
  GDRIVE_ENABLED: z.coerce.boolean().default(false),
  GDRIVE_OAUTH_CLIENT_ID: z.string().optional(),
  GDRIVE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GDRIVE_OAUTH_TOKEN_PATH: z.string().default("./secrets/gdrive-oauth-token.json"),
  GDRIVE_ROOT_FOLDER_ID: z.string().default(""),

  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
  LOGIN_RATE_LIMIT_WINDOW: z.string().default("1m"),

  ALERT_TEMP_WARN_C: z.coerce.number().default(70),
  ALERT_TEMP_CRIT_C: z.coerce.number().default(80),
  ALERT_DISK_WARN_PCT: z.coerce.number().default(80),
  ALERT_DISK_CRIT_PCT: z.coerce.number().default(90),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  APP_DIR: REPO_ROOT,
  SQLITE_PATH: resolveFromRoot(parsed.data.SQLITE_PATH),
  NGINX_CONFIG_BACKUP_DIR: resolveFromRoot(parsed.data.NGINX_CONFIG_BACKUP_DIR),
  NGINX_MANAGED_CERTS_DIR: resolveFromRoot(parsed.data.NGINX_MANAGED_CERTS_DIR),
  APACHE_CONFIG_BACKUP_DIR: resolveFromRoot(parsed.data.APACHE_CONFIG_BACKUP_DIR),
  APACHE_MANAGED_CERTS_DIR: resolveFromRoot(parsed.data.APACHE_MANAGED_CERTS_DIR),
  APT_JOB_LOG_DIR: resolveFromRoot(parsed.data.APT_JOB_LOG_DIR),
  BACKUP_LOCAL_ROOT: resolveFromRoot(parsed.data.BACKUP_LOCAL_ROOT),
  GDRIVE_OAUTH_TOKEN_PATH: resolveFromRoot(parsed.data.GDRIVE_OAUTH_TOKEN_PATH),
  TLS_CERT_PATH: parsed.data.TLS_CERT_PATH ? resolveFromRoot(parsed.data.TLS_CERT_PATH) : undefined,
  TLS_KEY_PATH: parsed.data.TLS_KEY_PATH ? resolveFromRoot(parsed.data.TLS_KEY_PATH) : undefined,
};
export type Env = typeof env;
