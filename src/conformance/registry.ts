import type { Adapter } from "./types";
import { identityAdapters } from "./adapters/identity";
import { subjectsAdapters } from "./adapters/subjects";
import { envelopeAdapters } from "./adapters/envelope";
import { sovereigntyAdapters } from "./adapters/sovereignty";
import { capabilityAdapters } from "./adapters/capability";
import { transportAdapters } from "./adapters/transport";
import { admissionAdapters } from "./adapters/admission";

/**
 * The kind → adapter registry. EVERY vector `kind` under `specs/vectors/**` must
 * have an entry here (real impl or a NotImplemented stub); a vector whose kind is
 * absent is an UNKNOWN kind and fails loudly (runner.ts). Domain modules are
 * merged in a fixed order; a duplicate kind across modules is a build-time bug we
 * assert against below.
 */
const modules: Record<string, Adapter>[] = [
  identityAdapters,
  subjectsAdapters,
  envelopeAdapters,
  sovereigntyAdapters,
  capabilityAdapters,
  transportAdapters,
  admissionAdapters,
];

function mergeAdapters(mods: Record<string, Adapter>[]): Record<string, Adapter> {
  const merged: Record<string, Adapter> = {};
  for (const mod of mods) {
    for (const [kind, adapter] of Object.entries(mod)) {
      if (merged[kind]) throw new Error(`duplicate conformance adapter for kind '${kind}'`);
      merged[kind] = adapter;
    }
  }
  return merged;
}

export const adapters: Record<string, Adapter> = mergeAdapters(modules);
