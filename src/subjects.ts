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
 *   - `deriveSubject(classification, principal, type, stack?)` — build a
 *     subject from string primitives (NO envelope object).
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
 *
 * The authoritative declaration lives in `./segment-validators` so the
 * regex AND the validators that close over it share one source of truth
 * across `subjects.ts` + `dispatch/lifecycle.ts` (myelin#154 review,
 * Sage Architecture lens). Re-exported here for the public package API
 * via `./index` (historical export site — kept stable for consumers).
 */
export { STACK_SEGMENT_REGEX } from './segment-validators';
import {
  STACK_SEGMENT_REGEX,
  assertSegment,
  assertSegmentPath,
  stackInfix,
} from './segment-validators';

// Classification names live in `./classifications` — a tiny leaf module
// shared with `./types` so the envelope schema's runtime set and the
// pure-string grammar agree by construction (Sage R1).
export type { SubjectClassification } from './classifications';
export { isSubjectClassification } from './classifications';
import type { SubjectClassification } from './classifications';

// DID grammar lives in `./identity/types` — a tiny leaf module with no
// runtime deps (regex + types only). Importing it here preserves the
// no-envelope-dep boundary that the `/subjects` subpath promises.
import { DID_RE } from './identity/types';

/**
 * Encode a DID into a NATS-safe direct-routing subject segment (myelin#135).
 *
 * Reversible, injective mapping used in direct-routing subjects of the form
 * `local.{principal}.{stack}.tasks.@{assistant}.{capability}`. Source of
 * truth for the encoding rules is `specs/namespace.md` §"Assistant encoding".
 *
 * | Source character | Encoded as |
 * |---|---|
 * | `:` (DID separator) | `-` (single hyphen) |
 * | `.` (inside method-specific-id) | `--` (double hyphen) |
 * | `-` (inside method-specific-id) | `-` (preserved) |
 * | `[a-z0-9]` | passthrough |
 *
 * The output is prefixed with `@` so subscribers and audit pipelines can
 * recognize an assistant segment without payload inspection.
 *
 * Injectivity rests on the DID grammar refusing `--` inside the method-
 * specific-id (enforced by {@link DID_RE} via the negative-lookahead
 * `-(?!-)`). With that precondition, `--` in the encoded form unambiguously
 * decodes back to `.` — it cannot have come from a source `--`.
 *
 * @throws Error when `did` does not match {@link DID_RE}.
 */
export function encodeDidSegment(did: string): string {
  if (!DID_RE.test(did)) {
    throw new Error(`invalid DID: ${did}`);
  }
  return '@' + did.replace(/:/g, '-').replace(/\./g, '--');
}

// `assertSegment` + `assertSegmentPath` live in `./segment-validators`
// (myelin#154 review — keeps the validator contract single-sourced and
// internal-by-default). Imported above.

/* ─────────────────────────────────────────────────────────────────────
 * Agent-task subject vocabulary (myelin#134)
 *
 * Cedar, Sage, and any future task-dispatching agent (Pilot, Grove, …)
 * previously carried private copies of these helpers in
 * `src/bus/subjects.ts`. Pulling them upstream removes the drift risk
 * already documented in cedar's and sage's file headers, and gives the
 * ecosystem a single grammar source.
 *
 * Shape is the legacy 5-segment form (`local.{principal}.tasks.{…}`) —
 * same choice as the existing `deriveLifecycleSubject` and the cedar/sage
 * helpers being replaced. The stack-aware 6-segment shape stays opt-in
 * via the lower-level `deriveSubject(…, stack)` for callers that have
 * already wired their stack identity through configuration.
 *
 * Pure-string contract: no envelope, no transport — same boundary as
 * the rest of this file. `directTaskSubject` is the one non-trivial
 * helper; it composes `encodeDidSegment` (which validates against
 * `DID_RE`) so invalid DIDs throw at the call site, never on the wire.
 *
 * The dispatch-lifecycle subjects (`local.{principal}.dispatch.task.{phase}`)
 * are already exported as {@link deriveLifecycleSubject} /
 * {@link deriveLifecycleWildcard} in `./dispatch/lifecycle`; the helpers
 * below cover the remaining inbound (tasks) and outbound (verdict)
 * surfaces from issue #134.
 * ───────────────────────────────────────────────────────────────────── */

