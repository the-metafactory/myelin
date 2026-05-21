import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Identity } from "./types";
import { DID_RE, BASE64_RE } from "./types";

export interface IdentityRegistry {
  resolve(did: string): Identity | null;
  list(): Identity[];
  trustedHubs(): Identity[];
  add(identity: Identity): void;
}

/**
 * Persisted registry-file shape.
 *
 * R1/R2 (vocabulary migration 2026-05) — the JSON key `principals` was
 * renamed to `identities` and the file `version` bumped `1` → `2`.
 * `loadRegistry` is a transition reader: it accepts BOTH `version: 1`
 * files (old `principals` key) and `version: 2` files (new `identities`
 * key) for one minor cycle. Writers emit only the new shape.
 */
export interface IdentityRegistryFile {
  version: 2;
  identities: Identity[];
  trusted_hubs: string[];
}

class BaseRegistry implements IdentityRegistry {
  protected store: Map<string, Identity>;
  protected hubDids: Set<string>;

  constructor(identities: Identity[] = [], trustedHubDids: string[] = []) {
    this.store = new Map(identities.map((p) => [p.id, p]));
    this.hubDids = new Set(trustedHubDids);
  }

  resolve(did: string): Identity | null {
    return this.store.get(did) ?? null;
  }

  list(): Identity[] {
    return Array.from(this.store.values());
  }

  trustedHubs(): Identity[] {
    return Array.from(this.store.values()).filter(
      (p) => p.is_hub === true || this.hubDids.has(p.id),
    );
  }

  add(identity: Identity): void {
    this.store.set(identity.id, identity);
  }
}

class ReadOnlyRegistry extends BaseRegistry {
  override add(_identity: Identity): never {
    throw new Error("JsonFileRegistry is read-only — use createInMemoryRegistry() for mutable registries");
  }
}

export function createInMemoryRegistry(): IdentityRegistry {
  return new BaseRegistry([], []);
}

/**
 * @deprecated Renamed to `IdentityRegistry` (vocabulary migration 2026-05).
 * Removed in the next major. Kept so external importers (discovery,
 * bidding, cortex) compile unchanged through the transition.
 */
export type PrincipalRegistry = IdentityRegistry;
/**
 * @deprecated Renamed to `IdentityRegistryFile` (vocabulary migration
 * 2026-05). Removed in the next major.
 */
export type PrincipalRegistryFile = IdentityRegistryFile;

const DEFAULT_REGISTRY_PATH = join(
  homedir(),
  ".config",
  "metafactory",
  "principals.json",
);

const VALID_TYPES = new Set<string>(["agent", "service", "hub"]);
const ISO8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function validateIdentity(p: unknown, index: number): void {
  if (!p || typeof p !== "object") {
    throw new Error(`identities[${index}]: must be an object`);
  }
  const pr = p as Record<string, unknown>;
  if (typeof pr.id !== "string" || !DID_RE.test(pr.id)) {
    throw new Error(`identities[${index}].id: must be a DID (did:mf:<name>), got "${String(pr.id)}"`);
  }
  if (typeof pr.public_key !== "string" || !BASE64_RE.test(pr.public_key) || pr.public_key.length < 40) {
    throw new Error(`identities[${index}].public_key: must be a valid Base64 key (≥40 chars)`);
  }
  if (typeof pr.operator !== "string" || pr.operator.length === 0) {
    throw new Error(`identities[${index}].operator: required non-empty string`);
  }
  if (typeof pr.type !== "string" || !VALID_TYPES.has(pr.type)) {
    throw new Error(`identities[${index}].type: must be "agent", "service", or "hub", got "${String(pr.type)}"`);
  }
  if (typeof pr.created_at !== "string" || !ISO8601_RE.test(pr.created_at)) {
    throw new Error(`identities[${index}].created_at: must be a valid ISO-8601 timestamp`);
  }
}

