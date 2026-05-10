import type { SovereigntyPolicy } from "./types";
import { validatePolicy } from "./schema";

export interface PolicyStore {
  get(): SovereigntyPolicy;
  isLoaded(): boolean;
  set(policy: SovereigntyPolicy): void;
  close(): Promise<void>;
}

export interface PolicyStoreOptions {
  initial?: SovereigntyPolicy;
  requirePolicy?: boolean;
}

export function createInMemoryPolicyStore(options: PolicyStoreOptions = {}): PolicyStore {
  const requirePolicy = options.requirePolicy ?? true;
  let cached: SovereigntyPolicy | null = null;

  if (options.initial) {
    const result = validatePolicy(options.initial);
    if (!result.valid) {
      const detail = result.errors.map((e: { field: string; message: string }) => `${e.field}: ${e.message}`).join(", ");
      throw new Error(`invalid initial policy: ${detail}`);
    }
    cached = options.initial;
  }

  return {
    get(): SovereigntyPolicy {
      if (cached === null) {
        if (requirePolicy) throw new Error("sovereignty policy not loaded (fail-closed)");
        throw new Error("sovereignty policy not set");
      }
      return cached;
    },
    isLoaded(): boolean {
      return cached !== null;
    },
    set(policy: SovereigntyPolicy): void {
      const result = validatePolicy(policy);
      if (!result.valid) {
        const detail = result.errors.map((e: { field: string; message: string }) => `${e.field}: ${e.message}`).join(", ");
        throw new Error(`invalid policy: ${detail}`);
      }
      cached = policy;
    },
    async close(): Promise<void> {},
  };
}
