import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Principal } from "./types";

// ── T-3.1: Interfaces ──────────────────────────────────────────────

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

// ── T-3.2: InMemoryRegistry ────────────────────────────────────────

export function createInMemoryRegistry(): PrincipalRegistry {
  const store = new Map<string, Principal>();

  return {
    resolve(did: string): Principal | null {
      return store.get(did) ?? null;
    },

    list(): Principal[] {
      return Array.from(store.values());
    },

    trustedHubs(): Principal[] {
      return Array.from(store.values()).filter((p) => p.is_hub === true);
    },

    add(principal: Principal): void {
      store.set(principal.id, principal);
    },
  };
}

// ── T-3.3: JsonFileRegistry ────────────────────────────────────────

const DEFAULT_REGISTRY_PATH = join(
  homedir(),
  ".config",
  "metafactory",
  "principals.json"
);

function validateRegistryFile(data: unknown): asserts data is PrincipalRegistryFile {
  if (
    typeof data !== "object" ||
    data === null ||
    !("version" in data) ||
    (data as PrincipalRegistryFile).version !== 1 ||
    !("principals" in data) ||
    !Array.isArray((data as PrincipalRegistryFile).principals)
  ) {
    throw new Error(
      "Invalid registry file: expected { version: 1, principals: [...], trusted_hubs: [...] }"
    );
  }
}

export function loadRegistry(path?: string): PrincipalRegistry {
  const filePath = path ?? DEFAULT_REGISTRY_PATH;

  if (!existsSync(filePath)) {
    throw new Error(
      `Registry file not found: ${filePath}\n` +
        `Create it at ${DEFAULT_REGISTRY_PATH} or pass an explicit path.`
    );
  }

  const raw = readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw);
  validateRegistryFile(parsed);

  const store = new Map<string, Principal>();
  for (const p of parsed.principals) {
    store.set(p.id, p);
  }

  return {
    resolve(did: string): Principal | null {
      return store.get(did) ?? null;
    },

    list(): Principal[] {
      return Array.from(store.values());
    },

    trustedHubs(): Principal[] {
      return Array.from(store.values()).filter((p) => p.is_hub === true);
    },

    add(_principal: Principal): void {
      console.warn(
        "JsonFileRegistry is read-only in v1 — add() is a no-op. Use InMemoryRegistry for mutable registries."
      );
    },
  };
}
