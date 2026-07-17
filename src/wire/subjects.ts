/**
 * ./wire — subject codec (RFC-0002, subject-namespace).
 *
 * The full published-subject / subscription-pattern validators, the @-address
 * codec, the capability-tag grammar, the reserved-space classifier, and the
 * corrected derivation primitives (stackless-reject, uppercase-reject,
 * prefix-classification-mismatch token, stack-named-`tasks` de-misparse). The
 * terminals are CONSUMED from `generated/r/subject-namespace` (#237/#280); the
 * DID @-segment codec is reused from `./identity`.
 *
 * Fail loud: validators return a discriminated {@link SubjectResult} carrying a
 * stable RFC-0002 reason token, never a bare boolean.
 */

import {
  CLASSIFICATION_VALUES,
  INFRA_PREFIX_VALUES,
  DISPATCH_TYPE_RE,
  type Classification,
} from "./generated/r/subject-namespace";
import { SEGMENT_MAX_LEN } from "./generated/r/identifiers";
import { encodeDidSegment, decodeDidSegment, segmentError } from "./identity";

export type SubjectResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

const ok = <T>(value: T): SubjectResult<T> => ({ ok: true, value });
const err = <T>(reason: string): SubjectResult<T> => ({ ok: false, reason });

const CLASSIFICATIONS = new Set<string>(CLASSIFICATION_VALUES);
const INFRA_PREFIXES = new Set<string>(INFRA_PREFIX_VALUES);
/** Reserved domain roots (RFC-0002 D11/D12/D13/D16) with a closed shape. */
const RESERVED_ROOTS = new Set(["tasks", "review", "dispatch", "brain"]);
/** Reserved tasks position-4 tags a capability MUST NOT equal (D16). */
const RESERVED_TASKS_TAGS = new Set(["dead-letter", "bid-request"]);

const MAX_SUBJECT_LEN = 255;

// ---------------------------------------------------------------------------
// deriveSubject — stackless-reject at the primitive (D18)
// ---------------------------------------------------------------------------

export interface DeriveSubjectInput {
  classification: Classification;
  type: string;
  principal?: string;
  stack?: string;
  legacy?: boolean;
}

/**
 * Derive a published subject. `public.` ignores identity fields. A non-public
 * subject with an absent stack MUST carry an explicit `legacy:true` opt-in
 * (5-segment migration form); an absent stack with NO opt-in is a REJECT (D18) —
 * the legacy/stack-aware choice is never made silently.
 */
export function deriveSubject(input: DeriveSubjectInput): SubjectResult<string> {
  const { classification, type, principal, stack, legacy } = input;
  if (classification === "public") {
    return ok(`public.${type}`);
  }
  if (stack === undefined) {
    if (legacy !== true) return err("stack-absent-not-opt-in");
    return ok(`${classification}.${principal}.${type}`);
  }
  return ok(`${classification}.${principal}.${stack}.${type}`);
}

/**
 * The subject-form publisher front door (E3). Validates the principal segment
 * BEFORE composing — a wildcard/malformed principal in a PUBLISHED subject is a
 * reject, never a silently-emitted `local.*.x.y`.
 */
export function subjectFor(spec: DeriveSubjectInput): SubjectResult<string> {
  if (spec.classification !== "public") {
    const p = spec.principal ?? "";
    if (p.includes("*") || p.includes(">")) return err("wildcard-in-published-subject");
    const e = segmentError(p);
    if (e) return err(e);
  }
  return deriveSubject(spec);
}

// ---------------------------------------------------------------------------
// resolveStackForIdentity — absent stack FAULTS, never `default` (cortex#1812)
// ---------------------------------------------------------------------------

/**
 * Resolve the authoritative stack for identity/roster/stack-id. The unsigned
 * subject stack is NEVER authoritative (D6/D7 signed-wins); with no signed stack
 * hint the resolution MUST fault rather than fabricate `default`.
 */
export function resolveStackForIdentity(input: {
  subject: string;
  signedStack?: string;
}): SubjectResult<string> {
  if (input.signedStack !== undefined && input.signedStack.length > 0) {
    return ok(input.signedStack);
  }
  return err("stack-absent-not-default");
}

// ---------------------------------------------------------------------------
// subjectPrefixAligns — prefix<->classification, with a reason token
// ---------------------------------------------------------------------------

export function subjectPrefixAligns(
  subject: string,
  classification: Classification,
): SubjectResult<{ aligned: true }> {
  const dot = subject.indexOf(".");
  const actual = dot === -1 ? subject : subject.slice(0, dot);
  if (actual === classification) return ok({ aligned: true });
  return err("prefix-classification-mismatch");
}

