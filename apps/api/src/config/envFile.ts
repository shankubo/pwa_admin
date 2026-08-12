import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const ENV_PATH = join(REPO_ROOT, ".env");

/**
 * Surgically updates specific KEY=value lines in the repo's own .env file —
 * used by Settings' Google Drive config form (GDRIVE_ENABLED/CLIENT_ID/
 * CLIENT_SECRET) so the admin doesn't have to SSH in and hand-edit .env for
 * this one integration. Deliberately narrow: only ever rewrites the exact
 * keys passed in, appending a line for a key that doesn't exist yet, never
 * touching any other line (comments, JWT secrets, unrelated config) — this
 * file is the single most sensitive one in the deployment (it also holds
 * JWT_ACCESS_SECRET/JWT_REFRESH_SECRET), so a full parse-rewrite-serialize
 * round trip that could reformat/reorder/drop something is deliberately
 * avoided in favor of line-level find-and-replace on the raw text.
 *
 * Does NOT reload process.env or apps/api/src/config/env.ts's already-parsed
 * `env` object — that's a one-time module-level parse at process start
 * (see env.ts), so a changed value only takes effect after the admin
 * restarts the service themselves, same as every other .env change in this
 * project (CLAUDE.md's own documented restart flow).
 */
export async function updateEnvKeys(updates: Record<string, string>): Promise<void> {
  let content = "";
  try {
    content = await readFile(ENV_PATH, "utf8");
  } catch {
    content = "";
  }

  const lines = content.length > 0 ? content.split("\n") : [];
  const remainingKeys = new Set(Object.keys(updates));

  for (let i = 0; i < lines.length; i++) {
    const match = /^([A-Z0-9_]+)=/.exec(lines[i]);
    if (match && remainingKeys.has(match[1])) {
      lines[i] = `${match[1]}=${updates[match[1]]}`;
      remainingKeys.delete(match[1]);
    }
  }

  for (const key of remainingKeys) {
    lines.push(`${key}=${updates[key]}`);
  }

  // Drop a single trailing empty line the split() above may have produced
  // (a file ending in "\n"), then rejoin with one — avoids the file growing
  // an extra blank line on every save.
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  await writeFile(ENV_PATH, lines.join("\n") + "\n", "utf8");
}
