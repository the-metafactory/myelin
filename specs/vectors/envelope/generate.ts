#!/usr/bin/env bun
// specs/vectors/envelope/generate.ts
//
// RFC-0003 (Envelope Format) — committed vector GENERATOR (grill rfc-0003.md,
// D22-D26, ratified Andreas 2026-07-14). Emits the two conformance oracles:
//   valid.json    — inputs that MUST validate / resolve (accept oracle)
//   invalid.json  — inputs that MUST be rejected, with a stable reason token
//                   (the accept-only suite gained its reject oracle, D22)
//
// SELF-CONTAINED by design (independent-impl grade): this file imports ONLY
// node stdlib. It does NOT import the myelin reference. A second implementation
// reproduces every byte below from the RFC prose + ABNF alone.
//
// WHY A GENERATOR: the D11 whole-envelope 1 MiB (1,048,576-octet) receive bound
// needs a reject vector whose serialized size EXCEEDS the bound — a >1 MiB
// input. Rather than hand-commit a megabyte literal, the oversize vector's pad
// is built programmatically here; every other vector is plain data below.
//
// PUBLIC-SAFETY (public repo, blocking gate): NO 17-20 consecutive-digit runs,
// no real secrets. UUIDs are 8-4-4-4-12 hex with letters breaking every digit
// run (max run 12 < 17). Signatures are all-'A' base64 sentinels (no digits).
// The oversize pad is repeated 'a' (no digits). Identities are fake fixtures.
//
// Run:  bun specs/vectors/envelope/generate.ts

import { writeFileSync } from "node:fs";
import { join } from "node:path";

const HERE = new URL(".", import.meta.url).pathname;

// ── shared sentinels ────────────────────────────────────────────────────────
// An 88-char RFC-0004-CANONICAL base64 signature: 85 base64 chars + a
// final-quantum-2bit char (∈ {A,Q,g,w}) + "==" (envelope-signing.abnf
// `signature`). "A"×85 + "A" + "==" is the canonical base64 of a 64-byte
// all-zero Ed25519 signature. Valid under BOTH RFC-0003's loose accept-grammar
// (base64-signature, minLength 88) AND RFC-0004's exactly-88 canonical form —
// strictly better than the former unpadded "A"×88, which had no "==" and flips
// to reject at flag-day R (#236 item 9, audit D9). Still all-'A' + '=' (no
// digit runs; public-safety gate holds).
const SIG88 = "A".repeat(85) + "A==";
const SIG_SHORT = "A".repeat(40); // < 88 → schema minLength reject

// Fake identity fixtures (class-explicit dot-form, RFC-0001 §6.2). Never real.
const SRC_PILOT = "did:mf:agent.metafactory.pilot.local"; // agent-class source
const SRC_LUNA = "did:mf:agent.metafactory.security.luna";
const SRC_DISPATCH = "did:mf:agent.metafactory.cortex.dispatch";
const SRC_PROD = "did:mf:agent.acme.monitor.prod-01"; // hyphenated assistant seg
const SIGNER_SECURITY = "did:mf:stack.metafactory.security"; // keyed stack signer
const SIGNER_CORTEX = "did:mf:stack.metafactory.cortex";
const HUB = "did:mf:hub.metafactory-net"; // keyed hub (hub-msi = hub.{network-id})
const SURFACE = "did:mf:surface.discord"; // self-asserted; originator-only
const SYSTEM = "did:mf:system.reflex"; // self-asserted; originator-only
const TARGET_AGENT = "did:mf:agent.metafactory.cortex.luna"; // agent-class target
const WALLET_ANYCLASS = "did:mf:principal.andreas"; // wallet = role over ANY class

const TS = "2026-05-11T14:33:00Z";

type Vector = {
  id: string;
  rfc: 3;
  kind: "validateEnvelope" | "getActorIdentity";
  input: unknown;
  expect: Record<string, unknown>;
  why: string;
};

// A well-formed minimal-required LOCAL envelope; reject vectors clone + break it.
function base(): Record<string, unknown> {
  return {
    id: "550e8400-e29b-41d4-a716-4466ce440010",
    source: SRC_PILOT,
    type: "code.pr.review",
    timestamp: TS,
    sovereignty: {
      classification: "local",
      data_residency: "CH",
      max_hop: 0,
      frontier_ok: false,
      model_class: "local-only",
    },
    payload: { pr: 50 },
  };
}
const clone = (o: unknown) => JSON.parse(JSON.stringify(o));
const edStamp = (identity: string, role = "origin") => ({
  method: "ed25519",
  identity,
  signature: SIG88,
  at: TS,
  role,
});

