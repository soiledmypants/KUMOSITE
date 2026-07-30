import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
  scryptSync,
} from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { CONFIG, dataPath } from "./config.js";

/**
 * Encrypted-at-rest private-key vault (data/keys.json).
 *
 * - AES-256-GCM, key derived with scrypt(KEY_SECRET, per-vault random salt).
 * - Plaintext keys exist only transiently inside importKey/decryptKey callers;
 *   they are NEVER logged, journaled, or sent back to a client.
 * - The API/panel only ever see {id, name, address, createdAt}.
 */

interface VaultKey {
  id: string;
  name: string;
  address: `0x${string}`;
  iv: string; // hex
  tag: string; // hex
  ciphertext: string; // hex
  createdAt: string;
}

interface VaultFile {
  salt: string; // hex
  keys: VaultKey[];
}

function vaultPath(): string {
  return dataPath("keys.json");
}

function loadVault(): VaultFile {
  const path = vaultPath();
  if (!existsSync(path)) return { salt: randomBytes(16).toString("hex"), keys: [] };
  return JSON.parse(readFileSync(path, "utf8")) as VaultFile;
}

function saveVault(vault: VaultFile): void {
  writeFileSync(vaultPath(), JSON.stringify(vault, null, 2));
}

function deriveAesKey(saltHex: string): Buffer {
  if (!CONFIG.keySecret) {
    throw new Error("KEY_SECRET env var is required to use the key vault");
  }
  return scryptSync(CONFIG.keySecret, Buffer.from(saltHex, "hex"), 32);
}

function normalizeKey(privateKey: string): `0x${string}` {
  const trimmed = privateKey.trim();
  return (trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`) as `0x${string}`;
}

/** Import a key: validate, derive address, encrypt, persist. Returns id+address ONLY. */
export function importKey(name: string, privateKey: string): { id: string; address: `0x${string}` } {
  const pk = normalizeKey(privateKey);
  const account = privateKeyToAccount(pk); // throws on invalid key

  const vault = loadVault();
  const aesKey = deriveAesKey(vault.salt);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", aesKey, iv);
  const ciphertext = Buffer.concat([cipher.update(pk, "utf8"), cipher.final()]);

  const entry: VaultKey = {
    id: randomUUID(),
    name: name.trim() || account.address,
    address: account.address,
    iv: iv.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"),
    ciphertext: ciphertext.toString("hex"),
    createdAt: new Date().toISOString(),
  };
  vault.keys.push(entry);
  saveVault(vault);
  return { id: entry.id, address: entry.address };
}

/** Public listing — never includes key material. */
export function listKeys(): Array<{ id: string; name: string; address: `0x${string}`; createdAt: string }> {
  return loadVault().keys.map((k) => ({
    id: k.id,
    name: k.name,
    address: k.address,
    createdAt: k.createdAt,
  }));
}

/**
 * Decrypt a vault key for in-memory signing use ONLY.
 * Callers must never log or persist the returned value.
 */
export function decryptKey(id: string): `0x${string}` {
  const vault = loadVault();
  const entry = vault.keys.find((k) => k.id === id);
  // NEVER echo the full ref: people paste private keys in the wrong box, and a
  // 64-hex "id" bounced back in an error message would put the key on screen.
  if (!entry) throw new Error(`vault key "${id.slice(0, 8)}…" not found (did you paste the key itself? import it on the Keys page instead)`);

  const aesKey = deriveAesKey(vault.salt);
  const decipher = createDecipheriv("aes-256-gcm", aesKey, Buffer.from(entry.iv, "hex"));
  decipher.setAuthTag(Buffer.from(entry.tag, "hex"));
  const pk = Buffer.concat([
    decipher.update(Buffer.from(entry.ciphertext, "hex")),
    decipher.final(),
  ]).toString("utf8");
  return pk as `0x${string}`;
}
