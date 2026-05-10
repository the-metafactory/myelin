import { readFile, writeFile, chmod, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { AgentIdentity, AgentIdentityFile } from "./types";
import { DID_RE, BASE64_RE } from "../identity/types";
import { CAPABILITY_TAG_RE } from "../patterns";

/**
 * F-7: persistent file-backed identity store. JSON format with a
 * `version: 1` header so future schema changes are explicit.
 *
 * The file holds an Ed25519 private key — `saveAgentIdentity` chmods
 * the file to 0o600 (owner read/write only) so a careless commit or
 * `find` doesn't leak it. Encrypted-at-rest with a passphrase is a
 * follow-up (FR-9, deferred for the thin slice).
 */
const FILE_VERSION = 1 as const;

function isAgentIdentity(value: unknown): value is AgentIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const i = value as Record<string, unknown>;
  if (typeof i.did !== "string" || !DID_RE.test(i.did)) return false;
  if (typeof i.source_uri !== "string" || i.source_uri.length === 0) return false;
  if (typeof i.public_key !== "string" || !BASE64_RE.test(i.public_key)) return false;
  if (typeof i.private_key !== "string" || !BASE64_RE.test(i.private_key)) return false;
  if (!Array.isArray(i.capabilities)) return false;
  for (const cap of i.capabilities) {
    if (typeof cap !== "string" || !CAPABILITY_TAG_RE.test(cap)) return false;
  }
  if (typeof i.created_at !== "string" || i.created_at.length === 0) return false;
  return true;
}

export async function saveAgentIdentity(identity: AgentIdentity, path: string): Promise<void> {
  if (!isAgentIdentity(identity)) {
    throw new Error("saveAgentIdentity: identity failed validation — refusing to write malformed file");
  }
  const file: AgentIdentityFile = { version: FILE_VERSION, identity };
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(file, null, 2), { encoding: "utf8", mode: 0o600 });
  // chmod again in case the file already existed without our mode.
  await chmod(target, 0o600);
}

export async function loadAgentIdentity(path: string): Promise<AgentIdentity> {
  const text = await readFile(resolve(path), "utf8");
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
  if (file.version !== FILE_VERSION) {
    throw new Error(`loadAgentIdentity: unsupported version ${String(file.version)} at ${path} (expected ${FILE_VERSION})`);
  }
  if (!isAgentIdentity(file.identity)) {
    throw new Error(`loadAgentIdentity: identity at ${path} failed validation`);
  }
  return file.identity;
}