// ---------------------------------------------------------------------------
// transportMetricsSubject — lowercase-only {token} tail (D26)
// ---------------------------------------------------------------------------

export function transportMetricsSubject(
  principal: string,
  source: string,
  stack?: string,
): SubjectResult<string> {
  if (/[A-Z]/.test(source)) return err("uppercase-not-lowercase");
  const infix = stack === undefined ? "" : `${stack}.`;
  return ok(`local.${principal}.${infix}_metrics.transport.${source}`);
}

// ---------------------------------------------------------------------------
// taskDeadLetterSubject — stack-aware priority (de-misparse stack named `tasks`)
// ---------------------------------------------------------------------------

const STACK_SEGMENT_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export function taskDeadLetterSubject(originalSubject: string): SubjectResult<string> {
  const parts = originalSubject.split(".");
  const prefix = parts[0];
  if (prefix !== "local" && prefix !== "federated") {
    return err("unexpected-subject-shape");
  }
  const legacyTaskIndex = parts[2] === "tasks" ? 2 : -1;
  const stackAwareTaskIndex =
    parts[3] === "tasks" && parts[2] !== undefined && STACK_SEGMENT_RE.test(parts[2]) ? 3 : -1;
  // Stack-aware wins: a stack literally named `tasks` must not be mis-read as
  // the legacy tasks position (the cortex#… misparse this de-fangs).
  const taskIndex = stackAwareTaskIndex !== -1 ? stackAwareTaskIndex : legacyTaskIndex;
  if (taskIndex === -1 || parts.length <= taskIndex + 2) {
    return err("unexpected-subject-shape");
  }
  const capabilityIndex = taskIndex + 1;
  if (parts[capabilityIndex] === "dead-letter") return ok(originalSubject);
  const head = parts.slice(0, taskIndex + 1);
  return ok([...head, "dead-letter", parts[capabilityIndex]].join("."));
}

// ---------------------------------------------------------------------------
// validateCapabilityTag — subject-position tag grammar (D15/D16/D29)
// ---------------------------------------------------------------------------

export function validateCapabilityTag(tag: string): SubjectResult<string> {
  if (RESERVED_TASKS_TAGS.has(tag)) return err("reserved-tasks-position-tag");
  if (tag.includes(".") || tag.includes("_")) return err("not-subject-safe");
  if (tag.length < 2) return err("too-short");
  if (tag.endsWith("-")) return err("trailing-hyphen");
  if (!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(tag) || tag.includes("--")) {
    return err("malformed-capability-tag");
  }
  return ok(tag);
}

// ---------------------------------------------------------------------------
// @-segment validator — per-inner-msi 63 cap, whole-segment exempt (D2)
// ---------------------------------------------------------------------------

export function validateAtSegment(seg: string): SubjectResult<{ length: number }> {
  const PREFIX = "@did-mf-";
  if (!seg.startsWith(PREFIX)) return err("not-an-at-address");
  if (seg.includes("_")) return err("charset-underscore-not-permitted");
  const innerMsi = seg.slice(PREFIX.length);
  const innerSegments = innerMsi.split("--");
  for (const s of innerSegments) {
    if (s.length > SEGMENT_MAX_LEN) return err("msi-segment-exceeds-63");
  }
  return ok({ length: seg.length });
}

// ---------------------------------------------------------------------------
// classifySubject — reserved-space (`_INBOX`/`_audit`/...) classifier (D20-D22)
// ---------------------------------------------------------------------------

export function classifySubject(
  subject: string,
): SubjectResult<{ reserved: boolean; prefix?: string }> {
  const first = subject.split(".")[0] ?? "";
  if (/^_INBOX$/i.test(first) && first === "_INBOX") {
    return ok({ reserved: true, prefix: "_INBOX" });
  }
  if (INFRA_PREFIXES.has(first)) return ok({ reserved: true, prefix: first });
  return ok({ reserved: false });
}

// ---------------------------------------------------------------------------
// validateAppPublish — application-publish guard (D11/D20)
// ---------------------------------------------------------------------------

export function validateAppPublish(subject: string): SubjectResult<true> {
  const parts = subject.split(".");
  const first = parts[0] ?? "";
  // D20: a leading '_' is the universal reservation marker — infra-only.
  if (first.startsWith("_")) return err("reserved-prefix-not-app-emittable");
  // Reserved-root shape guard: a reserved domain root fails closed against
  // application misuse. Locate the type root (after classification/principal/
  // stack) and verify its shape.
  if (CLASSIFICATIONS.has(first) && first !== "public") {
    const type = parts.slice(3).join(".");
    const root = parts[3];
    if (root === "dispatch" && !DISPATCH_TYPE_RE.test(type)) {
      return err("reserved-domain-root-shape-violation");
    }
  }
  return ok(true);
}

