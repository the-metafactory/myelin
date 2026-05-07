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
  protected store = new Map<string, Principal>();
  protected hubDids = new Set<string>();

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

export function createInMemoryRegistry(): PrincipalRegistry {
  return new BaseRegistry();
}

const DEFAULT_REGISTRY_PATH = join(
  homedir(),
  ".config",
  "metafactory",
  "principals.json",
);

function validatePrincipal(p: unknown, index: number): void {
  if (!p || typeof p !== "object") {
    throw new Error(`principals[${index}]: must be an object`);
  }
  const pr = p as Record<string, unknown>;
  if (typeof pr.id !== "string" || !DID_RE.test(pr.id)) {
    throw new Error(`principals[${index}].id: must be a DID (did:mf:<name>), got "${pr.id}"`);
  }
  if (typeof pr.public_key !== "string" || !BASE64_RE.test(pr.public_key) || pr.public_key.length < 40) {
    throw new Error(`principals[${index}].public_key: must be a valid Base64 key (≥40 chars)`);
  }
  if (typeof pr.operator !== "string" || pr.operator.length === 0) {
    throw new Error(`principals[${index}].operator: required non-empty string`);
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
    );
  }
  validateRegistryFile(parsed, filePath);

  const registry = new BaseRegistry();
  for (const p of parsed.principals) {
    registry.add(p);
  }
  if (Array.isArray(parsed.trusted_hubs)) {
    for (const did of parsed.trusted_hubs) {
      registry["hubDids"].add(did);
    }
  }

  registry.add = (_principal: Principal): void => {
    throw new Error("JsonFileRegistry is read-only — use createInMemoryRegistry() for mutable registries");
  };

  return registry;
}
