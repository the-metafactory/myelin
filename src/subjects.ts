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

// DID grammar lives in `./identity/types` — a tiny leaf module with no
// runtime deps (regex + types only). Importing it here preserves the
// no-envelope-dep boundary that the `/subjects` subpath promises.
import { DID_RE } from './identity/types';

/**
 * Encode a DID into a NATS-safe direct-routing subject segment (myelin#135).
 *
 * Reversible, injective mapping used in direct-routing subjects of the form
 * `local.{org}.{stack}.tasks.@{principal}.{capability}`. Source of truth for
 * the encoding rules is `specs/namespace.md` §"Principal encoding".
 *
 * | Source character | Encoded as |
 * |---|---|
 * | `:` (DID separator) | `-` (single hyphen) |
 * | `.` (inside method-specific-id) | `--` (double hyphen) |
 * | `-` (inside method-specific-id) | `-` (preserved) |
 * | `[a-z0-9]` | passthrough |
 *
 * The output is prefixed with `@` so subscribers and audit pipelines can
 * recognize a principal segment without payload inspection.
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

/**
 * Validate that a string is a single namespace segment per
 * `specs/namespace.md` — i.e., matches {@link STACK_SEGMENT_REGEX}.
 *
 * Used by the agent-task helpers to reject NATS wildcard tokens (`*`,
 * `>`, `.`) and any other input that would broaden a subscription or
 * inject a different subject root than the helper's documented shape
 * (sage#139 cycle-2 Security lens).
 *
 * @throws Error with the offending segment name and value.
 */
function assertSegment(name: string, value: string): void {
  if (!STACK_SEGMENT_REGEX.test(value)) {
    throw new Error(
      `Invalid ${name} segment "${value}": must match ${STACK_SEGMENT_REGEX.source}`,
    );
  }
}

/**
 * Validate a dot-separated namespace path: every token between dots
 * must independently match {@link STACK_SEGMENT_REGEX}.
 *
 * Used where the helper deliberately accepts compound capabilities
 * (e.g. `'code-review.typescript'`) to preserve cedar/sage's existing
 * publish vocabulary (sage#139 cycle-3 — strict single-segment
 * validation broke their migration path). The per-token check still
 * rejects every wildcard / empty / non-grammar input the security
 * boundary cares about, because `*`, `>`, `''`, leading-dot, trailing-
 * dot, and consecutive-dot cases all produce at least one token that
 * fails `STACK_SEGMENT_REGEX`.
 *
 * @throws Error identifying the offending path and the bad token.
 */
function assertSegmentPath(name: string, value: string): void {
  if (value === '') {
    throw new Error(`Invalid ${name} path "${value}": must be non-empty`);
  }
  const tokens = value.split('.');
  for (const tok of tokens) {
    if (!STACK_SEGMENT_REGEX.test(tok)) {
      throw new Error(
        `Invalid ${name} path "${value}": token "${tok}" must match ${STACK_SEGMENT_REGEX.source}`,
      );
    }
  }
}

/* ─────────────────────────────────────────────────────────────────────
 * Agent-task subject vocabulary (myelin#134)
 *
 * Cedar, Sage, and any future task-dispatching agent (Pilot, Grove, …)
 * previously carried private copies of these helpers in
 * `src/bus/subjects.ts`. Pulling them upstream removes the drift risk
 * already documented in cedar's and sage's file headers, and gives the
 * ecosystem a single grammar source.
 *
 * Shape is the legacy 5-segment form (`local.{org}.tasks.{…}`) — same
 * choice as the existing `deriveLifecycleSubject` and the cedar/sage
 * helpers being replaced. The stack-aware 6-segment shape stays opt-in
 * via the lower-level `deriveSubject(…, stack)` for callers that have
 * already wired their stack identity through configuration.
 *
 * Pure-string contract: no envelope, no transport — same boundary as
 * the rest of this file. `directTaskSubject` is the one non-trivial
 * helper; it composes `encodeDidSegment` (which validates against
 * `DID_RE`) so invalid DIDs throw at the call site, never on the wire.
 *
 * The dispatch-lifecycle subjects (`local.{org}.dispatch.task.{phase}`)
 * are already exported as {@link deriveLifecycleSubject} /
 * {@link deriveLifecycleWildcard} in `./dispatch/lifecycle`; the helpers
 * below cover the remaining inbound (tasks) and outbound (verdict)
 * surfaces from issue #134.
 * ───────────────────────────────────────────────────────────────────── */

/**
 * Subscribe-side wildcard for tasks broadcast to a capability fan-out.
 *
 * Used by any agent advertising a capability. The receiver subscribes
 * `local.{org}.tasks.{capability}.>` and the broker fans messages out
 * to all listeners on a queue group.
 *
 * **NATS wildcard semantics.** The `>` token matches **one or more**
 * trailing segments, never zero. A publisher reaching subscribers on
 * this wildcard must publish on `local.{org}.tasks.{capability}.{…}`
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
 * @throws Error when `org` or `capability` is not a valid namespace segment.
 *
 * @example
 *   broadcastTaskSubject('metafactory', 'code-review')
 *   // → 'local.metafactory.tasks.code-review.>'
 *   // Matches: local.metafactory.tasks.code-review.typescript
 *   // Does NOT match: local.metafactory.tasks.code-review
 */
