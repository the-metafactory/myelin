import type { ValidationError } from './types';

/**
 * Dual-schema transition helpers (vocabulary migration 2026-05).
 *
 * Every wire field renamed by the vocabulary migration is read in a
 * back-compat window where BOTH the deprecated and the canonical key may
 * appear on the same record. Per the migration manifest's JetStream-replay
 * note, a record carrying both names is rejected outright — silently
 * preferring one field at a signed-envelope trust boundary lets different
 * consumers / canonicalization paths interpret different values.
 *
 * These helpers were introduced in `envelope.ts` (PR-6) for the
 * envelope-level renames (`signed_by[].principal`, `originator.principal`,
 * `target_principal`). The `signed_by[].principal` and `target_principal`
 * renames have since become clean breaking cuts (myelin#182, R13) and no
 * longer use these helpers; the originator rename still rides them through
 * its transition window. PR-7 extends the same pattern to the dispatch
 * lifecycle payload (`payload.principal` → `payload.identity`), which also
 * rides inside the signed `payload` field. The logic is extracted here so
 * both `envelope.ts` and the dispatch cluster share ONE implementation
 * rather than reinventing it — the conflict-rejection rule is a security
 * boundary and must behave identically everywhere.
 */

/**
 * `detectDualField` pushes a typed `dual_field_conflict` error when both
 * `oldKey` and `newKey` are present on `obj` (whether their values match
 * or differ — matching is an over-eager-producer bug, differing is an
 * attack). Returns `true` when a conflict was found so the caller can
 * skip the now-ambiguous downstream checks for that field.
 *
 * The conflict check MUST be invoked BEFORE any canonicalization or
 * signature-bytes derivation, so an attacker cannot use one form for
 * signature canonicalization and the other for downstream parsing.
 */
export function detectDualField(
  obj: Record<string, unknown>,
  oldKey: string,
  newKey: string,
  fieldPath: string,
  errors: ValidationError[],
): boolean {
  if (oldKey in obj && newKey in obj) {
    errors.push({
      field: fieldPath,
      code: 'dual_field_conflict',
      message:
        `dual_field_conflict — carries both the deprecated "${oldKey}" and the ` +
        `canonical "${newKey}"; a transition-window record must carry exactly one. ` +
        `Refusing to choose at a signed-envelope trust boundary.`,
    });
    return true;
  }
  return false;
}

/**
 * Dual-schema transition reader — resolve a renamed field's value. Returns
 * the canonical (`newKey`) value when present, else the deprecated
 * (`oldKey`) value. Callers MUST run {@link detectDualField} first — when
 * both keys are present the record is already rejected and this resolver
 * is not consulted.
 */
export function readRenamedField(
  obj: Record<string, unknown>,
  oldKey: string,
  newKey: string,
): unknown {
  return newKey in obj ? obj[newKey] : obj[oldKey];
}