// ---------------------------------------------------------------------------
// validateTaskRecipient — @-segment byte-compare gate (lifted from cortex)
// ---------------------------------------------------------------------------

export function validateTaskRecipient(input: {
  subject: string;
  target_assistant: string;
}): SubjectResult<{ matches: boolean }> {
  const encoded = encodeDidSegment(input.target_assistant);
  if (!encoded.ok) return err("target-assistant-not-a-did");
  const atSeg = input.subject.split(".").find((s) => s.startsWith("@did-mf-"));
  if (atSeg === undefined) return err("no-recipient-address-in-subject");
  if (atSeg === encoded.value) return ok({ matches: true });
  return err("recipient-address-mismatch");
}

// ---------------------------------------------------------------------------
// validateSubPattern — subscription-pattern grammar (D24/D28)
// ---------------------------------------------------------------------------

export function validateSubPattern(
  pattern: string,
): SubjectResult<{ classification: Classification }> {
  const first = pattern.split(".")[0] ?? "";
  if (first === ">") return err("wildcard-crosses-scope");
  if (first === "*") return err("wildcard-in-classification-position");
  if (first.startsWith("_")) return err("reserved-space-not-app-subscribable");
  if (!CLASSIFICATIONS.has(first)) return err("unknown-classification-prefix");
  return ok({ classification: first as Classification });
}

// ---------------------------------------------------------------------------
// validatePublishedSubject — full parse + per-shape projection
// ---------------------------------------------------------------------------

/**
 * Validate + project a fully-qualified published subject. Enforces the 255-total
 * / 63-per-segment caps and kebab-strict segments, then returns a shape-specific
 * projection (scope fields for a generic type, domain fields for a reserved
 * root). Reason tokens: `subject-too-long`, `segment-length-exceeds-63`, the
 * kebab-strict segment tokens, `unknown-classification-prefix`,
 * `missing-principal-body`.
 */
export function validatePublishedSubject(
  subject: string,
): SubjectResult<Record<string, unknown>> {
  if (subject.length > MAX_SUBJECT_LEN) return err("subject-too-long");
  const parts = subject.split(".");
  const cls = parts[0] ?? "";

  // Per-segment caps + kebab-strict. @-address segments are exempt from the
  // per-segment cap and carry their own charset.
  for (const seg of parts) {
    if (seg.startsWith("@did-mf-")) continue;
    if (seg.startsWith("_")) continue; // reserved segments have their own rules
    if (seg.length > SEGMENT_MAX_LEN) return err("segment-length-exceeds-63");
    const e = segmentError(seg);
    if (e) return err(e);
  }

  if (!CLASSIFICATIONS.has(cls)) return err("unknown-classification-prefix");

  if (cls === "public") {
    if (parts.length < 2) return err("missing-principal-body");
    return ok({ classification: "public", type: parts.slice(1).join(".") });
  }

  // local / federated: {classification}.{principal}.{stack}.{type...}
  if (parts.length < 3) return err("missing-principal-body");
  const principal = parts[1] ?? "";
  const stack = parts[2] ?? "";
  const type = parts.slice(3);
  const root = type[0];

  if (root !== undefined && RESERVED_ROOTS.has(root)) {
    return ok(projectReservedRoot(root, type));
  }
  // Generic (open) domain root → scope projection.
  return ok({ classification: cls, principal, stack, type: type.join(".") });
}

function projectReservedRoot(root: string, type: string[]): Record<string, unknown> {
  switch (root) {
    case "tasks": {
      const t1 = type[1];
      if (t1 === "bid-request") return { shape: "bid-request", capability: type[2] };
      if (t1?.startsWith("@did-mf-")) {
        const decoded = decodeDidSegment(t1);
        return {
          shape: "direct",
          assistant: decoded.ok ? decoded.value : t1,
          capability: type[2],
        };
      }
      return { domain: "tasks", shape: "offer", capability: t1 };
    }
    case "review":
      return { domain: "review", shape: "verdict", kind: type[2], status: type[3] };
    case "dispatch":
      return { domain: "dispatch", state: type[2] };
    case "brain":
      return { domain: "brain" };
    default:
      return { domain: root };
  }
}
