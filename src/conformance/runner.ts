import { adapters } from "./registry";
import { MANIFEST } from "./manifest";
import { NotImplemented, type LoadedVector, type VectorResult } from "./types";

/**
 * Outcome of running one vector against today's implementation.
 *
 * - `pass`       — impl matches `expect` fully; not in the manifest. Green.
 * - `known`      — impl does NOT match `expect` (or the kind is unimplemented),
 *                  and the vector IS in the manifest. Expected failure; green.
 *                  Its burn-down is the epic's progress meter.
 * - `era-pin`    — an `era:"pre-R"` vector: a regression pin for the DEPRECATED
 *                  (pre-flag-day) path, routed OUT of live conformance
 *                  (amendment item 3; §Runner-semantics: "never live-conformance
 *                  against post-R ./wire"). Green, and NOT manifested-as-defect.
 *                  The adapter is still run for visibility (no silent skip — the
 *                  outcome names its rule), but the result never loud-fails: a
 *                  pre-R vector must not couple the live gate to deprecated
 *                  behavior, nor rot the manifest when the cut fires.
 * - `loud-fail`  — impl does NOT match and the vector is NOT manifested (an
 *                  unaccounted defect / regression), OR the kind is unknown, OR
 *                  the manifest entry is stale (vector now passes). RED.
 */
export type Outcome = "pass" | "known" | "era-pin" | "loud-fail";

export interface RunResult {
  id: string;
  dir: string;
  kind: string;
  outcome: Outcome;
  detail?: string;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return Bun.deepEquals(a, b, true);
}

/** Compare a normalized result against a vector's `expect`. */
function matches(
  result: VectorResult,
  expect: { ok: boolean; value?: unknown; reason?: string },
): { ok: boolean; detail?: string } {
  if (result.ok !== expect.ok) {
    return { ok: false, detail: `ok: got ${result.ok}, want ${expect.ok}` };
  }
  if (expect.reason !== undefined && result.reason !== expect.reason) {
    return { ok: false, detail: `reason: got ${String(result.reason)}, want ${expect.reason}` };
  }
  if (expect.value !== undefined && !deepEqual(result.value, expect.value)) {
    return {
      ok: false,
      detail: `value: got ${JSON.stringify(result.value)}, want ${JSON.stringify(expect.value)}`,
    };
  }
  return { ok: true };
}

/**
 * Run one vector: dispatch on its TOP-LEVEL `kind` only (amendment item 2 —
 * refusal-object vectors nest a `kind` inside `expect.value`, which is data),
 * compare to `expect`, and classify. era:pre-R vectors are regression pins for
 * the deprecated path; main is still pre-R, so they assert normally here and are
 * never silently skipped (amendment item 3).
 */
export async function runVector(loaded: LoadedVector): Promise<RunResult> {
  const { vector, dir } = loaded;
  const { id, kind, expect } = vector;
  const base = { id, dir, kind };
  const manifested = MANIFEST[id];

  const adapter = adapters[kind];

  // era-aware routing (amendment item 3). `era:"pre-R"` vectors pin the
  // deprecated pre-flag-day path and are routed OUT of live conformance — never
  // manifested-as-defect. Run the adapter for a descriptive detail (no silent
  // skip; the outcome names the rule), but never loud-fail on the result.
  if (vector.era === "pre-R") {
    if (!adapter) {
      return { ...base, outcome: "loud-fail", detail: `unknown kind '${kind}' — no registered adapter (era:pre-R)` };
    }
    let detail = "pre-R regression pin (routed out of live conformance)";
    try {
      const r = await adapter(vector.input);
      detail = matches(r, expect).ok ? `${detail} — pin holds today` : `${detail} — diverges today (not a live defect)`;
    } catch (err) {
      detail = err instanceof NotImplemented ? `${detail} — unimplemented on main` : `${detail} — threw:${(err as Error).message}`;
    }
    return { ...base, outcome: "era-pin", detail };
  }

  if (!adapter) {
    // Unknown kind — a vector whose op the runner does not account for. LOUD,
    // always (this is the no-silent-caps guard; the fabricated-unknown-kind
    // acceptance test relies on it).
    return { ...base, outcome: "loud-fail", detail: `unknown kind '${kind}' — no registered adapter` };
  }

  let result: VectorResult;
  try {
    result = await adapter(vector.input);
  } catch (err) {
    if (err instanceof NotImplemented) {
      // Registered-but-unimplemented kind. MUST be manifested.
      if (manifested) return { ...base, outcome: "known", detail: `unimplemented → ${manifested.issue}` };
      return {
        ...base,
        outcome: "loud-fail",
        detail: `kind '${kind}' is unimplemented and NOT in the manifest — add a manifest entry (${err.issue})`,
      };
    }
    // A real throw from today's impl. That is a fact about today's impl —
    // treat it as a mismatch and let the manifest decide known vs loud.
    result = { ok: false, reason: `threw:${(err as Error).message}` };
  }

  const cmp = matches(result, expect);

  if (cmp.ok) {
    if (manifested) {
      // The impl now satisfies a vector the manifest still lists — the manifest
      // is stale. Burn-down must remove it. LOUD so it cannot rot.
      return {
        ...base,
        outcome: "loud-fail",
        detail: `manifest entry is STALE — vector now PASSES; remove it from manifest.ts (was: ${manifested.issue})`,
      };
    }
    return { ...base, outcome: "pass" };
  }

  // Mismatch.
  if (manifested) return { ...base, outcome: "known", detail: `${cmp.detail} → ${manifested.issue}` };
  return { ...base, outcome: "loud-fail", detail: cmp.detail };
}
