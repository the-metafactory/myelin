/**
 * ./wire — capability surface (RFC-0008 / RFC-0005 OD-7).
 *
 * The converged `capability-id` codec (§4.1), the directional SEGMENT-PREFIX
 * matcher (§4.2), the presence fold-gate (§7 D5 validate-before-fold), the
 * pre-convergence cross-grammar diagnostic (§4.2 masking case), and the
 * sovereignty-mode equality matcher (RFC-0005 OD-7 / §6.5).
 *
 * Grammar terminals are CONSUMED from `generated/r/capability-discovery`
 * (myelin#237/#280) — never re-hand-written. The accept/reject decision is the
 * generated terminal's; the reason-token derivation here is a diagnostic layer
 * that runs only on the reject path, so the codec can never diverge from the
 * ratified grammar on what it admits.
 */

import {
  CAPABILITY_ID_RE,
  CAPABILITY_TAG_RE,
  CAPABILITY_TAG_MIN_LEN,
  CAPABILITY_ID_COMPOUND_RE,
} from "./generated/r/capability-discovery";

export type CapabilityResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

const fail = (reason: string): CapabilityResult<never> => ({ ok: false, reason });

/**
 * A parsed `capability-id`. A single-segment id keeps its backward-compatible
 * `tag` form; a dotted-compound id yields its ordered `segments`. The two shapes
 * are disjoint so a matcher can never confuse `foo` with `[foo]` by accident.
 */
export type ParsedCapabilityId = { tag: string } | { segments: string[] };

/**
 * Reason token for a single `capability-tag` that the generated terminal
 * rejected. Ordered so the most specific structural fault wins; the trailing
 * `invalid-capability-tag` fallback covers anything the ordered checks miss
 * (e.g. an out-of-alphabet symbol), so every reject path names a reason.
 * `isCompound` only redirects the underscore token: a bare tag reports
 * `underscore-not-allowed`; an underscore inside a dotted id reports
 * `underscore-in-segment` (RFC-0008 vectors distinguish the two).
 */
function tagRejectReason(seg: string, isCompound: boolean): string {
  if (seg.length < CAPABILITY_TAG_MIN_LEN) return "single-char-forbidden";
  if (/[A-Z]/.test(seg)) return "uppercase-not-allowed";
  if (seg.includes("_")) return isCompound ? "underscore-in-segment" : "underscore-not-allowed";
  if (/^[0-9]/.test(seg)) return "digit-prefix";
  if (seg.startsWith("-")) return "leading-hyphen";
  if (seg.endsWith("-")) return "trailing-hyphen";
  if (seg.includes("--")) return "consecutive-hyphen";
  return "invalid-capability-tag";
}

/**
 * Parse a `capability-id` (RFC-0008 §4.1): one or more `.`-separated
 * `capability-tag` segments. Accept is decided SOLELY by the generated
 * `CAPABILITY_ID_RE`; on reject we split and diagnose the first offending
 * segment (empty-segment for a dot-edge, else the tag fault).
 */
export function parseCapabilityId(id: unknown): CapabilityResult<ParsedCapabilityId> {
  if (typeof id !== "string") return fail("not-a-string");
  if (id.length === 0) return fail("empty");

  const segments = id.split(".");
  const isCompound = segments.length > 1;

  if (CAPABILITY_ID_RE.test(id)) {
    return { ok: true, value: isCompound ? { segments } : { tag: id } };
  }

  // Rejected by the ratified terminal — derive a precise reason. A dot-edge
  // (leading/trailing/consecutive dot) surfaces as an empty segment; otherwise
  // the first segment failing the tag grammar names the fault. The final
  // fallback only fires on generator drift (every segment passes the tag RE yet
  // the whole-id RE rejects) — never silently accept in that case.
  if (segments.some((s) => s.length === 0)) return fail("empty-segment");
  for (const seg of segments) {
    if (!CAPABILITY_TAG_RE.test(seg)) return fail(tagRejectReason(seg, isCompound));
  }
  return fail("invalid-capability-id");
}

function segmentsOf(parsed: ParsedCapabilityId): string[] {
  return "segments" in parsed ? parsed.segments : [parsed.tag];
}

