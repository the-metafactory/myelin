import type { SovereigntyPolicy, TrustedSubstrate } from "./types";

/**
 * DD-122 trusted-substrates lookup (myelin#192).
 *
 * The principal boundary extends to a non-local substrate iff the
 * substrate is declared in the policy's `trusted_substrates` section.
 * These helpers are the runtime self-assert surface: an edge runtime
 * (e.g. the reflex-edge Worker) loads the principal's policy at
 * startup, calls `isSubstrateTrusted` with its own deployment facts,
 * and refuses to serve if it is not declared.
 *
 * Deny-by-default: an absent or empty `trusted_substrates` section
 * trusts nothing; matching is exact string equality on `provider` and
 * `tenancy`, exact membership for `role`. No wildcards — a substrate
 * declaration names one tenancy, deliberately.
 *
 * Declared intent, not enforcement — see `docs/sovereignty.md` §12
 * for the enforcement-layer split (scoped NSC creds, DD-122 point 3).
 *
 * Pure module with a type-only import graph — exportable from
 * `@the-metafactory/myelin/edge` (bundle probe: `src/edge-surface.test.ts`).
 */

/**
 * Return the `trusted_substrates` entry matching (`provider`,
 * `tenancy`) with `role` in its `roles[]`, or `undefined`.
 *
 * Use this over `isSubstrateTrusted` when the caller must also inspect
 * `data_residency_accepted` — required `true` for roles that persist
 * payload plaintext on the substrate (DD-122 point 4(a); e.g.
 * `reflex-edge` writing decision rows to D1).
 *
 * When several entries match (validation does not forbid duplicates),
 * an entry with `data_residency_accepted: true` wins over one without —
 * the union of declarations is the declared intent, so a residency-
 * accepting declaration anywhere in the policy must not be masked by
 * a transit-only duplicate that happens to sort first.
 */
export function findTrustedSubstrate(
  policy: SovereigntyPolicy,
  provider: string,
  tenancy: string,
  role: string,
): TrustedSubstrate | undefined {
  const matches = policy.trusted_substrates?.filter(
    (s) => s.provider === provider && s.tenancy === tenancy && s.roles.includes(role),
  );
  if (!matches || matches.length === 0) return undefined;
  return matches.find((s) => s.data_residency_accepted) ?? matches[0];
}

/**
 * True iff the policy declares (`provider`, `tenancy`) trusted for
 * `role`. Does NOT check `data_residency_accepted` — a payload-
 * persisting runtime must additionally assert that flag via
 * `findTrustedSubstrate` (see the field's doc in `types.ts`).
 */
export function isSubstrateTrusted(
  policy: SovereigntyPolicy,
  provider: string,
  tenancy: string,
  role: string,
): boolean {
  return findTrustedSubstrate(policy, provider, tenancy, role) !== undefined;
}