function validateTrustedHubs(hubs: unknown, filePath: string): asserts hubs is string[] {
  if (!Array.isArray(hubs)) {
    throw new Error(`Invalid registry file at ${filePath}: trusted_hubs must be an array`);
  }
  for (let i = 0; i < hubs.length; i++) {
    const h: unknown = hubs[i];
    if (typeof h !== "string" || !DID_RE.test(h)) {
      throw new Error(`trusted_hubs[${i}]: must be a valid DID, got "${String(h)}"`);
    }
  }
}

/**
 * Result of normalising a registry file's identity list across the
 * `principals` (v1) / `identities` (v2) key transition.
 */
interface NormalizedRegistryFile {
  identities: unknown[];
  trusted_hubs: unknown;
}

/**
 * Transition reader (R1/R2 — vocabulary migration 2026-05).
 *
 * Accepts `version: 1` files (old `principals` key) and `version: 2`
 * files (new `identities` key). Resolves the identity list to a single
 * normalised shape.
 *
 * Security boundary — conflict rejection: the registry is the trusted
 * identity list. If a file carries BOTH `principals` AND `identities`,
 * silently preferring one key is a trust-list confusion path (an
 * attacker who can drop a registry file gets to choose which key wins).
 * The reader raises a typed `dual_field_conflict` error when both keys
 * are present, whether their contents match or differ — matching
 * contents indicate an over-eager producer (a bug worth surfacing),
 * differing contents are an attack. The check runs before any
 * membership decision is made.
 */
function normalizeRegistryFile(data: unknown, filePath: string): NormalizedRegistryFile {
  if (typeof data !== "object" || data === null || !("version" in data)) {
    throw new Error(
      `Invalid registry file at ${filePath}: expected { version: 1|2, principals|identities: [...], trusted_hubs: [...] }`,
    );
  }
  const obj = data as Record<string, unknown>;
  const version: unknown = obj.version;
  if (version !== 1 && version !== 2) {
    throw new Error(
      `Invalid registry file at ${filePath}: unsupported version ${String(version)} — expected 1 or 2`,
    );
  }

  const hasOldKey = "principals" in obj;
  const hasNewKey = "identities" in obj;

  // Conflict rejection — both keys present is always an error (attack or
  // over-eager producer). Runs before any membership decision.
  if (hasOldKey && hasNewKey) {
    const err = new Error(
      `Invalid registry file at ${filePath}: dual_field_conflict — file contains both ` +
        `legacy "principals" and current "identities" keys; refusing to choose`,
    );
    (err as Error & { code: string }).code = "dual_field_conflict";
    throw err;
  }
  if (!hasOldKey && !hasNewKey) {
    throw new Error(
      `Invalid registry file at ${filePath}: expected { version: 1|2, principals|identities: [...], trusted_hubs: [...] }`,
    );
  }

  const list = hasNewKey ? obj.identities : obj.principals;
  if (!Array.isArray(list)) {
    throw new Error(
      `Invalid registry file at ${filePath}: ${hasNewKey ? "identities" : "principals"} must be an array`,
    );
  }
  return { identities: list, trusted_hubs: obj.trusted_hubs };
}

export function loadRegistry(path?: string): IdentityRegistry {
  const filePath = path ?? DEFAULT_REGISTRY_PATH;

  if (!existsSync(filePath)) {
    throw new Error(
      `Registry file not found: ${filePath}\n` +
        `Create it at ${DEFAULT_REGISTRY_PATH} or pass an explicit path.`,
    );
  }

  let parsed: unknown;
  try {
    const raw = readFileSync(filePath, "utf-8");
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Invalid JSON in registry file ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }

  const normalized = normalizeRegistryFile(parsed, filePath);
  for (let i = 0; i < normalized.identities.length; i++) {
    validateIdentity(normalized.identities[i], i);
  }
  validateTrustedHubs(normalized.trusted_hubs, filePath);

  return new ReadOnlyRegistry(normalized.identities as Identity[], normalized.trusted_hubs);
}