// ─────────────────────────────────────────────────────────────────────────────
// VALID (accept oracle) — DID epoch rewrite (D23): source is a FULL agent DID,
// every DID-valued field is class-explicit dot-form. Two-plane ACCEPT pair
// (surface + system in originator) per D24.
// ─────────────────────────────────────────────────────────────────────────────
const valid: Vector[] = [
  {
    id: "envelope/minimal-required",
    rfc: 3,
    kind: "validateEnvelope",
    input: base(),
    expect: { ok: true, value: { classification: "local" } },
    why: "Happy path: the six REQUIRED fields (id/source/type/timestamp/sovereignty/payload) and nothing else, with `source` as a FULL class-explicit agent DID (D16). The baseline every conformant reader MUST accept.",
  },
  {
    id: "envelope/federated-signed-ed25519",
    rfc: 3,
    kind: "validateEnvelope",
    input: {
      id: "550e8400-e29b-41d4-a716-4466ce440001",
      source: SRC_LUNA,
      type: "code.pr.review",
      timestamp: TS,
      sovereignty: { classification: "federated", data_residency: "CH", max_hop: 2, frontier_ok: false, model_class: "local-only" },
      payload: { pr: 50 },
      signed_by: [edStamp(SIGNER_SECURITY, "origin")],
    },
    expect: { ok: true, value: { classification: "federated" } },
    why: "A federated envelope with a single ed25519 origin stamp validates. The origin signer is the KEYED stack DID did:mf:stack.metafactory.security, whose {principal}.{stack} tail reconciles with the source agent DID's (D17 provenance binding). Pins the stamp SHAPE (method/identity/signature>=88/at/role); signing bytes are RFC-0004's.",
  },
  {
    id: "envelope/hub-stamp-variant",
    rfc: 3,
    kind: "validateEnvelope",
    input: {
      id: "550e8400-e29b-41d4-a716-4466ce440002",
      source: SRC_LUNA,
      type: "code.pr.review",
      timestamp: TS,
      sovereignty: { classification: "federated", data_residency: "CH", max_hop: 2, frontier_ok: false, model_class: "any" },
      payload: { pr: 50 },
      signed_by: [
        edStamp(SIGNER_SECURITY, "origin"),
        { method: "hub-stamp", identity: SIGNER_SECURITY, stamped_by: HUB, signature: SIG88, at: "2026-05-11T14:34:00Z", role: "transit" },
      ],
    },
    expect: { ok: true, value: { classification: "federated" } },
    why: "The hub-stamp method carries the extra REQUIRED stamped_by DID — a KEYED hub-class DID (D21: stamped_by ∈ {hub,stack}). Pins the second signed_by branch and a 2-stamp chain.",
  },
  {
    id: "envelope/source-masking-prod-01",
    rfc: 3,
    kind: "validateEnvelope",
    input: { ...base(), id: "550e8400-e29b-41d4-a716-4466ce440003", source: SRC_PROD, type: "ops.deploy.completed", sovereignty: { classification: "local", data_residency: "US", max_hop: 0, frontier_ok: false, model_class: "local-only" }, payload: { job: "deploy" } },
    expect: { ok: true, value: { classification: "local" } },
    why: "A legacy `acme.monitor.prod-01` 3-token address maps cleanly to the agent DID did:mf:agent.acme.monitor.prod-01. Guards that a kebab-strict assistant segment with a SINGLE interior hyphen (`prod-01` — no leading/trailing/consecutive '-') validates. (Pre-R this vector masked the stale {2,4}-segment source prose; under D16 the source is a full DID.)",
  },
  {
    id: "envelope/spec-version-current",
    rfc: 3,
    kind: "validateEnvelope",
    input: { ...base(), id: "550e8400-e29b-41d4-a716-4466ce440004", spec_version: 3 },
    expect: { ok: true, value: { classification: "local" } },
    why: "spec_version is an OPTIONAL, SIGNABLE integer (field-id 14, RFC-0004 §4.1); 3 is the current grammar. Present-and-current MUST validate.",
  },
  {
    id: "envelope/spec-version-newer-accepted",
    rfc: 3,
    kind: "validateEnvelope",
    input: { ...base(), id: "550e8400-e29b-41d4-a716-4466ce440005", spec_version: 4 },
    expect: { ok: true, value: { classification: "local" } },
    why: "WARN-ON-NEWER: a verifier MUST NOT reject solely because spec_version exceeds the version it knows (it SHOULD warn). A newer spec_version is NOT blanket forward-compatibility — unknown top-level keys still reject (additionalProperties:false is PERMANENT, D2). Scheduling of emission is BCP-0001's.",
  },
  {
    id: "envelope/direct-with-target",
    rfc: 3,
    kind: "validateEnvelope",
    input: { ...base(), id: "550e8400-e29b-41d4-a716-4466ce440006", source: SRC_DISPATCH, distribution_mode: "direct", target_assistant: TARGET_AGENT },
    expect: { ok: true, value: { classification: "local" } },
    why: "The cross-field rule (distribution_mode ∈ {direct,delegate} ⇒ target_assistant REQUIRED) is satisfied, and target_assistant is an AGENT-class DID (D20: agent-class only). Pins the allOf conditional and the D20 class constraint together.",
  },
  {
    id: "envelope/mutable-channels-present",
    rfc: 3,
    kind: "validateEnvelope",
    input: {
      id: "550e8400-e29b-41d4-a716-4466ce440007",
      source: SRC_LUNA,
      type: "code.pr.review",
      timestamp: TS,
      sovereignty: { classification: "federated", data_residency: "CH", max_hop: 2, frontier_ok: false, model_class: "local-only" },
      economics: { actual: { input_tokens: 10, arbitrary_hub_annotation: "anything" }, billing_ref: "INV-2026-0001" },
      extensions: { trace_id: "abc", whatever: { deep: [1, 2, 3] } },
      payload: { pr: 50 },
    },
    expect: { ok: true, value: { classification: "federated" } },
    why: "economics and extensions are the ONLY open islands (additionalProperties:true; D2/D14 keep every other object closed) — UNSIGNED, MUTABLE channels. Arbitrary unknown content validates. Receive-side UTF-8 byte caps (D13) bound them at the trust boundary; the only integrity control is the prose rule that clients MUST NOT trust mutable values.",
  },
  {
    id: "envelope/economics-wallet-role-anyclass",
    rfc: 3,
    kind: "validateEnvelope",
    input: {
      id: "550e8400-e29b-41d4-a716-4466ce440008",
      source: SRC_LUNA,
      type: "code.pr.review",
      timestamp: TS,
      sovereignty: { classification: "federated", data_residency: "CH", max_hop: 2, frontier_ok: false, model_class: "local-only" },
      economics: { wallet: WALLET_ANYCLASS, currency: "USD" },
      payload: { pr: 50 },
    },
    expect: { ok: true, value: { classification: "federated" } },
    why: "D21: economics.wallet is a ROLE over a DID of ANY class (a principal-class DID here), not an identity class of its own. Pins that a non-agent keyed class is accepted in the wallet role, on the mutable economics channel.",
  },
  {
    id: "envelope/residency-unassigned-code",
    rfc: 3,
    kind: "validateEnvelope",
    input: { ...base(), id: "550e8400-e29b-41d4-a716-4466ce440009", source: SRC_LUNA, sovereignty: { classification: "federated", data_residency: "XX", max_hop: 2, frontier_ok: false, model_class: "local-only" } },
    expect: { ok: true, value: { classification: "federated" } },
    why: "data_residency is validated only as ^[A-Z]{2}$; the ISO 3166-1 REGISTRY is NOT enforced, so the ISO-unassigned code `XX` validates on a sovereignty-bearing routing input. What a sovereignty engine does with an unassigned/regional code is undefined (owned by RFC-0005 §2.3).",
  },
  {
    id: "envelope/originator-adapter-resolved",
    rfc: 3,
    kind: "validateEnvelope",
    input: {
      id: "550e8400-e29b-41d4-a716-4466ce44000b",
      source: SRC_DISPATCH,
      type: "code.pr.review",
      timestamp: TS,
      sovereignty: { classification: "local", data_residency: "CH", max_hop: 0, frontier_ok: false, model_class: "local-only" },
      originator: { identity: SURFACE, attribution: "adapter-resolved" },
      extensions: { surface_user: "u-a1f4c2e9" },
      signed_by: [edStamp(SIGNER_CORTEX, "origin")],
      payload: { pr: 50 },
    },
    expect: { ok: true, value: { classification: "local" } },
    why: "TWO-PLANE ACCEPT (surface half, D24): a self-asserted SURFACE-class DID is legal in originator (the ONE position it may appear). D19: an adapter-resolved human is attributed via the surface DID plus the surface's OPAQUE STABLE user-id as surface-asserted metadata in the mutable extensions channel — NOT an email, NO new human class in v1. The signer (did:mf:stack.metafactory.cortex) differs from the actor.",
  },
  {
    id: "envelope/originator-system-class",
    rfc: 3,
    kind: "validateEnvelope",
    input: {
      id: "550e8400-e29b-41d4-a716-4466ce44001a",
      source: SRC_DISPATCH,
      type: "reflex.tick.emitted",
      timestamp: TS,
      sovereignty: { classification: "local", data_residency: "CH", max_hop: 0, frontier_ok: false, model_class: "local-only" },
      originator: { identity: SYSTEM, attribution: "delegated" },
      signed_by: [edStamp(SIGNER_CORTEX, "origin")],
      payload: { tick: 1 },
    },
    expect: { ok: true, value: { classification: "local" } },
    why: "TWO-PLANE ACCEPT (system half, D24): a self-asserted SYSTEM-class DID (internal non-keyed originator, e.g. reflex) is also legal in originator ONLY. Completes the accept pair whose reject half is envelope/signed-by-surface-identity.",
  },
  {
    id: "actor/originator-wins",
    rfc: 3,
    kind: "getActorIdentity",
    input: {
      id: "550e8400-e29b-41d4-a716-4466ce44000c",
      source: SRC_DISPATCH,
      type: "code.pr.review",
      timestamp: TS,
      sovereignty: { classification: "local", data_residency: "CH", max_hop: 0, frontier_ok: false, model_class: "local-only" },
      originator: { identity: SURFACE, attribution: "adapter-resolved" },
      signed_by: [edStamp(SIGNER_CORTEX, "origin")],
      payload: { pr: 50 },
    },
    expect: { ok: true, value: { actor: SURFACE } },
    why: "Actor resolution (§7 step 1): when originator is present, its identity wins over the signing chain. The signer (did:mf:stack.metafactory.cortex) is NOT the actor; the surface DID is.",
  },
  {
    id: "actor/chain-fallback",
    rfc: 3,
    kind: "getActorIdentity",
    input: {
      id: "550e8400-e29b-41d4-a716-4466ce44000d",
      source: SRC_LUNA,
      type: "code.pr.review",
      timestamp: TS,
      sovereignty: { classification: "local", data_residency: "CH", max_hop: 0, frontier_ok: false, model_class: "local-only" },
      signed_by: [edStamp(SIGNER_SECURITY, "origin")],
      payload: { pr: 50 },
    },
    expect: { ok: true, value: { actor: SIGNER_SECURITY } },
    why: "Actor resolution (§7 step 2): no originator ⇒ fall back to the FIRST stamp's identity (chain origin). signed_by is ARRAY-ONLY (D6), so the first element is unambiguous.",
  },
  {
    id: "actor/unsigned-none",
    rfc: 3,
    kind: "getActorIdentity",
    input: { ...base(), id: "550e8400-e29b-41d4-a716-4466ce44000f", source: SRC_LUNA },
    expect: { ok: true, value: { actor: null } },
    why: "Actor resolution (§7 step 3): an unsigned envelope with no originator has no actor. Returns null; a policy engine gets no attribution and MUST NOT fabricate one.",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// INVALID (reject oracle, D22). Whole-field-grammar completeness (D25), the
// two-plane REJECT half (D24), and the six task rejects (unknown-key, bad-uuid,
// non-calendar-datetime, surface-DID-in-signed_by, wrong-class target_assistant,
// over-1MiB). Two vectors MOVED here from the accept oracle because the grill
// RESOLVED their open decision (per RFC §12: a decision that changes a rule
// MOVES the vector between files — the id is kept, never renamed):
//   • envelope/timestamp-out-of-range-accepted  (D8 requires calendar validity)
//   • envelope/signed-by-shim-form               (D6 makes signed_by array-only)
// (The former actor/shim-form-documented vector is RETIRED with D6: the shim is
// rejected at validation, so getActorIdentity is never reached on it.)
// ─────────────────────────────────────────────────────────────────────────────
const invalid: Vector[] = [
  {
    id: "envelope/unknown-top-field",
    rfc: 3,
    kind: "validateEnvelope",
    input: { ...base(), foo: "bar" },
    expect: { ok: false, reason: "unknown-field" },
    why: "Closed contract (additionalProperties:false) is PERMANENT (D2): an unknown top-level key ALWAYS rejects. New metadata goes in `extensions` or a new schema-versioned field, never an ad-hoc key.",
  },
  {
    id: "envelope/sovereignty-extra-field",
    rfc: 3,
    kind: "validateEnvelope",
    input: { ...base(), sovereignty: { classification: "local", data_residency: "CH", max_hop: 0, frontier_ok: false, model_class: "local-only", region: "eu" } },
    expect: { ok: false, reason: "unknown-field-in-sovereignty" },
    why: "The sovereignty object is CLOSED (D2). An unknown sub-field (`region`) rejects — the envelope's passport block admits no undeclared keys.",
  },
  {
    id: "envelope/missing-source",
    rfc: 3,
    kind: "validateEnvelope",
    input: (() => { const e = base(); delete e.source; return e; })(),
    expect: { ok: false, reason: "missing-required-field" },
    why: "source is one of the six REQUIRED fields (§6). Absence rejects; there is no default source (the fabricated-default class, cortex#1812).",
  },
  {
    id: "envelope/payload-array",
    rfc: 3,
    kind: "validateEnvelope",
    input: { ...base(), payload: [1, 2, 3] },
    expect: { ok: false, reason: "payload-not-object" },
    why: "payload MUST be a JSON object (§3.6); the reference validator rejects arrays and null. An array payload rejects.",
  },
  {
    id: "envelope/id-not-uuid",
    rfc: 3,
    kind: "validateEnvelope",
    input: { ...base(), id: "not-a-uuid" },
    expect: { ok: false, reason: "id-not-uuid" },
    why: "id MUST match the 8-4-4-4-12 hex `uuid` grammar (§3.1). A non-hex, wrong-shape string rejects. D7 keeps the grammar version-AGNOSTIC but still requires the canonical shape.",
  },
  {
    id: "envelope/id-urn-prefix",
    rfc: 3,
    kind: "validateEnvelope",
    input: { ...base(), id: "urn:uuid:550e8400-e29b-41d4-a716-4466ce440011" },
    expect: { ok: false, reason: "id-urn-prefix-forbidden" },
    why: "D7: a `urn:uuid:` PREFIX is REJECTED — the `uuid` rule has no prefix production. cortex's ajv-formats currently ACCEPTS this prefix (a value valid at cortex, rejected here); the divergence is pinned and tightens onto this rule at flag-day R.",
  },
  {
    id: "envelope/timestamp-lowercase",
    rfc: 3,
    kind: "validateEnvelope",
    input: { ...base(), timestamp: "2026-05-11t14:33:00z" },
    expect: { ok: false, reason: "datetime-lowercase-designator" },
    why: "D8 STRICT RFC 3339: the `T` separator and `Z` zulu designator are UPPERCASE-ONLY (ABNF %s\"T\"/%s\"Z\"; the source regex has no /i). Lowercase `t`/`z` reject. cortex's ajv-formats is case-insensitive here — the pinned divergence.",
  },
  {
    id: "envelope/timestamp-out-of-range-accepted",
    rfc: 3,
    kind: "validateEnvelope",
    input: { ...base(), timestamp: "2026-02-30T25:99:99Z" },
    expect: { ok: false, reason: "datetime-not-calendar-valid" },
    why: "MOVED from the accept oracle by D8 (RFC §12: a resolved decision moves the vector, keeping its id). Strict RFC 3339 now REQUIRES a calendar-valid finite instant: month 02 has no day 30, and hour 25 / minute-second 99 are out of range. The myelin reference ISO8601_RE did no calendar check and once ACCEPTED this — that acceptance is retired.",
  },
  {
    id: "envelope/source-four-segments",
    rfc: 3,
    kind: "validateEnvelope",
    input: { ...base(), source: "did:mf:agent.acme.monitor.prod.extra" },
    expect: { ok: false, reason: "source-arity-mismatch" },
    why: "D16: source is a FULL agent DID (did:mf:agent.{principal}.{stack}.{assistant}) — agent-msi has EXACTLY three segments after the tag. A fourth segment rejects (arity mismatch). The pre-cut loose 4-5 segment `org.agent.instance` source is gone.",
  },
  {
    id: "envelope/source-not-agent-class",
    rfc: 3,
    kind: "validateEnvelope",
    input: { ...base(), source: "did:mf:principal.andreas" },
    expect: { ok: false, reason: "source-not-agent-class" },
    why: "D16: source is pinned to the AGENT class. A well-formed principal-class DID is still not a valid source — the origin address names the emitting assistant, not a bare principal.",
  },
  {
    id: "envelope/type-too-few-segments",
    rfc: 3,
    kind: "validateEnvelope",
    input: { ...base(), type: "code" },
    expect: { ok: false, reason: "type-segment-count" },
    why: "D10: `type` is 2-5 kebab-strict segments (domain.entity.action). A single segment rejects — the 2-5 count is envelope-law even though it imports RFC-0001's segment alphabet.",
  },
  {
    id: "envelope/signed-by-shim-form",
    rfc: 3,
    kind: "validateEnvelope",
    input: { ...base(), source: SRC_LUNA, signed_by: edStamp(SIGNER_SECURITY, "origin") },
    expect: { ok: false, reason: "signed-by-not-array" },
    why: "MOVED from the accept oracle by D6 (RFC §12). At flag-day R signed_by is ARRAY-ONLY; the pre-#31 single-object shim is retired and now rejects. This also removes the getActorIdentity shim-form defect at its root.",
  },
  {
    id: "envelope/signed-by-surface-identity",
    rfc: 3,
    kind: "validateEnvelope",
    input: { ...base(), source: SRC_LUNA, signed_by: [edStamp(SURFACE, "origin")] },
    expect: { ok: false, reason: "self-asserted-in-signed-by" },
    why: "TWO-PLANE REJECT (D15/D24): a SELF-ASSERTED-class DID (surface) holds no key and MUST NOT appear in signed_by[]. Enforced at both schema-pattern and verify time (RFC-0001 §2.1, cited by RFC-0004 §5). Reject half of the pair whose accepts are envelope/originator-adapter-resolved and envelope/originator-system-class.",
  },
  {
    id: "envelope/stamp-principal-key",
    rfc: 3,
    kind: "validateEnvelope",
    input: { ...base(), source: SRC_LUNA, signed_by: [{ method: "ed25519", identity: SIGNER_SECURITY, principal: SIGNER_SECURITY, signature: SIG88, at: TS, role: "origin" }] },
    expect: { ok: false, reason: "stamp-legacy-principal-key" },
    why: "A stamp MUST NOT carry the legacy `principal` key (dropped by the myelin#182 R2 breaking cut); the canonical DID key is `identity`. Each stamp object is closed — the legacy key rejects as unknown.",
  },
  {
    id: "envelope/signature-too-short",
    rfc: 3,
    kind: "validateEnvelope",
    input: { ...base(), source: SRC_LUNA, signed_by: [{ method: "ed25519", identity: SIGNER_SECURITY, signature: SIG_SHORT, at: TS, role: "origin" }] },
    expect: { ok: false, reason: "signature-too-short" },
    why: "The stamp signature has schema minLength 88 (base64-signature). A 40-char signature rejects at THIS layer. Canonical exactly-88 / non-malleability is RFC-0004's `signature` (§4), onto which this tightens at R.",
  },
  {
    id: "envelope/target-assistant-wrong-class",
    rfc: 3,
    kind: "validateEnvelope",
    input: { ...base(), source: SRC_DISPATCH, distribution_mode: "direct", target_assistant: "did:mf:principal.andreas" },
    expect: { ok: false, reason: "target-assistant-not-agent" },
    why: "D20: target_assistant is an AGENT-class DID only — it names the receiving assistant, never a principal. A principal-class DID rejects even though it is a well-formed DID and the cross-field rule is otherwise satisfied.",
  },
  {
    id: "envelope/target-principal-top-level",
    rfc: 3,
    kind: "validateEnvelope",
    input: { ...base(), target_principal: TARGET_AGENT },
    expect: { ok: false, reason: "unknown-field" },
    why: "The legacy key `target_principal` was removed by the R13 breaking cut and is reserved-as-removed: an envelope carrying it rejects as an unknown field (closed contract, D2).",
  },
  {
    id: "envelope/direct-missing-target",
    rfc: 3,
    kind: "validateEnvelope",
    input: { ...base(), source: SRC_DISPATCH, distribution_mode: "direct" },
    expect: { ok: false, reason: "target-assistant-required" },
    why: "Cross-field rule (§6): distribution_mode ∈ {direct,delegate} ⇒ target_assistant REQUIRED. `direct` with no target rejects. Accept half is envelope/direct-with-target.",
  },
  {
    id: "envelope/distribution-broadcast",
    rfc: 3,
    kind: "validateEnvelope",
    input: { ...base(), distribution_mode: "broadcast" },
    expect: { ok: false, reason: "distribution-mode-invalid" },
    why: "distribution_mode is one of {offer,direct,delegate}. `broadcast` was removed from the wire by the R11 (#180) breaking cut and MUST be rejected — the stale schema `description` and docs prose that still bless it are defects (§8).",
  },
  {
    id: "envelope/originator-principal-key",
    rfc: 3,
    kind: "validateEnvelope",
    input: { ...base(), originator: { identity: SURFACE, attribution: "adapter-resolved", principal: WALLET_ANYCLASS } },
    expect: { ok: false, reason: "unknown-field-in-originator" },
    why: "originator is exactly {identity, attribution}, closed. The legacy `principal` key (removed by the R2 breaking cut) rejects as an unknown field.",
  },
  {
    id: "envelope/requirements-bad-tag",
    rfc: 3,
    kind: "validateEnvelope",
    input: { ...base(), requirements: ["a--b"] },
    expect: { ok: false, reason: "capability-tag-invalid" },
    why: "requirements items MUST match `capability-tag`: runs of alnum joined by a SINGLE '-', no consecutive '--'. `a--b` rejects. (RFC-0002's namespace.md states a looser grammar — a cross-doc divergence RFC-0002 must reconcile.)",
  },
  // over-max-size (D11) is appended programmatically below — see buildOversize().
];

// D11: whole-envelope 1 MiB (1,048,576-octet) receive bound. Build a payload
// pad that pushes the serialized envelope PAST the bound. The pad is machine-
// made 'a' repetition (no digit runs → confidentiality-gate safe), so no
// megabyte literal is hand-committed.
function buildOversize(): Vector {
  const LIMIT = 1_048_576; // 1 MiB, receive-reject (RFC §6/§10; transport RFC-0007)
  const env = base() as Record<string, unknown>;
  // Serialize a template WITHOUT the pad, then size the pad to overshoot LIMIT.
  env.payload = { pad: "" };
  const overheadBytes = Buffer.byteLength(JSON.stringify(env), "utf8");
  const padLen = LIMIT - overheadBytes + 64; // +64 → strictly greater than LIMIT
  (env.payload as { pad: string }).pad = "a".repeat(padLen);
  const size = Buffer.byteLength(JSON.stringify(env), "utf8");
  if (size <= LIMIT) throw new Error(`oversize vector not over the bound: ${size}`);
  return {
    id: "envelope/over-max-size",
    rfc: 3,
    kind: "validateEnvelope",
    input: env,
    expect: { ok: false, reason: "envelope-too-large" },
    why: `D11: the whole-envelope receive bound is 1,048,576 octets (1 MiB). This envelope serializes to ${size} octets (> the bound) and MUST be rejected receive-side. The transport-alignment sentence lives in RFC-0007; the numeric bound is envelope-law here. Pad is machine-generated 'a' repetition (confidentiality-gate safe).`,
  };
}
invalid.push(buildOversize());

// ── emit ─────────────────────────────────────────────────────────────────────
writeFileSync(join(HERE, "valid.json"), JSON.stringify(valid, null, 2) + "\n");
writeFileSync(join(HERE, "invalid.json"), JSON.stringify(invalid, null, 2) + "\n");

// eslint-disable-next-line no-console
console.log(`envelope vectors: ${valid.length} valid, ${invalid.length} invalid (incl. 1 oversize)`);
