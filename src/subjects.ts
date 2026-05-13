/**
 * Subject namespace utilities for the myelin NATS grammar.
 *
 * Pure string-level operations. **No dependency on `MyelinEnvelope`** —
 * audit pipelines, analytics, and any ecosystem consumer (Sage, Cortex,
 * Grove, Pulse, …) can import from `@the-metafactory/myelin/subjects`
 * without pulling in the envelope schema or its transitive deps.
 *
 * Three primitives live here:
 *
 *   - `deriveSubject(classification, org, type, stack?)` — build a subject
 *     from string primitives (NO envelope object).
 *   - `subjectPrefixAligns(subject, classification)` — verify a subject's
 *     prefix matches a claimed classification (NO envelope object).
 *   - `detectSubjectForm(subject, envelopeType?, stack?)` — classify a
 *     subject's wire form: legacy / stack-aware / public / unknown.
 *
 * The envelope-bound wrappers `deriveNatsSubject` and
 * `validateSubjectEnvelopeAlignment` live in `./envelope` (myelin#115).
 * They are thin shims that destructure the envelope, then delegate here.
 *
 * Consumers that *do* have a `MyelinEnvelope` should still use the
 * envelope-bound API for ergonomics. Consumers that only have wire-level
 * data (audit logs, OpenTelemetry traces, JetStream consumer filters) use
 * the primitives directly.
 */

/**
 * Permitted shape for a `{stack}` segment in `local./federated.` subjects.
 * Same character set as every other segment (lowercase alphanumeric +
 * hyphens, start with letter, 1–63 chars).
 */
export const STACK_SEGMENT_REGEX = /^[a-z][a-z0-9-]{0,62}$/;

// Classification names live in `./classifications` — a tiny leaf module
// shared with `./types` so the envelope schema's runtime set and the
// pure-string grammar agree by construction (Sage R1).
export type { SubjectClassification } from './classifications';
export { isSubjectClassification } from './classifications';
import type { SubjectClassification } from './classifications';

/**
 * Derive a NATS subject from string primitives (myelin#115).
 *
 * Pure-string contract — does NOT take a `MyelinEnvelope`. The
 * envelope-bound `deriveNatsSubject(envelope, stack?)` is a one-line
 * shim around this function.
 *
 * Rules:
 *
 * - `public.` subjects are never org-scoped or stack-scoped: `public.{type}`.
 * - `local.`/`federated.` subjects with `stack` omitted emit the legacy
 *   5-segment shape `{prefix}.{org}.{type}` (subscribers default-derive
 *   the missing stack to `default` per the spec migration window).
 * - `local.`/`federated.` subjects with `stack` supplied emit the
 *   6-segment shape `{prefix}.{org}.{stack}.{type}`. The stack is
 *   validated against {@link STACK_SEGMENT_REGEX} and rejected on miss.
 */
export function deriveSubject(
  classification: SubjectClassification,
  org: string,
  type: string,
  stack?: string,
): string {
  if (classification === 'public') {
    return `public.${type}`;
  }

  if (stack === undefined) {
    return `${classification}.${org}.${type}`;
  }

  if (!STACK_SEGMENT_REGEX.test(stack)) {
    throw new Error(
      `Invalid stack segment "${stack}": must match ${STACK_SEGMENT_REGEX.source}`,
    );
  }

  return `${classification}.${org}.${stack}.${type}`;
}

/**
 * Verify a subject's prefix aligns with a claimed classification (myelin#115).
 *
 * Pure-string contract — does NOT take a `MyelinEnvelope`. Returns prefix-
 * alignment metadata suitable for folding into a higher-level alignment
 * result (e.g., alongside form detection). `actual` is a plain `string`
 * because failure cases carry non-classification values like `'bogus'`
 * or `''` (Sage R1).
 *
 * Hot-path optimization (Sage R1/R2): tries `startsWith` first so the
 * common aligned path returns `classification` directly with no string
 * allocation. Only the misaligned (rare) path slices the subject to
 * extract its actual prefix for diagnostic reporting. Avoids the
 * `split('.')` throwaway-array allocation that `subject.split('.')[0]`
 * implies. The README positions this primitive for audit pipelines and
 * log shippers that may process millions of subjects per second.
 */
export function subjectPrefixAligns(
  subject: string,
  classification: SubjectClassification,
): { aligned: boolean; expected: SubjectClassification; actual: string } {
  // Aligned hot path: subject starts with `<classification>.` (or the subject
  // IS exactly the classification, no dot follows). Return the classification
  // directly — no slice, no array.
  const cl = classification.length;
  if (
    subject.startsWith(classification) &&
    (subject.length === cl || subject.charCodeAt(cl) === 46 /* '.' */)
  ) {
    return { aligned: true, expected: classification, actual: classification };
  }

  // Misaligned: extract the actual prefix for diagnostics. One slice.
  const dot = subject.indexOf('.');
  const actual = dot === -1 ? subject : subject.slice(0, dot);
  return { aligned: false, expected: classification, actual };
}

