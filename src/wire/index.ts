/**
 * `./wire` — the shared wire library (myelin#238).
 *
 * The single home for every wire rule: identity/subject codec, the RFC-0004
 * canonicalizer + Ed25519 signer/verifier, the transport/refusal token enums,
 * the admission surface, and the sovereignty reference procedures. Built once
 * here (design-rfc-alignment.md D5); consumers import it at a git tag pin and
 * delete their hand-rolled copies (D4/W5).
 *
 * Grammar terminals are consumed from the abnf-gen output under
 * `./generated/r` (myelin#237/#280) — never re-hand-written.
 */

export * as identity from "./identity";
export * as subjects from "./subjects";
export * as canonicalize from "./canonicalize";
export * as envelope from "./envelope";
export * as generated from "./generated/r";