/**
 * Subscribe-side wildcard for tasks offered to a capability fan-out.
 *
 * Used by any agent advertising a capability. The receiver subscribes
 * `local.{principal}.tasks.{capability}.>` and the broker fans messages
 * out to all listeners on a queue group.
 *
 * **NATS wildcard semantics.** The `>` token matches **one or more**
 * trailing segments, never zero. A publisher reaching subscribers on
 * this wildcard must publish on `local.{principal}.tasks.{capability}.{…}`
 * with at least one additional segment after `{capability}` — typically
 * a content-type or sub-classifier. The cedar/sage convention is to
 * pass a compound capability (e.g. `'code-review.typescript'`) into
 * {@link taskSubject} so the resulting subject lands inside the
 * wildcard's match set. {@link taskSubject} alone (4 segments) does
 * **not** match this 5-segment wildcard.
 *
 * All segments are validated via {@link STACK_SEGMENT_REGEX} — wildcard
 * tokens (`*`, `>`, `.`) are rejected at the call site (sage#139 Security
 * lens — passing `'*'` would silently widen the subscription beyond the
 * intended capability scope).
 *
 * **Stack-aware form (myelin#113 — IAW Phase A.5; closes myelin#152).**
 * Pass `stack` to emit the 6-segment shape
 * `local.{principal}.{stack}.tasks.{capability}.>` matching sage's
 * stack-aware subscription wildcard (sage publishes verdicts and consumes
 * tasks on the 6-segment grammar; pilot publishes on the same grammar
 * post-pilot#110). Omitting `stack` preserves the legacy 5-segment form
 * for callers that haven't wired stack identity yet; new callers should
 * pass it explicitly.
 *
 * @throws Error when `principal`, `capability`, or `stack` is not a valid
 *   namespace segment.
 *
 * @example
 *   // Legacy 5-segment form (backward compat):
 *   offerTaskSubject('metafactory', 'code-review')
 *   // → 'local.metafactory.tasks.code-review.>'
 *
 *   // Stack-aware 6-segment form (post-myelin#113):
 *   offerTaskSubject('metafactory', 'code-review', 'default')
 *   // → 'local.metafactory.default.tasks.code-review.>'
 *   // Matches: local.metafactory.default.tasks.code-review.typescript
 *   // Does NOT match: local.metafactory.default.tasks.code-review (4-segment tail violates `>`)
 */
export function offerTaskSubject(
  principal: string,
  capability: string,
  stack?: string,
): string {
  // `assertSegment` label "org" is the error-message string consumed by
  // tests; the renamed code identifier is `principal` per R7 (vocabulary
  // migration 2026-05). Same labels-vs-code split Luna used in PR-7
  // `dispatch/lifecycle.ts`.
  assertSegment('org', principal);
  assertSegment('capability', capability);
  return `local.${principal}.${stackInfix(stack)}tasks.${capability}.>`;
}

/**
 * @deprecated Renamed to {@link offerTaskSubject} (vocabulary migration
 * 2026-05, R11). Removed in the next major. Old callers keep working
 * through the back-compat alias for one minor cycle.
 */
export const broadcastTaskSubject = offerTaskSubject;

/**
 * Subscribe-side wildcard for tasks routed to a single assistant by DID.
 *
 * Direct-routing mode — `local.{principal}.tasks.@{encoded-did}.>`. The
 * DID is encoded through {@link encodeDidSegment}, which both validates
 * against `DID_RE` and applies the reversible `:` → `-`, `.` → `--`
 * mapping.
 *
 * @throws Error when `did` does not match `DID_RE`.
 *
 * `principal` is validated via {@link STACK_SEGMENT_REGEX}; `did` via
 * {@link DID_RE} (inside `encodeDidSegment`). Wildcard tokens in either
 * argument are rejected at the call site.
 *
 * @example
 *   directTaskSubject('metafactory', 'did:mf:cedar')
 *   // → 'local.metafactory.tasks.@did-mf-cedar.>'
 *   directTaskSubject('metafactory', 'did:mf:hub.metafactory')
 *   // → 'local.metafactory.tasks.@did-mf-hub--metafactory.>'
 */
export function directTaskSubject(
  principal: string,
  did: string,
  stack?: string,
): string {
  assertSegment('org', principal);
  return `local.${principal}.${stackInfix(stack)}tasks.${encodeDidSegment(did)}.>`;
}

