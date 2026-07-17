/**
 * Conformance runner types (myelin#239, W2 — the first machinery lander).
 *
 * The runner (D3, runner-first) executes EVERY vector under `specs/vectors/**`
 * against TODAY's hand-written implementations and asserts `expect.{ok,value,
 * reason}`. Where today's impl does not yet satisfy a vector — because the rule
 * is spec-ahead-of-code (the whole point of the RFC-alignment epic) — the vector
 * is recorded in the known-defects manifest (`manifest.ts`) with a tracking
 * issue. Manifest burn-down is the epic's progress meter.
 */

/** A conformance vector as it appears on disk (see `specs/vectors/README.md`). */
export interface Vector {
  id: string;
  rfc?: number;
  kind: string;
  input: unknown;
  expect: { ok: boolean; value?: unknown; reason?: string };
  why?: string;
  /** `pre-R` = regression pin for the deprecated (pre-flag-day) path. */
  era?: string;
}

/** A vector paired with where it was loaded from. */
export interface LoadedVector {
  vector: Vector;
  file: string; // repo-relative path
  dir: string; // vector set (e.g. "sovereignty")
}

/** The normalized result an adapter returns for comparison against `expect`. */
export interface VectorResult {
  ok: boolean;
  value?: unknown;
  reason?: string;
}

/**
 * An adapter turns a vector's `input` into a normalized {@link VectorResult} by
 * calling today's hand-written implementation. It MAY be async (some impls —
 * e.g. the identity verifier, capability registration sign/verify — are async),
 * and it MAY throw (or reject with) {@link NotImplemented} when no implementation
 * exists yet — every such vector MUST then be listed in the manifest, or the
 * runner fails loudly (no silent gaps).
 */
export type Adapter = (input: unknown) => VectorResult | Promise<VectorResult>;

/**
 * Thrown by an adapter for a kind that is registered (so it is NOT an unknown
 * kind) but has no backing implementation on main yet. The `issue` names the
 * tracking issue that will land the impl.
 */
export class NotImplemented extends Error {
  constructor(
    public readonly kind: string,
    public readonly issue: string,
  ) {
    super(`no implementation on main for kind '${kind}' (${issue})`);
    this.name = "NotImplemented";
  }
}
