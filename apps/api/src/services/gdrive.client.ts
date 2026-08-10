import { google } from "googleapis";
import { createReadStream, existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, basename } from "node:path";
import { env } from "../config/env.js";

// Full drive scope (not the narrower drive.file) is required because
// GDRIVE_ROOT_FOLDER_ID points at a folder the admin created manually in
// their own Drive UI, not one this app created via the API — drive.file only
// grants access to files/folders the app itself created, so listing that
// pre-existing root folder (needed for the local↔Drive comparison) would 404.
const SCOPES = ["https://www.googleapis.com/auth/drive"];

let cachedClient: InstanceType<typeof google.auth.OAuth2> | null = null;
const folderIdCache = new Map<string, string>();

function assertOAuthConfigured(): void {
  if (!env.GDRIVE_OAUTH_CLIENT_ID || !env.GDRIVE_OAUTH_CLIENT_SECRET) {
    throw new Error("gdrive_oauth_not_configured");
  }
}

function newOAuthClient() {
  assertOAuthConfigured();
  // "urn:ietf:wg:oauth:2.0:oob" (out-of-band): the admin pastes the authorization
  // code back manually via the app's own UI, rather than needing a public
  // redirect URI reachable from Google — appropriate since this app is only
  // ever reached over Tailscale, never a public URL Google could redirect to.
  return new google.auth.OAuth2(env.GDRIVE_OAUTH_CLIENT_ID, env.GDRIVE_OAUTH_CLIENT_SECRET, "urn:ietf:wg:oauth:2.0:oob");
}

async function getAuthorizedClient(): Promise<InstanceType<typeof google.auth.OAuth2>> {
  if (!env.GDRIVE_ENABLED) throw new Error("gdrive_disabled");
  if (cachedClient) return cachedClient;

  if (!existsSync(env.GDRIVE_OAUTH_TOKEN_PATH)) {
    throw new Error("gdrive_not_authorized");
  }

  const client = newOAuthClient();
  const token = JSON.parse(await readFile(env.GDRIVE_OAUTH_TOKEN_PATH, "utf8"));
  client.setCredentials(token);

  // Persist refreshed access tokens (and rotated refresh tokens, if Google issues one)
  // so future process restarts don't need re-authorization.
  client.on("tokens", (newTokens) => {
    const merged = { ...token, ...newTokens };
    writeFile(env.GDRIVE_OAUTH_TOKEN_PATH, JSON.stringify(merged, null, 2)).catch(() => {});
  });

  cachedClient = client;
  return client;
}