/**
 * Publish-side subject for a task assignment.
 *
 * Builds `local.{principal}.tasks.{capability}` where `capability` is either:
 *
 * - **Single segment** (`'code-review'`) — 4-segment direct/terminal
 *   subject. Used when the receiver is identified and offer fan-out
 *   is NOT desired. NATS `>` requires ≥1 trailing token, so a 4-segment
 *   subject is unreachable from `offerTaskSubject(principal, 'code-review')`.
 *
 * - **Compound path** (`'code-review.typescript'`) — 5-segment offer-
 *   reachable subject. The trailing segment slots inside
 *   `offerTaskSubject(principal, 'code-review')`'s wildcard. The
 *   cedar/sage convention is to append a content-type (`typescript`,
 *   `rust`) or sub-classifier.
 *
 * Validation: every dot-separated token in `capability` must
 * independently match {@link STACK_SEGMENT_REGEX}. That rejects every
 * wildcard / empty / non-grammar input the Security boundary cares about
 * (sage#139 cycle-2) while preserving cedar+sage's existing dotted
 * publish vocabulary (sage#139 cycle-3).
 *
 * **Stack-aware form (myelin#113 — IAW Phase A.5; closes myelin#152).**
 * Pass `stack` to emit the stack-aware shape
 * `local.{principal}.{stack}.tasks.{capability}` that pairs with
 * {@link offerTaskSubject}(principal, capability, stack). Omitting
 * `stack` preserves the legacy 5-segment form for callers that haven't
 * wired stack identity yet; new callers should pass it explicitly so
 * their publishes land inside the stack-aware subscriber wildcard.
 *
 * @throws Error when `principal` is not a valid segment, `capability` is
 *   not a valid segment path, or `stack` (when provided) is not a valid
 *   namespace segment.
 *
 * @example
 *   // Legacy 5-segment form (backward compat):
 *   taskSubject('metafactory', 'code-review.typescript')
 *   // → 'local.metafactory.tasks.code-review.typescript'
 *
 *   // Stack-aware form, offer-reachable under
 *   // `offerTaskSubject('metafactory', 'code-review', 'default')`:
 *   taskSubject('metafactory', 'code-review.typescript', 'default')
 *   // → 'local.metafactory.default.tasks.code-review.typescript'
 *
 *   // Direct/terminal stack-aware (5-segment subject, ≠ offer wildcard tail):
 *   taskSubject('metafactory', 'code-review', 'default')
 *   // → 'local.metafactory.default.tasks.code-review'
 */
export function taskSubject(
  principal: string,
  capability: string,
  stack?: string,
): string {
  assertSegment('org', principal);
  assertSegmentPath('capability', capability);
  return `local.${principal}.${stackInfix(stack)}tasks.${capability}`;
}

/**
 * Publish-side subject for a PR-related agent verdict.
 *
 * Parameterized on `kind` so cedar (`kind='opened'`,
 * `status='success'|'failed'`) and sage (`kind='review'`,
 * `status='approved'|'changes-requested'|'commented'`) can both use
 * the helper. The shape is `local.{principal}.code.pr.{kind}.{status}`.
 *
 * Boundary note (sage repo header): the `code.pr.{kind}.>` root is
 * reserved for review outcomes — *what the persona decided*. Operational
 * delivery signals (e.g. a GH-post failure) belong under the dispatch-
 * lifecycle namespace ({@link deriveLifecycleSubject}), not here, so
 * verdict-wildcard consumers don't have to filter.
 *
 * All segments are validated via {@link STACK_SEGMENT_REGEX} — wildcard
 * tokens are rejected so callers can't widen the verdict surface.
 *
 * @throws Error when `principal`, `kind`, or `status` is not a valid
 *   namespace segment.
 *
 * @example
 *   verdictSubject('metafactory', 'review', 'approved')
 *   // → 'local.metafactory.code.pr.review.approved'
 *   verdictSubject('metafactory', 'opened', 'success')
 *   // → 'local.metafactory.code.pr.opened.success'
 */
export function verdictSubject(
  principal: string,
  kind: string,
  status: string,
  stack?: string,
): string {
  assertSegment('org', principal);
  assertSegment('kind', kind);
  assertSegment('status', status);
  return `local.${principal}.${stackInfix(stack)}code.pr.${kind}.${status}`;
}

