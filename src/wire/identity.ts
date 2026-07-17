/**
 * ./wire — identity codec (RFC-0001, class-explicit did:mf grammar).
 *
 * The single owner of every `did:mf:` transform: parse (fail-closed, class +
 * arity, kebab-strict reason tokens), render, the injective subject-segment
 * encode/decode, `{principal}/{stack}` stack-id parse (NEVER fabricating a
 * `default`), the class registry, the resolution-plane rule (self-asserted
 * classes are non-resolvable), and the agent-prefix anti-impersonation binding.
 *
 * Pattern generalized from cortex `feat/wp2-wire-identity-codec`
 * (`src/common/wire/identity.ts`) INTO myelin — the WP-2 branch was "the right
 * shape in the wrong repo" (design-rfc-alignment.md D5). The WP-2 codec reported
 * `"ambiguous"` because the pre-cut flat grammar could not classify a DID; the
 * class-explicit dot-form ratified in RFC-0001 §6.2 closes that — the class tag
 * at method-specific-id position 0 recovers the class unambiguously. The grammar
 * terminals are CONSUMED from the abnf-gen output (`generated/r/identifiers`,
 * myelin#237/#280), never re-hand-written.
 *
 * Fail loud, never fabricate: parse constructors return a discriminated
 * {@link ParseResult} carrying a stable reason token; they never throw and never
 * invent a `default`.
 */

import {
  CLASS_TAG_VALUES,
  SEGMENT_MAX_LEN,
  PRINCIPAL_ID_RE,
  STACK_SLUG_RE,
  type ClassTag,
} from "./generated/r/identifiers";

// ---------------------------------------------------------------------------
// Branded types — nominal typing, zero runtime cost (lifted from WP-2)
// ---------------------------------------------------------------------------

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

/** A principal's id — the human/org authority. e.g. `"andreas"`. */
export type PrincipalId = Brand<string, "PrincipalId">;
/** The trailing segment of a stack id. e.g. `"meta-factory"`. */
export type StackSlug = Brand<string, "StackSlug">;

/** The DID method prefix. */
export const DID_PREFIX = "did:mf:";

/** The six ratified identity classes (RFC-0001 §7 registry), from the generator. */
export const CLASS_TAGS: readonly ClassTag[] = CLASS_TAG_VALUES;

/**
 * Names reserved in the §7 registry that MUST NOT be minted as class tags
 * (D7). `wallet` is an RFC-0009 ROLE over any DID, not a class; `public` is a
 * reserved principal NAME (see `did:mf:principal.public`), never a tag. They are
 * rejected by the same fail-closed unregistered-tag rule as any unknown tag —
 * this set exists for callers that want to explain *why* a name is not a tag.
 */
export const RESERVED_NAMES: readonly string[] = ["wallet", "public"];

/** The resolution plane of a class. */
export type ResolutionPlane = "keyed" | "self-asserted";

/**
 * `keyed` classes carry an Ed25519 key and resolve in the identity registry;
 * `self-asserted` classes (surface, system) have no key, appear in `originator`
 * only, and are explicitly NON-resolvable (D14 — resolving one is the
 * unknown_agent bug class).
 */
export function resolvePlane(cls: ClassTag): ResolutionPlane {
  return cls === "surface" || cls === "system" ? "self-asserted" : "keyed";
}

/** Number of msi segments after the class tag, per class (RFC-0001 §6.2 arity). */
const CLASS_ARITY: Record<ClassTag, number> = {
  principal: 1,
  stack: 2,
  agent: 3,
  hub: 1,
  surface: 1,
  system: 1,
};

// ---------------------------------------------------------------------------
// Result type — fail loud, never throw, never default
// ---------------------------------------------------------------------------

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

const ok = <T>(value: T): ParseResult<T> => ({ ok: true, value });
const err = <T>(reason: string): ParseResult<T> => ({ ok: false, reason });

/** A parsed class-explicit DID. `segments` are the msi segments after the tag. */
export interface ParsedDid {
  cls: ClassTag;
  segments: string[];
}

// ---------------------------------------------------------------------------
// Segment validation — kebab-strict, one reason token per failure mode
// ---------------------------------------------------------------------------

/**
 * Validate ONE msi segment against the kebab-strict `segment` production and
 * return a stable RFC-0001 reason token for the first failure. Order is
 * load-bearing: it is the precedence the identifiers reject vectors assert.
 */
