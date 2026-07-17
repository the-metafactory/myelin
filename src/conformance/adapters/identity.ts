import { encodeDidSegment } from "../../subjects";
import { DID_RE } from "../../identity/types";
import { NotImplemented, type Adapter, type VectorResult } from "../types";

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
 *  - `DID_RE` (identity/types.ts:1) — the pre-cut FLAT DID grammar, the only
 *    DID acceptor on main. It is used here as the `parseDid` backing.
 *
 * What is spec-ahead-of-code, all landing with the ./wire codec (myelin#238;
 * design §2 "MISSING: decodeDidSegment, fail-closed parseDid, … agent-prefix
 * binding" and the W4 export surface): `decodeDidSegment`, `parseStackId`,
 * `resolvePlane`/self-asserted refusal (the `resolveDid` rule), and
 * `checkAgentPrefixBinding` (the `agentOriginatorBinding` rule).
 */

export const identityAdapters: Record<string, Adapter> = {
  // parseDid → the pre-cut flat grammar DID_RE, the only DID acceptor on main.
  // RFC-0001's fail-closed, class-aware parseDid (class+arity recovery,
  // kebab-strict per-segment validators, CLASS_TAGS/RESERVED_NAMES registry,
  // DID-URL rejection) is unbuilt (#238). DID_RE is a bare regex with no reason
  // taxonomy, so a reject yields `false` with no token. The runner compares
  // only ok/value/reason — expect.class/expect.parts on the valid vectors are
  // NOT compared — so a well-formed class-explicit DID that is ALSO legal
  // pre-cut passes on ok alone. Every invalid vector then diverges one of two
  // honest ways, all manifested → #238:
  //   (a) reason-token gap — DID_RE correctly rejects (uppercase, `--`, and the
  //       DID-URL fragment/path/query) but emits no token (want a specific
  //       reason, got undefined); or
  //   (b) semantic divergence — the pre-cut grammar ACCEPTS (ok:true) what
  //       RFC-0001 rejects: trailing hyphen, `_`, leading digit, empty and
  //       over-63 segments, the classless/unknown/reserved-name tag, and both
  //       class-arity mismatches.
  parseDid: (input): VectorResult => {
    const did = input as string;
    return DID_RE.test(did) ? { ok: true } : { ok: false };
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
  decodeDidSegment: () => {
    throw new NotImplemented("decodeDidSegment", "myelin#238");
  },

  // parseStackId → no stack-id parser exists in myelin. The `{principal}/{stack}`
  // config/registry form (with NO `default` fabrication, cortex#1812 root cause)
  // is a ./wire export (#238; W4 surface: "parseStackId (no default
  // fabrication)"). cortex's slug regexes are slated for deletion, not lift.
  parseStackId: () => {
    throw new NotImplemented("parseStackId", "myelin#238");
  },

  // resolveDid → identity/registry.ts `resolve()` is a bare map lookup
  // (Identity|null) with no reason and no resolution-plane rule. The
  // self-asserted-class refusal (surface/system are originator-only and
  // explicitly NON-resolvable) is `resolvePlane`, an unbuilt ./wire export
  // (#238). Mapping to an empty-registry lookup would return ok:false for the
  // WRONG reason (not-in-map, not the self-asserted rule), so this is honestly
  // unimplemented rather than mapped to a coincidental verdict.
  resolveDid: () => {
    throw new NotImplemented("resolveDid", "myelin#238");
  },

  // agentOriginatorBinding → the agent-prefix anti-impersonation invariant (the
  // originator agent DID's {principal}.{stack} prefix MUST equal the innermost
  // signing stack's msi tail) has no checker on main. It is
  // `checkAgentPrefixBinding` / the §7.1 originator binding, an unbuilt ./wire
  // export (#238; design §2 "MISSING: … agent-prefix binding"). did-class.ts
  // exposes only `principalComponentOf`, which extracts the principal segment
  // but performs no cross-DID binding comparison.
  agentOriginatorBinding: () => {
    throw new NotImplemented("agentOriginatorBinding", "myelin#238");
  },
};
