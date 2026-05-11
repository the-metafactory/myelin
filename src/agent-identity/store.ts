import { readFile, writeFile, chmod, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type {
  AgentIdentity,
  AgentIdentityFile,
  AgentIdentityFileV1,
  AgentIdentityFileV2,
  AgentIdentityWithoutPrivateKey,
} from "./types";
import { DID_RE, BASE64_RE } from "../identity/types";
import { CAPABILITY_TAG_RE } from "../patterns";
import {
  encryptPrivateKey,
  decryptPrivateKey,
  isEncryptedPrivateKey,
} from "./encryption";

/**
 * F-7: persistent file-backed identity store. JSON format with a
 * `version` header so schema changes are explicit.
 *
 * v1 — plaintext private_key.
 * v2 — passphrase-encrypted private_key (AES-256-GCM / PBKDF2-SHA256).
 *
 * Both versions chmod to 0o600 (owner read/write only) so a careless
 * commit or `find` doesn't leak the key (defense in depth even for v2
 * — passphrase strength varies).
 */
const FILE_VERSION_V1 = 1 as const;
const FILE_VERSION_V2 = 2 as const;

function isAgentIdentityCommon(value: unknown): value is AgentIdentityWithoutPrivateKey {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const i = value as Record<string, unknown>;
  if (typeof i.did !== "string" || !DID_RE.test(i.did)) return false;
  if (typeof i.source_uri !== "string" || i.source_uri.length === 0) return false;
  if (typeof i.public_key !== "string" || !BASE64_RE.test(i.public_key)) return false;
  if (!Array.isArray(i.capabilities)) return false;
  for (const cap of i.capabilities) {
    if (typeof cap !== "string" || !CAPABILITY_TAG_RE.test(cap)) return false;
  }
  if (typeof i.created_at !== "string" || i.created_at.length === 0) return false;
  return true;
}

function isAgentIdentity(value: unknown): value is AgentIdentity {
  if (!isAgentIdentityCommon(value)) return false;
  const i = value as Record<string, unknown>;
  if (typeof i.private_key !== "string" || !BASE64_RE.test(i.private_key)) return false;
  return true;
}

export interface SaveAgentIdentityOptions {
  /**
   * When set, the identity is written in v2 format with the private
   * key encrypted by AES-256-GCM under a PBKDF2-SHA256 key derived
   * from this passphrase.
   *
   * Choose a high-entropy passphrase (passwords, randomly-generated
   * tokens, or hardware-stored secrets). The 0o600 chmod is still
   * applied — encryption is one extra layer, not a replacement for
   * filesystem perms.
   */
  passphrase?: string;
}

export interface LoadAgentIdentityOptions {
  /**
   * Required when loading a v2 (encrypted) file. Ignored for v1
   * (plaintext) files. Wrong passphrase yields a single error message
   * — no oracle indicating "wrong passphrase" vs "tampered file" vs
   * "garbled ciphertext".
   */
  passphrase?: string;
}

export async function saveAgentIdentity(
  identity: AgentIdentity,
  path: string,
  options: SaveAgentIdentityOptions = {},
): Promise<void> {
  if (!isAgentIdentity(identity)) {
    throw new Error("saveAgentIdentity: identity failed validation — refusing to write malformed file");
  }

  let file: AgentIdentityFile;
  if (options.passphrase) {
    const { private_key, ...rest } = identity;
    file = {
      version: FILE_VERSION_V2,
      identity: rest,
      private_key_encrypted: await encryptPrivateKey(private_key, options.passphrase),
    };
  } else {
    file = { version: FILE_VERSION_V1, identity };
  }

  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(file, null, 2), { encoding: "utf8", mode: 0o600 });
  // chmod again in case the file already existed without our mode.
  await chmod(target, 0o600);
}

export async function loadAgentIdentity(
  path: string,
  options: LoadAgentIdentityOptions = {},
): Promise<AgentIdentity> {
  const target = resolve(path);
  const text = await readFile(target, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`loadAgentIdentity: invalid JSON at ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`loadAgentIdentity: file at ${path} is not an object`);
  }
  const file = parsed as Record<string, unknown>;

  if (file.version === FILE_VERSION_V1) {
    const v1 = file as unknown as AgentIdentityFileV1;
    if (!isAgentIdentity(v1.identity)) {
      throw new Error(`loadAgentIdentity: identity at ${path} failed validation`);
    }
    return v1.identity;
  }

  if (file.version === FILE_VERSION_V2) {
    if (!options.passphrase) {
      throw new Error(
        `loadAgentIdentity: file at ${path} is encrypted (v2) — passphrase option is required`,
      );
    }
    const v2 = file as unknown as AgentIdentityFileV2;
    if (!isAgentIdentityCommon(v2.identity) || !isEncryptedPrivateKey(v2.private_key_encrypted)) {
      throw new Error(`loadAgentIdentity: encrypted identity at ${path} failed validation`);
    }
    const privateKey = await decryptPrivateKey(v2.private_key_encrypted, options.passphrase);
    const restored: AgentIdentity = { ...v2.identity, private_key: privateKey };
    // Validate the restored identity end-to-end — guards against a
    // tampered identity field (header validation only checks shape;
    // this ensures DID/keys/capabilities survive decryption).
    if (!isAgentIdentity(restored)) {
      throw new Error(`loadAgentIdentity: decrypted identity at ${path} failed validation`);
    }
    return restored;
  }

  throw new Error(
    `loadAgentIdentity: unsupported version ${String(file.version)} at ${path} (expected ${FILE_VERSION_V1} or ${FILE_VERSION_V2})`,
  );
}
