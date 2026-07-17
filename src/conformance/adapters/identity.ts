import { encodeDidSegment } from "../../subjects";
import {
  parseDid,
  decodeDidSegment,
  parseStackId,
  resolveDid,
  checkAgentPrefixBinding,
} from "../../wire/identity";
import { type Adapter, type VectorResult } from "../types";

/**
 * Identity + subject-namespace DID adapters (RFC-0001 / RFC-0002).
 *
 * Runner-first (D3): every kind is wired to TODAY's hand-written impl where one
 * exists, so the class-explicit-grammar gap surfaces as failing/expected-fail
 * vectors rather than being hidden. The RFC-0001 §9 flag-day-R cut has NOT
 * fired — main is still pre-R (see `docs/design-rfc-alignment.md` §2: the
 * identity/subjects row is "All pre-R").
 *
 * What is built on main:
 *  - `encodeDidSegment` (subjects.ts:124) — the reversible `:`→`-`, `.`→`--`
 *    subject codec. RFC-conformant and injective under the DID_RE `--` ban;
 *    every encode vector (incl. the era:pre-R byte-pins) passes today.
 *  - `parseDid` (wire/identity.ts:139) — the class-explicit, fail-closed DID
 *    parser (closed class-tag registry, per-class arity, kebab-strict segments,
 *    DID-URL rejection), landed with the ./wire codec (myelin#238). It backs
 *    `parseDid` here, replacing the pre-cut flat `DID_RE`.
 *
 * What is spec-ahead-of-code, all landing with the ./wire codec (myelin#238;
 * design §2 "MISSING: decodeDidSegment, … agent-prefix binding" and the W4
 * export surface): `decodeDidSegment`, `parseStackId`,
 * `resolvePlane`/self-asserted refusal (the `resolveDid` rule), and
 * `checkAgentPrefixBinding` (the `agentOriginatorBinding` rule).
 */

export const identityAdapters: Record<string, Adapter> = {
  // parseDid → the class-explicit, fail-closed ./wire parser (wire/identity.ts):
  // the closed CLASS_TAGS registry + per-class arity, kebab-strict per-segment
  // validators, and DID-URL (path/query/fragment) rejection landed with the
  // ./wire codec (#238). A reject yields a stable RFC-0001 reason token, so every
  // invalid vector asserts its token directly and none is manifested. The runner
  // compares only ok/value/reason — expect.class/expect.parts on the accept
  // vectors are NOT compared — so a well-formed class-explicit DID passes on ok.
  parseDid: (input): VectorResult => {
    const r = parseDid(input as string);
    // The runner compares only ok/value/reason; the accept vectors carry
    // class/parts at expect top level (NOT expect.value), so ok alone suffices
    // on accept, and the fail-closed reason token is asserted on reject.
    return r.ok ? { ok: true } : { ok: false, reason: r.reason };
  },

  // encodeDidSegment → built and conformant on main (subjects.ts:124). Throws
  // on a non-DID_RE input; the runner turns any throw into a mismatch, but no
  // encode vector exercises that path (all inputs are well-formed pre-cut DIDs).
  encodeDidSegment: (input): VectorResult => {
    return { ok: true, value: encodeDidSegment(input as string) };
  },

  // decodeDidSegment → no decoder on main. cortex's first-hyphen decoder
  // (review-consumer.ts:1454) is slated for DELETION, not lift; the normative,
  // injective decoder is a ./wire export (#238; design §2 "MISSING:
  // decodeDidSegment").
  decodeDidSegment: (input): VectorResult => {
    const r = decodeDidSegment(input as string);
    return r.ok ? { ok: true, value: r.value } : { ok: false, reason: r.reason };
  },

  // parseStackId → no stack-id parser exists in myelin. The `{principal}/{stack}`
  // config/registry form (with NO `default` fabrication, cortex#1812 root cause)
  // is a ./wire export (#238; W4 surface: "parseStackId (no default
  // fabrication)"). cortex's slug regexes are slated for deletion, not lift.
  parseStackId: (input): VectorResult => {
    const r = parseStackId(input as string);
    // Accept vectors carry `parts` at expect top level (not expect.value).
    return r.ok ? { ok: true } : { ok: false, reason: r.reason };
  },

  // resolveDid → identity/registry.ts `resolve()` is a bare map lookup
  // (Identity|null) with no reason and no resolution-plane rule. The
  // self-asserted-class refusal (surface/system are originator-only and
  // explicitly NON-resolvable) is `resolvePlane`, an unbuilt ./wire export
  // (#238). Mapping to an empty-registry lookup would return ok:false for the
  // WRONG reason (not-in-map, not the self-asserted rule), so this is honestly
  // unimplemented rather than mapped to a coincidental verdict.
  resolveDid: (input): VectorResult => {
    const r = resolveDid(input as string);
    return r.ok ? { ok: true } : { ok: false, reason: r.reason };
  },

  // agentOriginatorBinding → the agent-prefix anti-impersonation invariant (the
  // originator agent DID's {principal}.{stack} prefix MUST equal the innermost
  // signing stack's msi tail) has no checker on main. It is
  // `checkAgentPrefixBinding` / the §7.1 originator binding, an unbuilt ./wire
  // export (#238; design §2 "MISSING: … agent-prefix binding"). did-class.ts
  // exposes only `principalComponentOf`, which extracts the principal segment
  // but performs no cross-DID binding comparison.
  agentOriginatorBinding: (input): VectorResult => {
    const i = (input ?? {}) as { originator?: string; signing_stack?: string };
    const r = checkAgentPrefixBinding(i.originator ?? "", i.signing_stack ?? "");
    // Accept vectors carry class/parts at expect top level (not expect.value).
    return r.ok ? { ok: true } : { ok: false, reason: r.reason };
  },
};