/**
 * Wire-form variants for myelin NATS subjects.
 *
 * - `stack-aware` — `local./federated.` subject with explicit `{stack}` segment (6+-segment form)
 * - `legacy` — `local./federated.` 5-segment shape; subscribers default-derive missing stack to `default`
 * - `public` — `public.` subjects, which never carry a stack
 * - `unknown` — prefix is not one of `local`/`federated`/`public`; callers should treat as malformed
 */
export type SubjectForm = 'stack-aware' | 'legacy' | 'public' | 'unknown';

export interface SubjectFormDetection {
  form: SubjectForm;
  /** Stack segment when `form === 'stack-aware'`; `undefined` otherwise. */
  stack?: string;
}

/**
 * Classify a NATS subject's wire form (myelin#113).
 *
 * Pure subject-level analysis — no envelope required. Useful for audit
 * pipelines, analytics, and subscribers that want to tag traffic by form
 * without having the originating envelope in hand.
 *
 * Form detection for `local./federated.` subjects rests on a small heuristic:
 *
 *   - legacy      `{prefix}.{org}.{type...}`              (segment[2] is first type segment)
 *   - stack-aware `{prefix}.{org}.{stack}.{type...}`      (segment[2] is the stack)
 *
 * Two disambiguation strategies, in priority order:
 *
 * 1. **Caller-supplied `stack`** — when the caller knows the operator's stack
 *    identity (e.g., a transport layer that emitted the subject itself), pass
 *    it in. If `segment[2]` equals the supplied `stack`, the form is
 *    `stack-aware` even when it also happens to match the type prefix.
 *    This resolves the spec's seed-taxonomy collision (operators naming
 *    stacks `research`/`security`/`devops` who also publish in those domains).
 * 2. **Envelope `type`** — when the caller has the envelope but not the
 *    stack identity, the function falls back to comparing `segment[2]`
 *    against the first segment of `envelopeType`. If they differ AND
 *    `segment[2]` is stack-shaped, the form is `stack-aware`; otherwise
 *    `legacy`.
 *
 * When neither hint is available (`envelopeType` and `stack` both omitted),
 * the function defaults to **`legacy`**. Rationale: `segment[2]` in a legacy
 * 5-segment subject is always a domain segment, which is always stack-shaped
 * (domains follow the same naming rules as stacks). Defaulting to `stack-aware`
 * in that case would systematically mis-classify every legacy subject as
 * stack-aware. The migration window the spec mandates assumes a stackless
 * subject is legacy until proven otherwise — that's the spec-aligned default.
 * Callers that need precision on the stack-aware path MUST supply
 * `envelopeType` or `stack` (the audit/analytics pipeline use case).
 */
export function detectSubjectForm(
  subject: string,
  envelopeType?: string,
  stack?: string,
): SubjectFormDetection {
  const segments = subject.split('.');
  const prefix = segments[0];

  if (prefix === 'public') {
    return { form: 'public' };
  }

  if (prefix !== 'local' && prefix !== 'federated') {
    return { form: 'unknown' };
  }

  const slot2 = segments[2];
  // Index access returns value type at compile time, undefined at runtime
  // when the subject has fewer segments — keep the guard.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (slot2 === undefined || !STACK_SEGMENT_REGEX.test(slot2)) {
    return { form: 'legacy' };
  }

  // Priority 1: caller-supplied stack identity wins.
  if (stack !== undefined && slot2 === stack) {
    return { form: 'stack-aware', stack: slot2 };
  }

  // Priority 2: envelope-type heuristic when stack identity unknown.
  if (envelopeType !== undefined) {
    const typeSegs = envelopeType.split('.');
    const envTypeFirst = typeSegs[0];

    // Structural tiebreaker (Sage R3): when slot2 equals the first type segment,
    // count segments. Legacy form has exactly `2 + typeSegs.length` segments
    // (prefix + org + type). Stack-aware adds one more (the stack). If the
    // subject has strictly more segments than the legacy shape would, the
    // extra segment must be the stack — even when the stack name collides
    // with the first type segment.
    if (slot2 === envTypeFirst) {
      if (segments.length > 2 + typeSegs.length) {
        return { form: 'stack-aware', stack: slot2 };
      }
      return { form: 'legacy' };
    }
    return { form: 'stack-aware', stack: slot2 };
  }

  // Neither hint: default to `legacy` per the spec migration baseline.
  // See JSDoc above for rationale.
  return { form: 'legacy' };
}