export function segmentError(s: string): string | null {
  if (s.length === 0) return "empty-segment";
  if (s.includes("_")) return "underscore-forbidden";
  if (/[A-Z]/.test(s)) return "uppercase-forbidden";
  if (!/^[a-z]/.test(s)) return "segment-must-start-with-letter";
  if (s.includes("--")) return "consecutive-hyphens-forbidden";
  if (s.endsWith("-")) return "trailing-hyphen-forbidden";
  if (s.length > SEGMENT_MAX_LEN) return "segment-length-exceeds-63";
  // Anything else that is not a clean kebab segment (e.g. stray punctuation the
  // charset rules above did not name) fails closed here.
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(s)) return "malformed-segment";
  return null;
}

function isClassTag(tag: string): tag is ClassTag {
  return (CLASS_TAGS as readonly string[]).includes(tag);
}

// ---------------------------------------------------------------------------
// parseDid — fail-closed, class + arity, kebab-strict
// ---------------------------------------------------------------------------

/**
 * Parse a class-explicit `did:mf:{tag}.{seg}[.{seg}...]` DID.
 *
 * Fail-closed with a stable reason token (RFC-0001 identifiers reject vectors):
 * DID-URL syntax on the wire, unregistered tag, class/arity mismatch, and every
 * kebab-strict segment violation. A well-formed DID returns its class + segments;
 * `class`/`parts` on the accept vectors are not compared by the runner, but the
 * structured return is the codec's real contract for callers.
 */