export function broadcastTaskSubject(org: string, capability: string): string {
  assertSegment('org', org);
  assertSegment('capability', capability);
  return `local.${org}.tasks.${capability}.>`;
}

/**
 * Subscribe-side wildcard for tasks routed to a single principal by DID.
 *
 * Direct-routing mode — `local.{org}.tasks.@{encoded-did}.>`. The DID is
 * encoded through {@link encodeDidSegment}, which both validates against
 * `DID_RE` and applies the reversible `:` → `-`, `.` → `--` mapping.
 *
 * @throws Error when `did` does not match `DID_RE`.
 *
 * `org` is validated via {@link STACK_SEGMENT_REGEX}; `did` via
 * {@link DID_RE} (inside `encodeDidSegment`). Wildcard tokens in either
 * argument are rejected at the call site.
 *
 * @example
 *   directTaskSubject('metafactory', 'did:mf:cedar')
 *   // → 'local.metafactory.tasks.@did-mf-cedar.>'
 *   directTaskSubject('metafactory', 'did:mf:hub.metafactory')
 *   // → 'local.metafactory.tasks.@did-mf-hub--metafactory.>'
 */
export function directTaskSubject(org: string, did: string): string {
  assertSegment('org', org);
  return `local.${org}.tasks.${encodeDidSegment(did)}.>`;
}

/**
 * Publish-side subject for a task assignment.
 *
 * Builds `local.{org}.tasks.{capability}` where `capability` is either:
 *
 * - **Single segment** (`'code-review'`) — 4-segment direct/terminal
 *   subject. Used when the receiver is identified and broadcast fan-out
 *   is NOT desired. NATS `>` requires ≥1 trailing token, so a 4-segment
 *   subject is unreachable from `broadcastTaskSubject(org, 'code-review')`.
 *
 * - **Compound path** (`'code-review.typescript'`) — 5-segment broadcast-
 *   reachable subject. The trailing segment slots inside
 *   `broadcastTaskSubject(org, 'code-review')`'s wildcard. The cedar/sage
 *   convention is to append a content-type (`typescript`, `rust`) or
 *   sub-classifier.
 *
 * Validation: every dot-separated token in `capability` must
 * independently match {@link STACK_SEGMENT_REGEX}. That rejects every
 * wildcard / empty / non-grammar input the Security boundary cares about
 * (sage#139 cycle-2) while preserving cedar+sage's existing dotted
 * publish vocabulary (sage#139 cycle-3).
 *
 * @throws Error when `org` is not a valid segment or `capability` is
 *   not a valid segment path.
 *
 * @example
 *   // Direct/terminal: only reaches subscribers on the exact subject.
 *   taskSubject('metafactory', 'code-review')
 *   // → 'local.metafactory.tasks.code-review'
 *
 *   // Broadcast-reachable: subscribers on `local.{org}.tasks.code-review.>` get this.
 *   taskSubject('metafactory', 'code-review.typescript')
 *   // → 'local.metafactory.tasks.code-review.typescript'
 */
export function taskSubject(org: string, capability: string): string {
  assertSegment('org', org);
  assertSegmentPath('capability', capability);
  return `local.${org}.tasks.${capability}`;
}

/**
 * Publish-side subject for a PR-related agent verdict.
 *
 * Parameterized on `kind` so cedar (`kind='opened'`,
 * `status='success'|'failed'`) and sage (`kind='review'`,
 * `status='approved'|'changes-requested'|'commented'`) can both use
 * the helper. The shape is `local.{org}.code.pr.{kind}.{status}`.
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
 * @throws Error when `org`, `kind`, or `status` is not a valid namespace
 *   segment.
 *
 * @example
 *   verdictSubject('metafactory', 'review', 'approved')
 *   // → 'local.metafactory.code.pr.review.approved'
 *   verdictSubject('metafactory', 'opened', 'success')
 *   // → 'local.metafactory.code.pr.opened.success'
 */
export function verdictSubject(org: string, kind: string, status: string): string {
  assertSegment('org', org);
  assertSegment('kind', kind);
  assertSegment('status', status);
  return `local.${org}.code.pr.${kind}.${status}`;
}

/**
 * Subscribe-side wildcard pairing with {@link verdictSubject}.
 *
 * `local.{org}.code.pr.{kind}.>` — captures every status for a single
 * verdict kind. Dispatcher-side consumers (cedar's `prOpenedWildcard`,
 * sage's `verdictWildcard`) collapse into one helper via the `kind` param.
 *
 * Both segments are validated via {@link STACK_SEGMENT_REGEX} — passing
 * `kind='*'` (which would broaden the subscription across all verdict
 * kinds) is rejected at the call site (sage#139 Security lens).
 *
 * @throws Error when `org` or `kind` is not a valid namespace segment.
 *
 * @example
 *   verdictWildcard('metafactory', 'review')
 *   // → 'local.metafactory.code.pr.review.>'
 *   verdictWildcard('metafactory', 'opened')
 *   // → 'local.metafactory.code.pr.opened.>'
 */
export function verdictWildcard(org: string, kind: string): string {
  assertSegment('org', org);
  assertSegment('kind', kind);
  return `local.${org}.code.pr.${kind}.>`;
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
