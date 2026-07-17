import {
  deriveSubject,
  subjectFor,
  subjectPrefixAligns,
  detectSubjectForm,
  taskDeadLetterSubject,
  transportMetricsSubject,
  type SubjectSpec,
} from "../../subjects";
import { subjectMatchesPattern } from "../../subject-matching";
import { CAPABILITY_TAG_RE } from "../../patterns";
import type { SubjectClassification } from "../../classifications";
import { NotImplemented, type Adapter, type VectorResult } from "../types";

/**
 * Subject-namespace adapters (RFC-0001 / RFC-0002, specs/vectors/subject-namespace).
 *
 * The subject grammar's PRIMITIVES exist on main today (`src/subjects.ts`,
 * `src/subject-matching.ts`, `src/patterns.ts`) — subject derivation, prefix
 * alignment, form detection, dead-letter derivation, metrics subjects, pattern
 * matching, and the capability-tag regex. The full VALIDATORS the vectors assert
 * (`validatePublishedSubject`, `validateSubPattern`, `validateAtSegment`,
 * `validateAppPublish`, `classifySubject`, `resolveStackForIdentity`, and
 * `validateTaskRecipient` — lifted from cortex) are the #238 ./wire deliverable
 * (design-rfc-alignment.md §W4/line 52). Those kinds throw `NotImplemented` and
 * are manifested as unimplemented.
 *
 * Reason-token / defect notes for the impl-backed kinds:
 *  - The primitives return booleans / raw strings, NOT the RFC reason tokens the
 *    reject vectors assert — those tokens ride in with #238's validators. So an
 *    accept-half passes while the paired reject-half manifests on a missing token.
 *  - Several vectors pin KNOWN DEFECTS the primitives still carry (deriveSubject
 *    silent stackless emit; subjectFor skipping principal/type grammar; the
 *    dead-letter legacy-priority misparse; the metrics uppercase leak; capability
 *    tags admitting reserved `dead-letter`/`bid-request`). Each is reported with
 *    the impl's ACTUAL output and manifested to #238.
 *
 * NOTE: encode/decodeDidSegment are OWNED by the identity adapter module — not
 * defined here (the registry asserts against duplicate kinds).
 */

function asRecord(x: unknown): Record<string, unknown> {
  return (x ?? {}) as Record<string, unknown>;
}

