#!/usr/bin/env node
// Standalone decryptor for pwa-admin backup copies (*.tar.gz.enc) — works without
// the application, on any machine with Node.js 16+ and no npm dependency.
//
//   node decrypt-backup.mjs <input.enc> <output> --key-file <file>
//   node decrypt-backup.mjs <input.enc> <output> --key "pwa-admin-key-v1:..."
//   PWA_BACKUP_KEY="pwa-admin-key-v1:..." node decrypt-backup.mjs <input.enc> <output>
//
// Prefer --key-file or the environment variable: a key passed with --key stays in
// your shell history. The private key is the one shown once in the app (Backups →
// "Gardez une copie de votre clé privée").
//
// File format (see apps/api/src/services/backupCrypto.ts):
//   MAGIC "PWAENC01" (8) | keyId (8) | ephemeral X25519 public key (32) | iv (12)
//   | AES-256-GCM ciphertext | auth tag (16)
// The AES key comes from X25519(your private key, ephemeral public key) run through
// HKDF-SHA256 (salt = ephemeral public key, info = "pwa-admin backup v1"); the 60
// header bytes are authenticated as additional data.

import {
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  hkdfSync,
} from "node:crypto";
import { closeSync, createReadStream, createWriteStream, openSync, readFileSync, readSync, statSync, unlinkSync } from "node:fs";
import { pipeline } from "node:stream/promises";

const MAGIC = Buffer.from("PWAENC01");
const KEY_ID_LEN = 8;
const EPH_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = MAGIC.length + KEY_ID_LEN + EPH_LEN + IV_LEN;
const KEY_PREFIX = "pwa-admin-key-v1:";
const PKCS8_X25519_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex");
const SPKI_X25519_PREFIX = Buffer.from("302a300506032b656e032100", "hex");

function fail(message) {
  console.error(`Erreur : ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const positional = [];
  let keyFile = null;
  let keyInline = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--key-file") keyFile = argv[++i];
    else if (argv[i] === "--key") keyInline = argv[++i];
    else positional.push(argv[i]);
  }
  return { positional, keyFile, keyInline };
}

const { positional, keyFile, keyInline } = parseArgs(process.argv.slice(2));
if (positional.length !== 2) {
  console.error("Usage : node decrypt-backup.mjs <fichier.tar.gz.enc> <sortie.tar.gz> --key-file <cle.txt>");
  process.exit(2);
}
const [inputPath, outputPath] = positional;

let serialized = keyInline ?? process.env.PWA_BACKUP_KEY ?? null;
if (keyFile) serialized = readFileSync(keyFile, "utf8");
if (!serialized) fail("aucune clé privée fournie (--key-file, --key ou variable PWA_BACKUP_KEY).");
serialized = serialized.trim();
if (!serialized.startsWith(KEY_PREFIX)) fail(`format de clé invalide : elle doit commencer par « ${KEY_PREFIX} ».`);
const rawPrivate = Buffer.from(serialized.slice(KEY_PREFIX.length), "base64");
if (rawPrivate.length !== 32) fail("format de clé invalide (longueur incorrecte).");

const privateKey = createPrivateKey({ key: Buffer.concat([PKCS8_X25519_PREFIX, rawPrivate]), format: "der", type: "pkcs8" });
const ownPublicRaw = createPublicKey(privateKey).export({ type: "spki", format: "der" }).subarray(-32);

const size = statSync(inputPath).size;
if (size < HEADER_LEN + TAG_LEN) fail("ce fichier est trop petit pour être une archive chiffrée.");

const header = Buffer.alloc(HEADER_LEN);
const tag = Buffer.alloc(TAG_LEN);
const fd = openSync(inputPath, "r");
try {
  readSync(fd, header, 0, HEADER_LEN, 0);
  readSync(fd, tag, 0, TAG_LEN, size - TAG_LEN);
} finally {
  closeSync(fd);
}

if (!header.subarray(0, MAGIC.length).equals(MAGIC)) fail("ce fichier n'est pas une archive chiffrée pwa-admin (signature PWAENC01 absente).");

const keyId = header.subarray(MAGIC.length, MAGIC.length + KEY_ID_LEN);
const expectedKeyId = createHash("sha256").update(ownPublicRaw).digest().subarray(0, KEY_ID_LEN);
if (!keyId.equals(expectedKeyId)) fail("cette clé privée ne correspond pas à cette archive (autre serveur ou autre clé ?).");

const ephPublicRaw = header.subarray(MAGIC.length + KEY_ID_LEN, MAGIC.length + KEY_ID_LEN + EPH_LEN);
const iv = header.subarray(HEADER_LEN - IV_LEN, HEADER_LEN);
const ephPublic = createPublicKey({ key: Buffer.concat([SPKI_X25519_PREFIX, ephPublicRaw]), format: "der", type: "spki" });
const shared = diffieHellman({ privateKey, publicKey: ephPublic });
const aesKey = Buffer.from(hkdfSync("sha256", shared, ephPublicRaw, "pwa-admin backup v1", 32));

const decipher = createDecipheriv("aes-256-gcm", aesKey, iv);
decipher.setAAD(header);
decipher.setAuthTag(tag);

const payloadEnd = size - TAG_LEN - 1;
const source =
  payloadEnd >= HEADER_LEN ? createReadStream(inputPath, { start: HEADER_LEN, end: payloadEnd }) : null;

try {
  const out = createWriteStream(outputPath);
  if (source) {
    await pipeline(source, decipher, out);
  } else {
    // Empty payload: only the authentication tag needs checking.
    decipher.end();
    await pipeline(decipher, out);
  }
  console.log(`OK : ${outputPath} (${statSync(outputPath).size} octets, intégrité vérifiée).`);
} catch (err) {
  try {
    unlinkSync(outputPath);
  } catch {
    // The output may not have been created at all.
  }
  fail(`échec du déchiffrement — clé incorrecte ou fichier modifié/tronqué (${err.message}).`);
}