/**
 * Subscribe-side wildcard pairing with {@link verdictSubject}.
 *
 * `local.{principal}.code.pr.{kind}.>` — captures every status for a
 * single verdict kind. Dispatcher-side consumers (cedar's
 * `prOpenedWildcard`, sage's `verdictWildcard`) collapse into one helper
 * via the `kind` param.
 *
 * Both segments are validated via {@link STACK_SEGMENT_REGEX} — passing
 * `kind='*'` (which would broaden the subscription across all verdict
 * kinds) is rejected at the call site (sage#139 Security lens).
 *
 * @throws Error when `principal` or `kind` is not a valid namespace segment.
 *
 * @example
 *   verdictWildcard('metafactory', 'review')
 *   // → 'local.metafactory.code.pr.review.>'
 *   verdictWildcard('metafactory', 'opened')
 *   // → 'local.metafactory.code.pr.opened.>'
 */
/**
 * Bundle the `tasks.{capability}` subject and matching envelope `type` string
 * so callers stop carrying a second source of truth (myelin#143).
 *
 * The envelope `type` field on a task assignment is `tasks.{capability}` —
 * the same `{capability}` segment fed to {@link taskSubject}. Cedar, sage,
 * pilot, and grove previously re-derived that pairing locally; this helper
 * keeps subject and type aligned at the grammar source.
 *
 * Pure-string composition over {@link taskSubject}; validation rules,
 * throws, and shape are identical to that helper.
 *
 * @param stack Optional principal stack segment (myelin#154). Forwarded to
 *   {@link taskSubject}; the bundled `subject` is stack-aware when
 *   supplied, legacy form when omitted.
 *
 * @example
 *   taskSubjectAndType('metafactory', 'code-review.typescript')
 *   // → { subject: 'local.metafactory.tasks.code-review.typescript',
 *   //     type:    'tasks.code-review.typescript' }
 *   taskSubjectAndType('metafactory', 'code-review.typescript', 'default')
 *   // → { subject: 'local.metafactory.default.tasks.code-review.typescript',
 *   //     type:    'tasks.code-review.typescript' }
 */
export function taskSubjectAndType(
  principal: string,
  capability: string,
  stack?: string,
): { subject: string; type: string } {
  return {
    subject: taskSubject(principal, capability, stack),
    type: `tasks.${capability}`,
  };
}

/**
 * Bundle the verdict subject and matching envelope `type` string
 * (myelin#143).
 *
 * The envelope `type` on a PR verdict is `code.pr.{family}.{status}` —
 * mirroring the `{kind}.{status}` tail of {@link verdictSubject}.
 * `family` is the same segment {@link verdictSubject} calls `kind`.
 *
 * Pure-string composition over {@link verdictSubject}; validation rules,
 * throws, and shape are identical to that helper.
 *
 * @param stack Optional principal stack segment (myelin#154). Forwarded to
 *   {@link verdictSubject}; the bundled `subject` is stack-aware when
 *   supplied, legacy form when omitted. The envelope `type` is unchanged
 *   in either case — the stack segment lives only on the subject.
 *
 * @example
 *   prVerdictSubjectAndType('metafactory', 'review', 'approved')
 *   // → { subject: 'local.metafactory.code.pr.review.approved',
 *   //     type:    'code.pr.review.approved' }
 *   prVerdictSubjectAndType('metafactory', 'review', 'approved', 'default')
 *   // → { subject: 'local.metafactory.default.code.pr.review.approved',
 *   //     type:    'code.pr.review.approved' }
 */
export function prVerdictSubjectAndType(
  principal: string,
  family: string,
  status: string,
  stack?: string,
): { subject: string; type: string } {
  return {
    subject: verdictSubject(principal, family, status, stack),
    type: `code.pr.${family}.${status}`,
  };
}

export function verdictWildcard(
  principal: string,
  kind: string,
  stack?: string,
): string {
  assertSegment('org', principal);
  assertSegment('kind', kind);
  return `local.${principal}.${stackInfix(stack)}code.pr.${kind}.>`;
}

/**
 * Derive a NATS subject from string primitives (myelin#115).
 *
 * Pure-string contract — does NOT take a `MyelinEnvelope`. The
 * envelope-bound `deriveNatsSubject(envelope, stack?)` is a one-line
 * shim around this function.
 *
 * Rules:
 *
 * - `public.` subjects are never principal-scoped or stack-scoped: `public.{type}`.
 * - `local.`/`federated.` subjects with `stack` omitted emit the legacy
 *   5-segment shape `{prefix}.{principal}.{type}` (subscribers
 *   default-derive the missing stack to `default` per the spec migration
 *   window).
 * - `local.`/`federated.` subjects with `stack` supplied emit the
 *   6-segment shape `{prefix}.{principal}.{stack}.{type}`. The stack is
 *   validated against {@link STACK_SEGMENT_REGEX} and rejected on miss.
 */