/**
 * Directional segment-prefix match (RFC-0008 §4.2): a requirement matches an
 * advertisement IFF the requirement's segment array is a WHOLE-SEGMENT prefix of
 * the advertisement's. `code-review` matches `code-review.typescript` (and
 * itself); the reverse — a deeper requirement against a shallower advertisement —
 * does NOT. The comparison is on parsed segment arrays, never raw-string
 * `startsWith`: that is precisely what stops `code-rev` from matching
 * `code-review`. Either id failing the grammar is a hard non-match (a malformed
 * capability can never satisfy a requirement), surfaced as `ok:false` so the
 * caller cannot read a `match:true` off bad input.
 */
export function matchCapabilityId(input: {
  required: unknown;
  advertised: unknown;
}): CapabilityResult<{ match: boolean }> {
  const required = parseCapabilityId(input.required);
  if (!required.ok) return fail(`required-${required.reason}`);
  const advertised = parseCapabilityId(input.advertised);
  if (!advertised.ok) return fail(`advertised-${advertised.reason}`);

  const req = segmentsOf(required.value);
  const adv = segmentsOf(advertised.value);

  const match = req.length <= adv.length && req.every((seg, i) => seg === adv[i]);
  return { ok: true, value: { match } };
}

/**
 * Reserved capability positions (RFC-0008 §4.3, delegating to RFC-0002): a
 * producer MUST NOT advertise `dead-letter` (the unclaimable-task escalation
 * path) or an `@`-prefixed tag (the assistant-address form).
 */
function isReservedTag(tag: string): boolean {
  return tag === "dead-letter" || tag.startsWith("@");
}

/**
 * Presence fold-gate (RFC-0008 §7 D5 — validate BEFORE fold). Every
 * `capabilities[]` entry MUST parse as a §4.1 converged id and MUST NOT be a
 * reserved tag (§4.3) before the announcement folds into the liveness registry.
 * This closes the §9.1 fold-without-validation defect. Payload-schema and
 * aggregate-size bounding (also named in D5) compose from the envelope validator
 * upstream; this gate owns the capability dimension only.
 *
 * Grammar is checked before the reservation so an ungrammatical id reports
 * `ungrammatical-capability-id` rather than being probed for reservation.
 */
export function validatePresenceAnnouncement(
  input: { capabilities?: unknown } | null | undefined,
): CapabilityResult<{ folded: true }> {
  const caps = input?.capabilities;
  if (!Array.isArray(caps)) return fail("capabilities-not-an-array");

  for (const cap of caps) {
    if (!parseCapabilityId(cap).ok) return fail("ungrammatical-capability-id");
    if (typeof cap === "string" && isReservedTag(cap)) return fail("reserved-capability-tag");
  }
  return { ok: true, value: { folded: true } };
}

/**
 * Pre-convergence cross-grammar diagnostic (RFC-0008 §4.2 masking case). Reports
 * whether an id is admitted by the myelin single-segment tag grammar
 * (`CAPABILITY_TAG_RE`) and by the retired cortex compound grammar
 * (`CAPABILITY_ID_COMPOUND_RE`). A seed tag such as `code-review` passing BOTH is
 * exactly what once hid the C-3 divergence; post-convergence this is a historical
 * agreement checker over the two generated terminals, not a validation gate.
 */
export function crossGrammarAgreement(id: unknown): CapabilityResult<{
  acceptedByTag: boolean;
  acceptedByCompound: boolean;
}> {
  if (typeof id !== "string") return fail("not-a-string");
  return {
    ok: true,
    value: {
      acceptedByTag: CAPABILITY_TAG_RE.test(id),
      acceptedByCompound: CAPABILITY_ID_COMPOUND_RE.test(id),
    },
  };
}

/**
 * Sovereignty-mode matcher (RFC-0005 OD-7 / §6.5): PLAIN EQUALITY. There is NO
 * implied ordering between modes — `selective` does not subsume `strict`; a
 * capability's declared mode matches a requirement iff they are byte-equal.
 */
export function matchSovereigntyMode(input: {
  required: string;
  declared: string;
}): CapabilityResult<{ match: boolean }> {
  return { ok: true, value: { match: input.required === input.declared } };
}