export const subjectsAdapters: Record<string, Adapter> = {
  // ── Impl-backed primitives ───────────────────────────────────────────────

  deriveSubject: (input): VectorResult => {
    const i = asRecord(input);
    // deriveSubject(classification, principal, type, stack?). The vector's
    // `legacy` flag is a subjectFor concern; the primitive has NO reject path
    // (D18 stackless-reject arrives with #238), so an absent-stack input still
    // emits silently → legacy/reject-silent-stackless-emit manifests.
    const value = deriveSubject(
      i.classification as SubjectClassification,
      i.principal as string,
      i.type as string,
      i.stack as string | undefined,
    );
    return { ok: true, value };
  },

  subjectFor: (input): VectorResult => {
    // subjectFor THROWS on blank principal / absent-stack-without-legacy, but
    // does NO segment-grammar validation on principal/type — a wildcard principal
    // round-trips into 'local.*.x.y' (published/reject-wildcard-principal
    // manifests until #238 lands published-subject grammar checks).
    const value = subjectFor(input as SubjectSpec);
    return { ok: true, value };
  },

  subjectPrefixAligns: (input): VectorResult => {
    const i = asRecord(input);
    const r = subjectPrefixAligns(
      i.subject as string,
      i.classification as SubjectClassification,
    );
    // Returns only {aligned, expected, actual} — no reason token. Accept-half
    // asserts value {aligned:true}; the reject-half's `prefix-classification-
    // mismatch` token is spec-ahead (#238).
    return r.aligned ? { ok: true, value: { aligned: true } } : { ok: false };
  },

  detectSubjectForm: (input): VectorResult => {
    const i = asRecord(input);
    const r = detectSubjectForm(
      i.subject as string,
      i.envelopeType as string | undefined,
      i.stack as string | undefined,
    );
    // r is already {form} | {form, stack} — matches the vector's expect.value shape.
    return { ok: true, value: r };
  },

  taskDeadLetterSubject: (input): VectorResult => {
    // Legacy-priority parse (parts[2]==='tasks' wins) misparses a stack literally
    // named 'tasks', dropping the stack → deadletter/stack-named-tasks-misparse
    // manifests; the stack-aware happy path passes.
    return { ok: true, value: taskDeadLetterSubject(input as string) };
  },

  transportMetricsSubject: (input): VectorResult => {
    const i = asRecord(input);
    // sanitizeSubjectToken preserves A-Z, so an uppercase source leaks into the
    // emitted subject → metrics/reject-uppercase manifests; the lowercase
    // accept-half passes.
    return {
      ok: true,
      value: transportMetricsSubject(i.principal as string, i.source as string),
    };
  },

  matchSubscription: (input): VectorResult => {
    const i = asRecord(input);
    const matches = subjectMatchesPattern(i.subject as string, i.pattern as string);
    return { ok: true, value: { matches } };
  },

  validateCapabilityTag: (input): VectorResult => {
    const tag = input as string;
    // CAPABILITY_TAG_RE (patterns.ts) is today's capability-tag grammar. It has
    // no reason tokens and no reserved-tag (`dead-letter`/`bid-request`)
    // rejection — both arrive with #238's validateCapabilityTag+isReservedTasksTag.
    // Valid tags pass; every reject-half manifests (missing token, or the impl
    // wrongly ACCEPTS a reserved tag).
    return CAPABILITY_TAG_RE.test(tag) ? { ok: true, value: tag } : { ok: false };
  },

  // ── #238 ./wire validators — not on main yet (design-rfc-alignment.md line 52) ─

  // Full published-subject parse/validate (classification + principal/stack/type
  // split, domain/shape tagging, 255-total + 63-per-segment caps). No parser
  // exists on main — `parseSubject`/`validatePublishedSubject` land with #238.
  validatePublishedSubject: () => {
    throw new NotImplemented("validatePublishedSubject", "myelin#238");
  },

  // Subscription-pattern grammar (wildcard-position rules, anchored-classification,
  // reserved-space non-subscribability). Arrives with #238.
  validateSubPattern: () => {
    throw new NotImplemented("validateSubPattern", "myelin#238");
  },

  // @-segment validator (charset, per-inner-msi 63-cap with whole-segment
  // exemption). No standalone @-segment validator on main — lands with #238.
  validateAtSegment: () => {
    throw new NotImplemented("validateAtSegment", "myelin#238");
  },

  // Application-publish guard (reserved-domain-root fail-closed, reserved '_'
  // prefix not app-emittable). Arrives with #238.
  validateAppPublish: () => {
    throw new NotImplemented("validateAppPublish", "myelin#238");
  },

  // Recipient-security gate (byte-compare the @-segment against
  // encodeDidSegment(target)) — lifted from cortex dispatch-listener with #238.
  validateTaskRecipient: () => {
    throw new NotImplemented("validateTaskRecipient", "myelin#238");
  },

  // Reserved-prefix classifier (`_INBOX`/`_audit` reference admission). No
  // reserved-space classifier on main — lands with #238.
  classifySubject: () => {
    throw new NotImplemented("classifySubject", "myelin#238");
  },

  // Identity-plane stack resolution: an ABSENT unsigned-subject stack MUST fault
  // (`stack-absent-not-default`), never be fabricated into `default` (cortex#1812
  // root cause, D6/D7 signed-wins). No such resolver on main — lands with #238.
  resolveStackForIdentity: () => {
    throw new NotImplemented("resolveStackForIdentity", "myelin#238");
  },
};