export function deriveSubject(
  classification: SubjectClassification,
  principal: string,
  type: string,
  stack?: string,
): string {
  if (classification === 'public') {
    return `public.${type}`;
  }

  if (stack === undefined) {
    return `${classification}.${principal}.${type}`;
  }

  if (!STACK_SEGMENT_REGEX.test(stack)) {
    throw new Error(
      `Invalid stack segment "${stack}": must match ${STACK_SEGMENT_REGEX.source}`,
    );
  }

  return `${classification}.${principal}.${stack}.${type}`;
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
 *   - legacy      `{prefix}.{principal}.{type...}`              (segment[2] is first type segment)
 *   - stack-aware `{prefix}.{principal}.{stack}.{type...}`      (segment[2] is the stack)
 *
 * Two disambiguation strategies, in priority order:
 *
 * 1. **Caller-supplied `stack`** — when the caller knows the principal's stack
 *    identity (e.g., a transport layer that emitted the subject itself), pass
 *    it in. If `segment[2]` equals the supplied `stack`, the form is
 *    `stack-aware` even when it also happens to match the type prefix.
 *    This resolves the spec's seed-taxonomy collision (principals naming
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

/**
 * Derive the legacy 5-segment counterpart of a stack-aware subscription
 * pattern, when the spec's backward-compat rule allows it (myelin#154 —
 * `specs/namespace.md:88` rule MV-3).
 *
 * The spec says: *subscribers SHOULD treat a 5-segment subject without a
 * stack as `{principal}.default.>`.* This helper converts a stack-aware
 * subscription pattern into the matching 5-segment pattern that catches
 * legacy publishes during the migration window — but only when the input
 * pattern targets the `default` stack (or a wildcard at the stack slot,
 * meaning "any stack"). Patterns scoped to a non-`default` literal stack
 * return `null`: there's no legacy traffic to bridge for a stack that
 * legacy publishers couldn't have addressed.
 *
 * **NATS subject-matching semantics make this dual-subscribe correct.**
 * Stack-aware publishers emit 6-segment subjects; the derived 5-segment
 * pattern fails to match them positionally (segment[2] of a 6-seg subject
 * is the stack, not the domain — wildcards aside). Legacy publishers emit
 * 5-segment subjects; only the derived pattern matches them. No
 * duplicate delivery, no envelope-level dedup needed.
 *
 * Returns the derived pattern string, or `null` when the input is:
 *
 * - already 5-segment or shorter (no stack slot to strip)
 * - 3-segment with trailing `>` (e.g., `local.{principal}.>` — `>` already
 *   matches every shape under the principal; a derived dual would be identical)
 * - a non-`local`/`federated` prefix (`public.*` carries no stack)
 * - scoped to a literal non-`default` stack (no legacy traffic addresses it)
 *
 * @example
 *   deriveLegacySubjectPattern('local.acme.default.code.pr.>')
 *     === 'local.acme.code.pr.>'
 *   deriveLegacySubjectPattern('local.acme.*.code.pr.>')
 *     === 'local.acme.code.pr.>'
 *   deriveLegacySubjectPattern('local.acme.research.code.pr.>')
 *     === null
 *   deriveLegacySubjectPattern('local.acme.>')
 *     === null
 *   deriveLegacySubjectPattern('public.broadcast.>')
 *     === null
 */
export function deriveLegacySubjectPattern(pattern: string): string | null {
  const parts = pattern.split('.');
  if (parts.length < 4) {
    // Need at least [prefix, principal, stack, rest...] to have a stack slot to drop.
    return null;
  }

  const prefix = parts[0];
  if (prefix !== 'local' && prefix !== 'federated') {
    return null;
  }

  const stack = parts[2];
  // Spec rule: legacy → {principal}.default.>. Only patterns scoped to `default`
  // (or a `*` wildcard meaning "any single stack") have legacy traffic to
  // bridge. A literal non-`default` stack has no legacy counterpart.
  if (stack !== 'default' && stack !== '*') {
    return null;
  }

  // Drop the stack slot. parts.slice(0,2) keeps [prefix, principal]; parts.slice(3)
  // keeps everything from {domain} onward (including a trailing `>`).
  const legacyParts = [...parts.slice(0, 2), ...parts.slice(3)];
  return legacyParts.join('.');
}
