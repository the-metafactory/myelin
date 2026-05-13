import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Principal } from "./types";
import { DID_RE, BASE64_RE } from "./types";

export interface PrincipalRegistry {
  resolve(did: string): Principal | null;
  list(): Principal[];
  trustedHubs(): Principal[];
  add(principal: Principal): void;
}

export interface PrincipalRegistryFile {
  version: 1;
  principals: Principal[];
  trusted_hubs: string[];
}

class BaseRegistry implements PrincipalRegistry {
  protected store: Map<string, Principal>;
  protected hubDids: Set<string>;

  constructor(principals: Principal[] = [], trustedHubDids: string[] = []) {
    this.store = new Map(principals.map((p) => [p.id, p]));
    this.hubDids = new Set(trustedHubDids);
  }

  resolve(did: string): Principal | null {
    return this.store.get(did) ?? null;
  }

  list(): Principal[] {
    return Array.from(this.store.values());
  }

  trustedHubs(): Principal[] {
    return Array.from(this.store.values()).filter(
      (p) => p.is_hub === true || this.hubDids.has(p.id),
    );
  }

  add(principal: Principal): void {
    this.store.set(principal.id, principal);
  }
}

class ReadOnlyRegistry extends BaseRegistry {
  constructor(principals: Principal[], trustedHubDids: string[]) {
    super(principals, trustedHubDids);
  }

  override add(_principal: Principal): never {
    throw new Error("JsonFileRegistry is read-only — use createInMemoryRegistry() for mutable registries");
  }
}

export function createInMemoryRegistry(): PrincipalRegistry {
  return new BaseRegistry([], []);
}

const DEFAULT_REGISTRY_PATH = join(
  homedir(),
  ".config",
  "metafactory",
  "principals.json",
);

const VALID_TYPES = new Set<string>(["agent", "service", "operator"]);
const ISO8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function validatePrincipal(p: unknown, index: number): void {
  if (!p || typeof p !== "object") {
    throw new Error(`principals[${index}]: must be an object`);
  }
  const pr = p as Record<string, unknown>;
  if (typeof pr.id !== "string" || !DID_RE.test(pr.id)) {
    throw new Error(`principals[${index}].id: must be a DID (did:mf:<name>), got "${String(pr.id)}"`);
  }
  if (typeof pr.public_key !== "string" || !BASE64_RE.test(pr.public_key) || pr.public_key.length < 40) {
    throw new Error(`principals[${index}].public_key: must be a valid Base64 key (≥40 chars)`);
  }
  if (typeof pr.operator !== "string" || pr.operator.length === 0) {
    throw new Error(`principals[${index}].operator: required non-empty string`);
  }
  if (typeof pr.type !== "string" || !VALID_TYPES.has(pr.type)) {
    throw new Error(`principals[${index}].type: must be "agent", "service", or "operator", got "${String(pr.type)}"`);
  }
  if (typeof pr.created_at !== "string" || !ISO8601_RE.test(pr.created_at)) {
    throw new Error(`principals[${index}].created_at: must be a valid ISO-8601 timestamp`);
  }
}

function validateTrustedHubs(hubs: unknown, filePath: string): asserts hubs is string[] {
  if (!Array.isArray(hubs)) {
    throw new Error(`Invalid registry file at ${filePath}: trusted_hubs must be an array`);
  }
  for (let i = 0; i < hubs.length; i++) {
    if (typeof hubs[i] !== "string" || !DID_RE.test(hubs[i])) {
      throw new Error(`trusted_hubs[${i}]: must be a valid DID, got "${hubs[i]}"`);
    }
  }
}

function validateRegistryFile(data: unknown, filePath: string): asserts data is PrincipalRegistryFile {
  if (
    typeof data !== "object" ||
    data === null ||
    !("version" in data) ||
    (data as PrincipalRegistryFile).version !== 1 ||
    !("principals" in data) ||
    !Array.isArray((data as PrincipalRegistryFile).principals)
  ) {
    throw new Error(
      `Invalid registry file at ${filePath}: expected { version: 1, principals: [...], trusted_hubs: [...] }`,
    );
  }
  const file = data as PrincipalRegistryFile;
  for (let i = 0; i < file.principals.length; i++) {
    validatePrincipal(file.principals[i], i);
  }
  validateTrustedHubs(file.trusted_hubs, filePath);
}

export function loadRegistry(path?: string): PrincipalRegistry {
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
  validateRegistryFile(parsed, filePath);

  return new ReadOnlyRegistry(parsed.principals, parsed.trusted_hubs);
}
