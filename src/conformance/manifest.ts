/**
 * Known-defects manifest (myelin#239, D3).
 *
 * Each entry maps a vector id → the tracking issue that will make it pass. A
 * vector is listed here when today's hand-written implementation does not yet
 * satisfy its `expect` — because the rule is spec-ahead-of-code (the RFC that
 * ratifies the behavior has landed; the ./wire codec / engine change that
 * implements it has not). The runner treats a manifested vector's failure as
 * EXPECTED (green); an unmanifested failure is a LOUD red.
 *
 * Burn-down is the epic's progress meter: as #237 (abnf-gen), #238 (./wire),
 * and the engine-debt fixes land, entries are DELETED here — and the runner
 * fails loudly if a listed vector starts passing, forcing the deletion.
 *
 * Seeded from the spec §2 engine-debt tables (docs/design-rfc-alignment.md) and
 * the per-vector triage in this PR. `note` records WHY it fails today.
 */

export interface ManifestEntry {
  /** Tracking issue that lands the impl, e.g. "myelin#238". */
  issue: string;
  /** Why today's impl does not satisfy this vector. */
  note: string;
}

export const MANIFEST: Record<string, ManifestEntry> = {
  // Populated by per-domain triage below (see PR body for the burn-down table).
};
