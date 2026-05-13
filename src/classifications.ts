/**
 * Canonical classification names — shared by the pure-string subject
 * grammar (`./subjects`) and the envelope schema (`./types`, `./envelope`).
 *
 * Kept in a leaf module with no other imports so both consumers can pull
 * it in without dragging unrelated dependencies. When the spec adds a
 * fourth classification, this is the single place to update.
 */

/**
 * The const array is the single source of truth — the type is derived from it.
 * Adding a fourth classification means adding one string to the array; the
 * type union and the `isSubjectClassification` guard pick up the change
 * automatically.
 */
export const CLASSIFICATION_VALUES = ['local', 'federated', 'public'] as const;

export type SubjectClassification = (typeof CLASSIFICATION_VALUES)[number];

const CLASSIFICATION_SET: ReadonlySet<string> = new Set(CLASSIFICATION_VALUES);

/**
 * Type guard for `SubjectClassification` — useful at boundaries where
 * untyped strings flow in (parsed audit logs, JSON config, wire payloads).
 */
export function isSubjectClassification(value: string): value is SubjectClassification {
  return CLASSIFICATION_SET.has(value);
}