async function ensureFolder(name: string, parentId: string): Promise<string> {
  const cacheKey = `${parentId}/${name}`;
  const cached = folderIdCache.get(cacheKey);
  if (cached) return cached;

  const auth = await getAuthorizedClient();
  const drive = google.drive({ version: "v3", auth });

  const existing = await drive.files.list({
    q: `name = '${name}' and '${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id, name)",
  });
  if (existing.data.files?.[0]?.id) {
    folderIdCache.set(cacheKey, existing.data.files[0].id);
    return existing.data.files[0].id;
  }

  const created = await drive.files.create({
    requestBody: { name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] },
    fields: "id",
  });
  const id = created.data.id!;
  folderIdCache.set(cacheKey, id);
  return id;
}

export const GDriveAuthService = {
  /** Step 1 of the one-time authorization flow: URL the admin opens and signs in with. */
  getAuthUrl(): string {
    const client = newOAuthClient();
    return client.generateAuthUrl({ access_type: "offline", scope: SCOPES, prompt: "consent" });
  },

  /** Step 2: exchanges the code Google shows after consent for a token, persisted to disk. */
  async exchangeCode(code: string): Promise<void> {
    const client = newOAuthClient();
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) {
      throw new Error("no_refresh_token_returned_reauthorize_with_consent_prompt");
    }
    await mkdir(dirname(env.GDRIVE_OAUTH_TOKEN_PATH), { recursive: true });
    await writeFile(env.GDRIVE_OAUTH_TOKEN_PATH, JSON.stringify(tokens, null, 2));
    cachedClient = null; // force re-read on next use
  },

  isAuthorized(): boolean {
    return existsSync(env.GDRIVE_OAUTH_TOKEN_PATH);
  },

  async revoke(): Promise<void> {
    if (existsSync(env.GDRIVE_OAUTH_TOKEN_PATH)) {
      const client = await getAuthorizedClient().catch(() => null);
      if (client) await client.revokeCredentials().catch(() => {});
      const { unlink } = await import("node:fs/promises");
      await unlink(env.GDRIVE_OAUTH_TOKEN_PATH).catch(() => {});
    }
    cachedClient = null;
  },
};

export const GDriveService = {
  async uploadBackupFile(
    localPath: string,
    category: "volumes" | "db" | "paths" | "apps",
    sourceRef: string,
    onProgress?: (bytesUploaded: number, totalBytes: number) => void
  ): Promise<{ fileId: string; size: number }> {
    const auth = await getAuthorizedClient();
    const drive = google.drive({ version: "v3", auth });

    const categoryFolderId = await ensureFolder(category, env.GDRIVE_ROOT_FOLDER_ID);
    const sourceFolderId = await ensureFolder(sourceRef, categoryFolderId);

    const fileName = basename(localPath);
    const totalBytes = (await import("node:fs/promises").then((fs) => fs.stat(localPath))).size;

    const res = await drive.files.create(
      {
        requestBody: { name: fileName, parents: [sourceFolderId] },
        media: { body: createReadStream(localPath) },
        fields: "id, size",
      },
      onProgress
        ? {
            onUploadProgress: (evt) => onProgress(evt.bytesRead, totalBytes),
          }
        : undefined
    );

    return { fileId: res.data.id!, size: Number(res.data.size ?? 0) };
  },

  async verifyUpload(fileId: string, expectedSize: number): Promise<boolean> {
    const auth = await getAuthorizedClient();
    const drive = google.drive({ version: "v3", auth });
    const res = await drive.files.get({ fileId, fields: "size" });
    return Number(res.data.size ?? -1) === expectedSize;
  },

  async deleteFile(fileId: string): Promise<void> {
    const auth = await getAuthorizedClient();
    const drive = google.drive({ version: "v3", auth });
    await drive.files.delete({ fileId });
  },

  /** Downloads a Drive file's bytes to a local path — the counterpart to
   * uploadBackupFile, used to pull down a backup that only exists on Drive
   * (e.g. after wiping local data/ or on a fresh install) so it can be
   * restored through the normal local-file restore path. */
  async downloadFile(fileId: string, destPath: string): Promise<{ sizeBytes: number }> {
    const auth = await getAuthorizedClient();
    const drive = google.drive({ version: "v3", auth });

    await mkdir(dirname(destPath), { recursive: true });
    const res = await drive.files.get({ fileId, alt: "media" }, { responseType: "stream" });

    const { pipeline } = await import("node:stream/promises");
    const { createWriteStream } = await import("node:fs");
    await pipeline(res.data, createWriteStream(destPath));

    const { size } = await (await import("node:fs/promises")).stat(destPath);
    return { sizeBytes: size };
  },

  /**
   * Walks the whole backup folder tree on Drive (root/<category>/<sourceRef>/<file>,
   * matching the layout uploadBackupFile creates) and returns every file found.
   * Used to reconcile what's actually on Drive against local disk — the
   * backup_history table only tracks what this app instance itself uploaded,
   * not the ground truth of what's physically present in the Drive folder.
   */
  async listAllBackupFiles(): Promise<
    { category: string; sourceRef: string; fileName: string; fileId: string; sizeBytes: number; modifiedAt: string }[]
  > {
    const auth = await getAuthorizedClient();
    const drive = google.drive({ version: "v3", auth });

    async function listChildren(parentId: string): Promise<{ id: string; name: string; mimeType: string }[]> {
      const results: { id: string; name: string; mimeType: string }[] = [];
      let pageToken: string | undefined;
      do {
        const res = await drive.files.list({
          q: `'${parentId}' in parents and trashed = false`,
          fields: "nextPageToken, files(id, name, mimeType)",
          pageSize: 200,
          pageToken,
        });
        results.push(...((res.data.files ?? []) as { id: string; name: string; mimeType: string }[]));
        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken);
      return results;
    }

    const categories = await listChildren(env.GDRIVE_ROOT_FOLDER_ID);
    const entries: { category: string; sourceRef: string; fileName: string; fileId: string; sizeBytes: number; modifiedAt: string }[] = [];

    for (const category of categories) {
      if (category.mimeType !== "application/vnd.google-apps.folder") continue;
      const sourceRefs = await listChildren(category.id);
      for (const sourceRef of sourceRefs) {
        if (sourceRef.mimeType !== "application/vnd.google-apps.folder") continue;
        let pageToken: string | undefined;
        do {
          const res = await drive.files.list({
            q: `'${sourceRef.id}' in parents and trashed = false`,
            fields: "nextPageToken, files(id, name, size, modifiedTime, mimeType)",
            pageSize: 200,
            pageToken,
          });
          for (const f of res.data.files ?? []) {
            if (f.mimeType === "application/vnd.google-apps.folder") continue;
            entries.push({
              category: category.name,
              sourceRef: sourceRef.name,
              fileName: f.name!,
              fileId: f.id!,
              sizeBytes: Number(f.size ?? 0),
              modifiedAt: f.modifiedTime ?? "",
            });
          }
          pageToken = res.data.nextPageToken ?? undefined;
        } while (pageToken);
      }
    }

    return entries;
  },

  isEnabled(): boolean {
    return env.GDRIVE_ENABLED && GDriveAuthService.isAuthorized();
  },
};
