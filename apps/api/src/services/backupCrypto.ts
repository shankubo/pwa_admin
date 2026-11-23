import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  type KeyObject,
} from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { chmod, mkdir, open, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { env } from "../config/env.js";
import type { BackupEncryptionStatus } from "@pwa-admin/shared";

// File layout: MAGIC(8) | keyId(8) | ephemeralPublicKey(32) | iv(12) | AES-256-GCM ciphertext | tag(16)
// Hybrid scheme: each file gets its own throwaway X25519 key, so the server only
// ever needs the long-term PUBLIC key — it can encrypt but never decrypt.
const MAGIC = Buffer.from("PWAENC01");
const KEY_ID_LEN = 8;
const EPH_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = MAGIC.length + KEY_ID_LEN + EPH_LEN + IV_LEN;
export const ENCRYPTED_SUFFIX = ".enc";
export const ENCRYPTION_OVERHEAD = HEADER_LEN + TAG_LEN;
// A single GCM stream is only safe up to ~64 GiB.
const MAX_PLAINTEXT_BYTES = 60 * 1024 ** 3;

const PRIVATE_KEY_PREFIX = "pwa-admin-key-v1:";
const SPKI_X25519_PREFIX = Buffer.from("302a300506032b656e032100", "hex");
const PKCS8_X25519_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex");
const HKDF_INFO = "pwa-admin backup v1";

const pubPath = () => join(env.BACKUP_ENCRYPTION_KEY_DIR, "backup-encryption.pub");
const privatePath = () => join(env.BACKUP_ENCRYPTION_KEY_DIR, "backup-encryption.private");
// Empty marker: the admin ticked "I saved the key outside this server".
const savedMarkerPath = () => join(env.BACKUP_ENCRYPTION_KEY_DIR, "backup-encryption.saved");

async function readServerPrivateKey(): Promise<string | null> {
  if (!existsSync(privatePath())) return null;
  return (await readFile(privatePath(), "utf8")).trim() || null;
}

function rawPublic(key: KeyObject): Buffer {
  return (key.export({ type: "spki", format: "der" }) as Buffer).subarray(-32);
}

function rawPrivate(key: KeyObject): Buffer {
  return (key.export({ type: "pkcs8", format: "der" }) as Buffer).subarray(-32);
}

function publicFromRaw(raw: Buffer): KeyObject {
  return createPublicKey({ key: Buffer.concat([SPKI_X25519_PREFIX, raw]), format: "der", type: "spki" });
}

function privateFromRaw(raw: Buffer): KeyObject {
  return createPrivateKey({ key: Buffer.concat([PKCS8_X25519_PREFIX, raw]), format: "der", type: "pkcs8" });
}

function keyIdOf(rawPub: Buffer): Buffer {
  return createHash("sha256").update(rawPub).digest().subarray(0, KEY_ID_LEN);
}

function fingerprintOf(rawPub: Buffer): string {
  return createHash("sha256").update(rawPub).digest("hex").slice(0, 16).replace(/(.{4})(?=.)/g, "$1-");
}

function deriveKey(sharedSecret: Buffer, ephPub: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", sharedSecret, ephPub, HKDF_INFO, 32));
}

function parsePrivateKey(serialized: string): KeyObject {
  const trimmed = serialized.trim();
  if (!trimmed.startsWith(PRIVATE_KEY_PREFIX)) throw new Error("invalid_private_key_format");
  const raw = Buffer.from(trimmed.slice(PRIVATE_KEY_PREFIX.length), "base64");
  if (raw.length !== 32) throw new Error("invalid_private_key_format");
  return privateFromRaw(raw);
}

async function readPublicRaw(): Promise<Buffer | null> {
  if (!existsSync(pubPath())) return null;
  const raw = Buffer.from((await readFile(pubPath(), "utf8")).trim(), "base64");
  return raw.length === 32 ? raw : null;
}

export const BackupCrypto = {
  /** Called once at boot. Generates the keypair the first time only. The private
   * half stays in a 0600 file on this server so in-app restores work unattended;
   * it never reaches the USB drive or Drive, which is what protects those copies
   * if they are unplugged or leaked. The admin is still asked to keep their own
   * copy elsewhere, since losing this server would otherwise lose the key too. */
  async ensureKeyPair(): Promise<void> {
    if (existsSync(pubPath())) return;
    await mkdir(env.BACKUP_ENCRYPTION_KEY_DIR, { recursive: true, mode: 0o700 });
    const { publicKey, privateKey } = generateKeyPairSync("x25519");
    await writeFile(privatePath(), PRIVATE_KEY_PREFIX + rawPrivate(privateKey).toString("base64"), { mode: 0o600 });
    await chmod(privatePath(), 0o600).catch(() => {});
    await writeFile(pubPath(), rawPublic(publicKey).toString("base64"), { mode: 0o644 });
  },

  async status(): Promise<BackupEncryptionStatus> {
    const pub = await readPublicRaw();
    return {
      enabled: pub !== null,
      fingerprint: pub ? fingerprintOf(pub) : null,
      privateKeyOnServer: existsSync(privatePath()),
      savedConfirmed: existsSync(savedMarkerPath()),
    };
  },

  async hasServerPrivateKey(): Promise<boolean> {
    return (await readServerPrivateKey()) !== null;
  },

  async isEnabled(): Promise<boolean> {
    return (await readPublicRaw()) !== null;
  },

  async revealPrivateKey(): Promise<string> {
    const key = await readServerPrivateKey();
    if (!key) throw new Error("private_key_not_on_server");
    return key;
  },

  /** Records that the admin keeps their own copy outside this server. */
  async confirmPrivateKeySaved(): Promise<void> {
    await mkdir(env.BACKUP_ENCRYPTION_KEY_DIR, { recursive: true, mode: 0o700 });
    await writeFile(savedMarkerPath(), new Date().toISOString(), { mode: 0o600 });
  },

  /** Optional hardening: drop the server copy so restores must be given the key.
   * Refused until the admin confirmed holding their own copy — otherwise this
   * would make every encrypted backup permanently unreadable. */
  async removeServerPrivateKey(): Promise<void> {
    if (!existsSync(savedMarkerPath())) throw new Error("confirm_offline_copy_first");
    await unlink(privatePath()).catch(() => {});
  },

  async encryptFile(srcPath: string, destPath: string): Promise<{ sizeBytes: number }> {
    const recipientRaw = await readPublicRaw();
    if (!recipientRaw) throw new Error("backup_encryption_not_initialized");
    const srcSize = (await stat(srcPath)).size;
    if (srcSize > MAX_PLAINTEXT_BYTES) throw new Error("file_too_large_for_encryption");

    const eph = generateKeyPairSync("x25519");
    const ephPub = rawPublic(eph.publicKey);
    const shared = diffieHellman({ privateKey: eph.privateKey, publicKey: publicFromRaw(recipientRaw) });
    const iv = randomBytes(IV_LEN);
    const header = Buffer.concat([MAGIC, keyIdOf(recipientRaw), ephPub, iv]);

    const cipher = createCipheriv("aes-256-gcm", deriveKey(shared, ephPub), iv);
    cipher.setAAD(header);

    const out = createWriteStream(destPath);
    try {
      await new Promise<void>((resolve, reject) => out.write(header, (err) => (err ? reject(err) : resolve())));
      await pipeline(createReadStream(srcPath), cipher, out, { end: false });
      await new Promise<void>((resolve, reject) => out.write(cipher.getAuthTag(), (err) => (err ? reject(err) : resolve())));
      await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
    } catch (err) {
      out.destroy();
      await unlink(destPath).catch(() => {});
      throw err;
    }
    return { sizeBytes: srcSize + ENCRYPTION_OVERHEAD };
  },

  /** Uses the supplied key, else the one stored on this server; throws
   * `private_key_required` when neither exists so the UI can ask the admin. */
  async decryptFile(srcPath: string, destPath: string, privateKeySerialized?: string): Promise<void> {
    const serialized = privateKeySerialized?.trim() || (await readServerPrivateKey());
    if (!serialized) throw new Error("private_key_required");
    const privateKey = parsePrivateKey(serialized);
    const size = (await stat(srcPath)).size;
    if (size < ENCRYPTION_OVERHEAD) throw new Error("not_an_encrypted_backup");

    const fh = await open(srcPath, "r");
    let header: Buffer;
    let tag: Buffer;
    try {
      header = Buffer.alloc(HEADER_LEN);
      await fh.read(header, 0, HEADER_LEN, 0);
      tag = Buffer.alloc(TAG_LEN);
      await fh.read(tag, 0, TAG_LEN, size - TAG_LEN);
    } finally {
      await fh.close();
    }
    if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("not_an_encrypted_backup");

    const keyId = header.subarray(MAGIC.length, MAGIC.length + KEY_ID_LEN);
    const ownPub = rawPublic(createPublicKey(privateKey));
    if (!keyIdOf(ownPub).equals(keyId)) throw new Error("wrong_private_key");

    const ephPub = header.subarray(MAGIC.length + KEY_ID_LEN, MAGIC.length + KEY_ID_LEN + EPH_LEN);
    const iv = header.subarray(HEADER_LEN - IV_LEN, HEADER_LEN);
    const shared = diffieHellman({ privateKey, publicKey: publicFromRaw(ephPub) });

    const decipher = createDecipheriv("aes-256-gcm", deriveKey(shared, ephPub), iv);
    decipher.setAAD(header);
    decipher.setAuthTag(tag);

    try {
      await pipeline(
        createReadStream(srcPath, { start: HEADER_LEN, end: size - TAG_LEN - 1 }),
        decipher,
        createWriteStream(destPath)
      );
    } catch (err) {
      await unlink(destPath).catch(() => {});
      throw new Error(`decryption_failed_corrupted_or_tampered: ${(err as Error).message}`);
    }
  },

  async isEncryptedFile(path: string): Promise<boolean> {
    const fh = await open(path, "r").catch(() => null);
    if (!fh) return false;
    try {
      const buf = Buffer.alloc(MAGIC.length);
      const { bytesRead } = await fh.read(buf, 0, MAGIC.length, 0);
      return bytesRead === MAGIC.length && buf.equals(MAGIC);
    } finally {
      await fh.close();
    }
  },

  /** A remote size matches whether or not the copy was encrypted on the way out. */
  sizeMatchesPlainOrEncrypted(actual: number, plainSize: number): boolean {
    return actual === plainSize || actual === plainSize + ENCRYPTION_OVERHEAD;
  },
};