export function parseDid(input: string): ParseResult<ParsedDid> {
  if (typeof input !== "string" || !input.startsWith(DID_PREFIX)) {
    return err("malformed-did");
  }
  const body = input.slice(DID_PREFIX.length);

  // D15: a DID appears BARE at every wire position — no DID-URL path/query/
  // fragment. These characters cannot occur in any segment, so detect them
  // before segment parsing so the reason is the DID-URL rule, not a charset one.
  if (/[#?/]/.test(body)) return err("did-url-forbidden-on-wire");

  const tokens = body.split(".");
  const tag = tokens[0] ?? "";

  // Class tag governance (D8): CLOSED registry, fail-closed on any unregistered
  // tag. A classless flat DID (no `.`) lands here too — its whole msi is the
  // position-0 token and is not a registered tag.
  if (!isClassTag(tag)) return err("unregistered-class-tag");

  const segments = tokens.slice(1);

  // Segment-level faults take precedence over arity (an empty middle segment is
  // an empty-segment fault, not an arity miscount).
  for (const seg of segments) {
    const e = segmentError(seg);
    if (e) return err(e);
  }

  if (segments.length !== CLASS_ARITY[tag]) return err("class-arity-mismatch");

  return ok({ cls: tag, segments });
}

/** Structured convenience view of a parsed DID (named msi parts by class). */
export function didParts(parsed: ParsedDid): Record<string, string> {
  const [a = "", b = "", c = ""] = parsed.segments;
  switch (parsed.cls) {
    case "principal":
      return { principal: a };
    case "stack":
      return { principal: a, stack: b };
    case "agent":
      return { principal: a, stack: b, assistant: c };
    case "hub":
      return { network: a };
    case "surface":
    case "system":
      return { name: a };
  }
}

/** Render a class-explicit DID from a class tag + msi segments (fail-closed). */
export function renderDid(cls: ClassTag, ...segments: string[]): ParseResult<string> {
  if (segments.length !== CLASS_ARITY[cls]) return err("class-arity-mismatch");
  for (const seg of segments) {
    const e = segmentError(seg);
    if (e) return err(e);
  }
  return ok(`${DID_PREFIX}${cls}.${segments.join(".")}`);
}

/** Recover the class of a well-formed DID, or `null`. */
export function classOf(did: string): ClassTag | null {
  const r = parseDid(did);
  return r.ok ? r.value.cls : null;
}

// ---------------------------------------------------------------------------
// Subject-segment codec — injective ':'→'-', '.'→'--'
// ---------------------------------------------------------------------------

/**
 * Encode a class-explicit DID into its `@did-mf-...` subject segment: `:`→`-`,
 * `.`→`--`, interior single `-` preserved. Injective under kebab-strict (no
 * segment-edge `-`, so a `--` run can only come from a `.`). Fail-closed: only a
 * well-formed DID may be encoded.
 */
export function encodeDidSegment(did: string): ParseResult<string> {
  const r = parseDid(did);
  if (!r.ok) return r;
  return ok(`@${did.replace(/:/g, "-").replace(/\./g, "--")}`);
}

/**
 * Decode an `@did-mf-...` subject segment back to its DID. Split the encoded msi
 * on `--` (the sole `.`-image); a single `-` inside a segment is NOT a
 * separator, so the decode is total and injective on this language (D13). This
 * is the normative decoder that retires cortex's first-hyphen guesser.
 */
export function decodeDidSegment(input: string): ParseResult<string> {
  const PREFIX = "@did-mf-";
  if (typeof input !== "string" || !input.startsWith(PREFIX)) {
    return err("not-a-did-subject-segment");
  }
  const encodedMsi = input.slice(PREFIX.length);
  const parts = encodedMsi.split("--");
  const did = `${DID_PREFIX}${parts.join(".")}`;
  // Round-trip through the parser so a malformed encoded form fails closed
  // rather than decoding to an invalid DID.
  const r = parseDid(did);
  if (!r.ok) return err(`decoded-did-invalid:${r.reason}`);
  return ok(did);
}

// ---------------------------------------------------------------------------
// stack-id — `{principal}/{stack}`, NEVER fabricates `default` (cortex#1812)
// ---------------------------------------------------------------------------

export interface StackScope {
  principal: PrincipalId;
  stack: StackSlug;
}

/**
 * Parse a `{principal}/{stack}` config/registry stack-id into its two halves.
 * Requires EXACTLY one `/`; never fabricates a `default`. A stack literally
 * named `default` is legal (it is a real slug, not the fabricated sentinel).
 */
export function parseStackId(input: string): ParseResult<StackScope> {
  if (typeof input !== "string" || input.length === 0) return err("empty-stack-id");
  const parts = input.split("/");
  if (parts.length !== 2) return err("missing-separator");
  const [rawPrincipal, rawStack] = parts;
  if (!PRINCIPAL_ID_RE.test(rawPrincipal ?? "")) return err("invalid-principal");
  if (!STACK_SLUG_RE.test(rawStack ?? "")) return err("invalid-stack-slug");
  return ok({ principal: rawPrincipal as PrincipalId, stack: rawStack as StackSlug });
}

// ---------------------------------------------------------------------------
// Resolution plane + agent-prefix binding
// ---------------------------------------------------------------------------

/**
 * The resolution rule: a self-asserted DID (surface/system) MUST NOT be resolved
 * in the keyed registry (D14). `registry` maps a resolvable DID → its record;
 * keyed classes fall through to it. Only the self-asserted refusal is exercised
 * by the conformance vectors.
 */
export function resolveDid<R>(
  did: string,
  registry: ReadonlyMap<string, R> = new Map(),
): ParseResult<R> {
  const parsed = parseDid(did);
  if (!parsed.ok) return parsed;
  if (resolvePlane(parsed.value.cls) === "self-asserted") {
    return err("self-asserted-class-non-resolvable");
  }
  const rec = registry.get(did);
  if (rec === undefined) return err("unknown-did");
  return ok(rec);
}

/**
 * Anti-impersonation binding (RFC-0001 §7.1): an agent originator's
 * `{principal}.{stack}` prefix MUST equal the innermost signing stack's msi
 * tail. Both DIDs are parsed fail-closed; the binding is checked against the
 * signature chain, never against the originator's self-description.
 */
export function checkAgentPrefixBinding(
  originator: string,
  signingStack: string,
): ParseResult<ParsedDid> {
  const o = parseDid(originator);
  if (!o.ok) return err(`originator-${o.reason}`);
  if (o.value.cls !== "agent") return err("originator-not-agent-class");
  const s = parseDid(signingStack);
  if (!s.ok) return err(`signing-stack-${s.reason}`);
  if (s.value.cls !== "stack") return err("signing-stack-not-stack-class");
  const [oPrincipal = "", oStack = ""] = o.value.segments;
  const [sPrincipal = "", sStack = ""] = s.value.segments;
  if (oPrincipal !== sPrincipal || oStack !== sStack) {
    return err("agent-prefix-binding-violation");
  }
  return ok(o.value);
}
