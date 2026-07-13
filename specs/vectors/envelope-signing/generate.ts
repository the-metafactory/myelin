#!/usr/bin/env bun
// specs/vectors/envelope-signing/generate.ts
//
// RFC-0004 (Envelope Signing & Canonicalization) — committed vector GENERATOR (D28).
//
// Emits the full ratified vector matrix into this directory:
//   canonicalize.json  — byte-exact canonical signing form (D1 field-ID indirection,
//                         D2/D5 canonicalization, D9 domain-separation prefix, D31 MUST-fail)
//   sign-verify.json   — sign->verify round trips, chain-commit, hub-stamp, freshness (D17), domain-sep
//   reject.json        — the RFC-0004 §11 rejection-token matrix (D27) + D8 crypto edge cases
//                        + D6 chain cap + D16 stackless fail-closed
//
// SELF-CONTAINED by design (clean-room / independent-impl grade, L0b + D32): this file
// imports ONLY node:crypto. It does NOT import the myelin reference. A second implementation
// reproduces every byte below from the RFC prose + ABNF alone. Ed25519 is deterministic
// (RFC 8032), so the signatures are reproducible by any conforming signer.
//
// PUBLIC-SAFETY: all key/signature/point material is emitted as base64 (the wire form), which
// is letter/`+`/`/`-heavy and free of the 17-20 consecutive-digit runs the confidentiality gate
// flags. Byte patterns are built programmatically (never as long digit-run literals).
//
// Run:  bun specs/vectors/envelope-signing/generate.ts
//
// TEST KEYS ARE DESIGNATED TEST VECTORS (D30). Seeds are fixed byte fills; the hub test
// identity is `did:mf:hub.testnet`, deliberately OFF the reserved real `did:mf:hub.metafactory`.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createPrivateKey,
  createPublicKey,
  sign as edSign,
  verify as edVerify,
} from "node:crypto";

// ───────────────────────── Ed25519 from 32-byte seed ─────────────────────────
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function privFromSeed(seed: Uint8Array) {
  return createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(seed)]),
    format: "der",
    type: "pkcs8",
  });
}
function pubB64(priv: ReturnType<typeof privFromSeed>): string {
  const der = createPublicKey(priv).export({ format: "der", type: "spki" }) as Buffer;
  return der.subarray(der.length - 32).toString("base64");
}
function sign(priv: ReturnType<typeof privFromSeed>, msg: Uint8Array): string {
  return edSign(null, Buffer.from(msg), priv).toString("base64");
}
function verify(pk: string, msg: Uint8Array, sig: string): boolean {
  const pub = createPublicKey({
    key: Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(pk, "base64")]),
    format: "der",
    type: "spki",
  });
  return edVerify(null, Buffer.from(msg), pub, Buffer.from(sig, "base64"));
}

// ───────────────────────── JCS canonicalization (RFC-0004 §3) ─────────────────────────
function canon(v: unknown): string {
  if (v === null) return "null";
  const t = typeof v;
  if (t === "boolean") return v ? "true" : "false";
  if (t === "number") {
    if (!Number.isFinite(v)) throw new Error("non-finite-number");
    return JSON.stringify(v); // ECMAScript shortest round-trip (§3.2)
  }
  if (t === "string") return JSON.stringify(v as string); // RFC 8785 §3.2.2.2 escaping (ASCII exact)
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  if (t === "object") {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort(); // UTF-16 code-unit order (§3.3)
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon(o[k])).join(",") + "}";
  }
  throw new Error("non-plain-object"); // D5 (unreachable from I-JSON input)
}

// ───────────────────────── field-ID registry (D1) ─────────────────────────
const FIELD_ID: Record<string, number> = {
  id: 1, source: 2, type: 3, timestamp: 4, sovereignty: 5, payload: 6, signed_by: 7,
  requirements: 8, sovereignty_required: 9, deadline: 10, distribution_mode: 11,
  target_assistant: 12, originator: 13, spec_version: 14,
};
const CARVE_OUT = new Set(["correlation_id", "economics", "extensions"]); // §4.2, no field-id

// ───────────────────────── domain-separation prefix (D9) ─────────────────────────
const CONTEXT_TAG = new Uint8Array([
  ...Buffer.from("metafactory-envelope-signature-v1", "utf8"),
  0x00,
]);

type Stamp = Record<string, unknown>;

function projectFieldId(env: Record<string, unknown>): Record<string, unknown> {
  const q: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(env)) {
    if (CARVE_OUT.has(k)) continue;
    const fid = FIELD_ID[k];
    if (fid === undefined) continue; // non-signable dropped
    q[String(fid)] = val;
  }
  return q;
}
// myelin shim (D32): null / primitive / absent signed_by -> [] (unsigned); single object -> [object]
function normalizeSignedBy(sb: unknown): Stamp[] {
  if (sb === undefined) return [];
  if (Array.isArray(sb)) return sb as Stamp[];
  if (sb === null || typeof sb !== "object") return [];
  return [sb as Stamp];
}
// canonicalizeForSigning: field-ID projection + signed_by shape normalization (NO signature stripping)
function canonForSigning(env: Record<string, unknown>): string {
  const q = projectFieldId(env);
  if ("7" in q) q["7"] = normalizeSignedBy(q["7"]);
  return canon(q);
}
// canonicalizeForChainStamp: the §5.4 bytes for stamp `index` (slice [0..index], strip index's own sig)
function canonForChainStamp(env: Record<string, unknown>, index: number): string {
  const q = projectFieldId(env);
  const chain = normalizeSignedBy(q["7"]);
  q["7"] = chain.slice(0, index + 1).map((s, i) => {
    if (i !== index) return s; // earlier stamps keep their signature verbatim
    const { signature, ...rest } = s; // strip the signing stamp's own signature
    void signature;
    return rest;
  });
  return canon(q);
}
function bytesToSign(canonStr: string): Uint8Array {
  return new Uint8Array([...CONTEXT_TAG, ...Buffer.from(canonStr, "utf8")]);
}

// ───────────────────────── test keys (DESIGNATED TEST VECTORS, D30) ─────────────────────────
const echoPriv = privFromSeed(new Uint8Array(32).fill(1)); // 0x01 * 32
const hubPriv = privFromSeed(new Uint8Array(32).fill(2)); // 0x02 * 32
const stackPriv = privFromSeed(new Uint8Array(32).fill(3)); // 0x03 * 32
const ECHO_PK = pubB64(echoPriv);
const HUB_PK = pubB64(hubPriv);
const STACK_PK = pubB64(stackPriv);

const DID_ECHO = "did:mf:agent.andreas.meta-factory.echo"; // keyed-plane agent
const DID_STACK = "did:mf:stack.andreas.meta-factory"; // keyed-plane stack (innermost signer)
const DID_HUB = "did:mf:hub.testnet"; // TEST hub, OFF did:mf:hub.metafactory (D30)

// ───────────────────────── base envelope (post-cut dot-form, D29) ─────────────────────────
const BASE = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  source: "andreas.meta-factory.local",
  type: "review.completed",
  timestamp: "2026-05-07T12:00:00Z",
  sovereignty: {
    classification: "local",
    data_residency: "CH",
    max_hop: 0,
    frontier_ok: false,
    model_class: "local-only",
  },
  payload: { pr: 42, verdict: "approved" },
} as const;

// ───────────────────────── build the signed two-stamp chain ─────────────────────────
const stamp0: Stamp = { method: "ed25519", identity: DID_ECHO, at: "2026-05-07T12:00:00Z", role: "origin" };
{
  const c = canonForChainStamp({ ...BASE, signed_by: [stamp0] }, 0);
  stamp0.signature = sign(echoPriv, bytesToSign(c));
}
const stamp1: Stamp = { method: "ed25519", identity: DID_HUB, at: "2026-05-07T12:00:05Z", role: "accountability" };
{
  const c = canonForChainStamp({ ...BASE, signed_by: [stamp0, stamp1] }, 1);
  stamp1.signature = sign(hubPriv, bytesToSign(c));
}
const CHAIN2 = { ...BASE, signed_by: [stamp0, stamp1] };

// hub-stamp: hub.testnet vouches FOR the stack; signature made with the HUB key (D14 mechanics)
const hubStamp: Stamp = {
  method: "hub-stamp",
  identity: DID_STACK,
  stamped_by: DID_HUB,
  at: "2026-05-07T12:00:00Z",
  role: "notary",
};
{
  const c = canonForChainStamp({ ...BASE, signed_by: [hubStamp] }, 0);
  hubStamp.signature = sign(hubPriv, bytesToSign(c));
}
const HUBCHAIN = { ...BASE, signed_by: [hubStamp] };

// stale stamp (freshness admission vs re-verify, D17/D20)
const staleStamp: Stamp = { method: "ed25519", identity: DID_ECHO, at: "2020-01-01T00:00:00Z", role: "origin" };
const STALE_ENV = { ...BASE, timestamp: "2020-01-01T00:00:00Z", signed_by: [staleStamp] };
{
  const c = canonForChainStamp(STALE_ENV, 0);
  staleStamp.signature = sign(echoPriv, bytesToSign(c));
}

// domain-separation: a bare-canonical signature (NO context tag) — the cross-protocol reuse case
const stamp0Canon = canonForChainStamp({ ...BASE, signed_by: [stamp0] }, 0);
const BARE_SIG = sign(echoPriv, Buffer.from(stamp0Canon, "utf8")); // signed WITHOUT the tag -> must reject

// ───────────────────────── self-check ─────────────────────────
function assert(cond: boolean, msg: string) { if (!cond) throw new Error("SELF-CHECK FAILED: " + msg); }
assert(ECHO_PK === "iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w=", "echo pubkey drift");
assert(HUB_PK === "gTl3Dqh9F19Wo1Rmw0x+zMuNipG07jeiXfYPW4/Js5Q=", "hub pubkey drift");
assert(verify(ECHO_PK, bytesToSign(canonForChainStamp(CHAIN2, 0)), stamp0.signature as string), "stamp0 verify");
assert(verify(HUB_PK, bytesToSign(canonForChainStamp(CHAIN2, 1)), stamp1.signature as string), "stamp1 verify");
assert(verify(HUB_PK, bytesToSign(canonForChainStamp(HUBCHAIN, 0)), hubStamp.signature as string), "hub-stamp verify");
assert(!verify(ECHO_PK, bytesToSign(stamp0Canon), BARE_SIG), "bare sig must NOT verify under tagged bytes");
assert((stamp0.signature as string).length === 88, "sig must be exactly 88 base64 chars");

// ───────────────────────── D8 crypto edge material (built without digit-run literals) ─────────────────────────
const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
const ORDER1_POINT = Uint8Array.of(1, ...Array(31).fill(0)); // order-1 identity point (small-order)
const ORDER8_POINT = Buffer.from("26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05", "hex"); // canonical, small-order (letter-heavy hex)
const Y_EQUALS_P = Uint8Array.of(0xed, ...Array(30).fill(0xff), 0x7f); // y = p: non-canonical field element
const SCALAR_ALL_ONES = new Uint8Array(32).fill(0xff); // >= L (group order)
const SCALAR_ONE = Uint8Array.of(1, ...Array(31).fill(0));

const SIG_SMALL_ORDER_R = b64(new Uint8Array([...ORDER8_POINT, ...SCALAR_ONE])); // R small-order, S valid
const SIG_NONCANON_R = b64(new Uint8Array([...Y_EQUALS_P, ...SCALAR_ONE])); // R non-canonical point
const SIG_SCALAR_TOO_BIG = b64(new Uint8Array([...Buffer.from(ECHO_PK, "base64"), ...SCALAR_ALL_ONES])); // valid R, S >= L
const SMALL_ORDER_A = b64(ORDER1_POINT);

// a syntactically valid 88-char signature reused where the crypto value is irrelevant to the defect
const FILLER_SIG = stamp0.signature as string;

// registries -----------------------------------------------------------------
const REG = {
  version: 2,
  identities: [
    { id: DID_ECHO, network: "testnet", public_key: ECHO_PK, type: "agent", created_at: "2026-01-01T00:00:00Z" },
    { id: DID_STACK, network: "testnet", public_key: STACK_PK, type: "stack", created_at: "2026-01-01T00:00:00Z" },
    { id: DID_HUB, network: "testnet", public_key: HUB_PK, type: "hub", is_hub: true, created_at: "2026-01-01T00:00:00Z" },
  ],
  trusted_hubs: [DID_HUB],
};
// a registry whose echo key is a SMALL-ORDER point (only defect)
const REG_SMALL_ORDER_KEY = {
  ...REG,
  identities: [
    { id: DID_ECHO, network: "testnet", public_key: SMALL_ORDER_A, type: "agent", created_at: "2026-01-01T00:00:00Z" },
    ...REG.identities.slice(1),
  ],
};
// a registry with NO trusted hubs (for untrusted-hub)
const REG_NO_HUBS = { ...REG, trusted_hubs: [] as string[] };

const FRESH_OFF = { mode: "reverify" }; // re-verify: freshness NOT applied (D17)

type Vector = {
  id: string; rfc: 4; kind: string; input: unknown;
  expect: { ok: boolean; value?: unknown; reason?: string };
  why: string;
};

// ═════════════════════════════ canonicalize.json ═════════════════════════════
const canonicalize: Vector[] = [
  {
    id: "canon/unsigned-minimal", rfc: 4, kind: "canonicalizeForSigning",
    input: { ...BASE },
    expect: { ok: true, value: canonForSigning({ ...BASE }) },
    why: "Pins the D1 FIELD-ID-INDIRECTION canonical form: the six present signable fields are re-keyed by their permanent field-id (id->1, source->2, type->3, timestamp->4, sovereignty->5, payload->6) and JCS-sorted (§3.3). A rename of any of these names cannot change these bytes — that is the whole point of D1. Nested object keys keep their own names, sorted. The floor of interop.",
  },
  {
    id: "canon/mutable-carveout-masked", rfc: 4, kind: "canonicalizeForSigning",
    input: { ...BASE, correlation_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", economics: { estimate: 0.5 }, extensions: { trace: "deadbeef" } },
    expect: { ok: true, value: canonForSigning({ ...BASE }) },
    why: "MASKING CASE (D4 integrity-by-default has a bounded exception). correlation_id, economics and extensions are the §4.2 carve-out: they carry NO field-id and MUST NOT enter the canonical bytes. Byte-identical to canon/unsigned-minimal. A naive implementer who re-keys the whole envelope diverges only when a relay actually annotates one of these fields.",
  },
  {
    id: "canon/number-and-nested-sort", rfc: 4, kind: "canonicalizeForSigning",
    input: { ...BASE, payload: { value: 1.0, count: 10, z: { b: 2, a: 1 } } },
    expect: { ok: true, value: canonForSigning({ ...BASE, payload: { value: 1.0, count: 10, z: { b: 2, a: 1 } } }) },
    why: "Pins ECMAScript number serialization (1.0 emits as 1; §3.2) and recursive UTF-16 key sort inside the payload value (which is NOT field-id-indirected — only the 14 top-level names are). A non-JS implementer must reproduce the shortest-round-trip number formatting or diverge on any non-integer.",
  },
  {
    id: "canon/single-object-normalizes-to-array", rfc: 4, kind: "canonicalizeForSigning",
    input: { ...BASE, signed_by: stamp0 },
    expect: { ok: true, value: canonForSigning({ ...BASE, signed_by: [stamp0] }) },
    why: "AMBIGUITY CASE (§4.3). The wire carried signed_by (field-id 7) as a single OBJECT (legacy shim); the canonical bytes MUST serialize it as a one-element ARRAY. An envelope received with signed_by:{...} and with signed_by:[{...}] MUST produce byte-identical output. canonicalizeForSigning does NOT strip signatures — the stamp keeps its signature here (contrast the chain-slice vectors).",
  },
  {
    id: "canon/stamp0-signing-bytes", rfc: 4, kind: "canonicalizeForChainStamp",
    input: { index: 0, envelope: CHAIN2 },
    expect: { ok: true, value: canonForChainStamp(CHAIN2, 0) },
    why: "Chain-slice for stamp 0 (§5.4): signed_by = chain[0..0] with stamp 0's OWN signature stripped (a stamp cannot sign its own signature). Field-id 7 carries the one-element array. bytes-to-sign = CONTEXT_TAG || UTF-8(this) (see canon/bytes-to-sign-domain-separated); Ed25519 over those under the echo TEST seed yields sign-verify.json two-stamp stamp[0].",
  },
  {
    id: "canon/stamp1-commits-to-stamp0", rfc: 4, kind: "canonicalizeForChainStamp",
    input: { index: 1, envelope: CHAIN2 },
    expect: { ok: true, value: canonForChainStamp(CHAIN2, 1) },
    why: "CHAIN-COMMIT (§5.4). Stamp 1's signing bytes include stamp 0 WITH its signature intact and stamp 1's own signature stripped. Because stamp 0's signature is inside stamp 1's signed bytes, tampering with any field of stamp 0 breaks stamp 1. THE vector that pins the tamper-evidence property.",
  },
  {
    id: "canon/bytes-to-sign-domain-separated", rfc: 4, kind: "bytesToSign",
    input: { index: 0, envelope: CHAIN2 },
    expect: { ok: true, value: Buffer.from(bytesToSign(canonForChainStamp(CHAIN2, 0))).toString("base64") },
    why: "D9 DOMAIN SEPARATION. Pins bytes-to-sign = CONTEXT_TAG || UTF-8(canonical) at the byte level (value is base64 of the whole signed-octet string). The tag is the UTF-8 of `metafactory-envelope-signature-v1` + one 0x00. This is what makes a metafactory signature structurally unusable in any other Ed25519 protocol; sign-verify.json verify/domain-sep-cross-protocol-rejected is its negative.",
  },
  {
    id: "canon/shim-null-signed-by-is-empty", rfc: 4, kind: "normalizeSignedBy",
    input: { signed_by: null },
    expect: { ok: true, value: [] },
    why: "SHIM DIVERGENCE (D32; §9 cortex-chain-shim-drift). A null/primitive signed_by normalizes to [] (unsigned) in the myelin reference; cortex's re-implemented shim returns a one-element chain containing the bad value. This vector pins the correct behaviour so cortex's shim FAILS it (the desired outcome — it surfaces the drift). Each impl MUST run this against its OWN shim.",
  },
  {
    id: "canon/nonfinite-number-must-fail", rfc: 4, kind: "parseAndCanonicalize",
    input: '{"id":"550e8400-e29b-41d4-a716-446655440000","source":"andreas.meta-factory.local","type":"review.completed","timestamp":"2026-05-07T12:00:00Z","sovereignty":{"classification":"local","data_residency":"CH","max_hop":0,"frontier_ok":false,"model_class":"local-only"},"payload":{"n":1e400}}',
    expect: { ok: false, reason: "non-finite-number" },
    why: "The ONLY canonicalizer MUST-fail (D31 stress refinement — do not overclaim the JCS-negatives class). `input` is RAW JSON TEXT (D2 parse-then-re-canonicalize): the number token 1e400 is syntactically valid JSON but is non-finite as a double (Infinity), so §3.1 requires the operation to FAIL — whether the parser rejects the out-of-range token or yields Infinity and canonicalization then fails, the required outcome is rejection with this token. Non-plain objects (D5) are a programmatic-misuse guard that cannot arise from parsed JSON, so they carry NO JSON vector (a Date/Map/Set is not expressible as JSON input) — D5 is prose-normative only.",
  },
  {
    id: "canon/duplicate-key-rejected", rfc: 4, kind: "parseAndCanonicalize",
    input: '{"id":"550e8400-e29b-41d4-a716-446655440000","id":"deadbeef-cafe-babe-f00d-feedfacefeed","source":"andreas.meta-factory.local","type":"review.completed","timestamp":"2026-05-07T12:00:00Z","sovereignty":{"classification":"local","data_residency":"CH","max_hop":0,"frontier_ok":false,"model_class":"local-only"},"payload":{"pr":42}}',
    expect: { ok: false, reason: "duplicate-key" },
    why: "D2 I-JSON constraint. `input` is RAW JSON TEXT with a DUPLICATED top-level key (`id` twice). A conforming parser MUST reject duplicate keys where detectable and MUST NOT rely on shadowed content (silently taking the last value is non-conforming — it would let an adversary present different `id`s to a lenient vs a strict reader). Expressible only against raw text, since a permissive JSON.parse collapses the duplicate before the canonicalizer ever sees it.",
  },
];

// ═════════════════════════════ sign-verify.json ═════════════════════════════
const signVerify: Vector[] = [
  {
    id: "verify/two-stamp-chain-ok", rfc: 4, kind: "verifyEnvelopeIdentity",
    input: { freshness: FRESH_OFF, registry: REG, envelope: CHAIN2 },
    expect: { ok: true, value: { status: "verified", chainLength: 2, principal: DID_HUB } },
    why: "Full sign->verify round trip under the ratified scheme (D1 field-id + D9 domain tag + D8 strict equation), post-cut dot-form DIDs (D29). Both ed25519 stamps verify; the returned convenience principal is the LAST verified stamp (the hub). Freshness is in re-verify mode (D17) so signature correctness is testable independent of wall-clock.",
  },
  {
    id: "verify/tampered-stamp0-role-rejected", rfc: 4, kind: "verifyEnvelopeIdentity",
    input: {
      freshness: FRESH_OFF, registry: REG,
      envelope: { ...BASE, signed_by: [{ ...stamp0, role: "sovereignty" }, stamp1] },
    },
    expect: { ok: false, reason: "stamp-signature-invalid" },
    why: "Adversarial: stamp 0's role was flipped origin->sovereignty AFTER signing. role is inside the signed bytes (§4.1/§5.4), so stamp 0's signature no longer matches and verify rejects at index 0. Proves a self-asserted role cannot be rewritten in transit — and (with D11) why authority anchors on the ORIGIN stamp, never on a mutable role claim.",
  },
  {
    id: "verify/hub-stamp-ok", rfc: 4, kind: "verifyEnvelopeIdentity",
    input: { freshness: FRESH_OFF, registry: REG, envelope: HUBCHAIN },
    expect: { ok: true, value: { status: "verified", chainLength: 1, principal: DID_STACK } },
    why: "hub-stamp MECHANICS (D14 — mechanics pinned; the vouching-authority SCOPE stays an OPEN DECISION, Andreas+JC, blocked on cortex Phase D). identity is the entity vouched FOR (the stack); the signature is verified under the HUB's key (stamped_by), and stamped_by MUST be in trusted_hubs. The vouched identity still resolves in the registry.",
  },
  {
    id: "verify/stale-admission-rejected", rfc: 4, kind: "verifyEnvelopeIdentity",
    input: { freshness: { mode: "admission", now: "2026-05-07T12:00:00Z", windowMs: 300000 }, registry: REG, envelope: STALE_ENV },
    expect: { ok: false, reason: "at-outside-freshness" },
    why: "D17 ADMISSION-ONLY freshness + D20 (`at` is the sole anchor). At the trust-boundary ingress the stamp `at` (2020) is ~6 years outside the +/-300s window against `now` (2026), so admission rejects. Freshness is checked ONCE, here — not on every re-verify.",
  },
  {
    id: "verify/stale-reverify-ok", rfc: 4, kind: "verifyEnvelopeIdentity",
    input: { freshness: { mode: "reverify" }, registry: REG, envelope: STALE_ENV },
    expect: { ok: true, value: { status: "verified", chainLength: 1, principal: DID_ECHO } },
    why: "The SAME stale envelope as verify/stale-admission-rejected, re-verified after admission (e.g. archive/JetStream replay). D17: re-verify MUST NOT re-apply the freshness window — the signature is still valid, so it verifies. This is what lets six-month archive replay and freshness coexist (couples to RFC-0007 redelivery).",
  },
  {
    id: "verify/domain-sep-cross-protocol-rejected", rfc: 4, kind: "verifyEnvelopeIdentity",
    input: {
      freshness: FRESH_OFF, registry: REG,
      envelope: { ...BASE, signed_by: [{ ...stamp0, signature: BARE_SIG }] },
    },
    expect: { ok: false, reason: "stamp-signature-invalid" },
    why: "D9 negative. The stamp carries a signature computed over the BARE canonical bytes WITHOUT the CONTEXT_TAG prefix (what a foreign protocol / raw-JCS signer would emit). Under the tagged verification equation it does not match, so it rejects. Demonstrates that stripping/omitting domain separation kills cross-protocol NKey reuse.",
  },
];

// ═════════════════════════════ reject.json ═════════════════════════════
const reject: Vector[] = [
  // ── shape / lexical (validateStampSyntax) ──
  {
    id: "stamp/signature-wrong-length", rfc: 4, kind: "validateStampSyntax",
    input: { method: "ed25519", identity: DID_ECHO, at: "2026-05-07T12:00:00Z", signature: "c2hvcnQ=" },
    expect: { ok: false, reason: "signature-wrong-length" },
    why: "D7 (tighten-at-cut): a 64-byte Ed25519 signature is EXACTLY 88 base64 chars. The former deployed rule (minLength:88, unbounded above, malleable final quantum) is retired at flag-day R; anything not exactly-88-canonical rejects. `c2hvcnQ=` is 8 chars.",
  },
  {
    id: "stamp/unknown-method", rfc: 4, kind: "validateStampSyntax",
    input: { method: "rsa", identity: DID_ECHO, at: "2026-05-07T12:00:00Z", signature: FILLER_SIG },
    expect: { ok: false, reason: "unknown-signing-method" },
    why: "method is a closed enum ed25519 | hub-stamp (§5.1, ABNF signing-method). Any other discriminator is rejected at the wire boundary; guards against silent acceptance of an unspecified algorithm.",
  },
  {
    id: "stamp/legacy-principal-key", rfc: 4, kind: "validateStampSyntax",
    input: { method: "ed25519", principal: DID_ECHO, at: "2026-05-07T12:00:00Z", signature: FILLER_SIG },
    expect: { ok: false, reason: "legacy-principal-key" },
    why: "R2 breaking cut (myelin#182): the stamp DID key is `identity`; the deprecated `principal` key was dropped and is now an unknown additional property. A stamp carrying `principal` (and thus no `identity`) is rejected. Pins the completed rename so a consumer cannot re-introduce the old key.",
  },
  {
    id: "stamp/at-calendar-blind-accepted", rfc: 4, kind: "validateStampSyntax",
    input: { method: "ed25519", identity: DID_ECHO, at: "2026-13-40T25:99:99Z", signature: FILLER_SIG },
    expect: { ok: true },
    why: "RETAINED FINDING, not a design (the grill did NOT ratify a calendar-valid tightening). The deployed ISO-8601 grammar (ABNF `at`) is calendar-blind — month 13, day 40, hour 25 pass the SYNTAX layer. verify then rejects it (see verify/at-calendar-blind-rejected). A conformant impl of the deployed grammar MUST accept this at the syntax layer.",
  },
  // ── verification (verifyEnvelopeIdentity) — the §11 token matrix (D27) ──
  {
    id: "verify/at-calendar-blind-rejected", rfc: 4, kind: "verifyEnvelopeIdentity",
    input: {
      freshness: { mode: "reverify" }, registry: REG,
      envelope: { ...BASE, signed_by: [{ ...stamp0, at: "2026-13-40T25:99:99Z" }] },
    },
    expect: { ok: false, reason: "at-not-iso8601" },
    why: "Companion to stamp/at-calendar-blind-accepted: the same calendar-blind `at` that passes SYNTAX is rejected at VERIFY because it does not parse to a finite instant (§7.1 step 3). One field, two strictness levels — the honest three-level behaviour the audit surfaced.",
  },
  {
    id: "verify/chain-empty-rejected", rfc: 4, kind: "verifyEnvelopeIdentity",
    input: { freshness: FRESH_OFF, class: "enforcing", registry: REG, envelope: { ...BASE, signed_by: [] } },
    expect: { ok: false, reason: "chain-empty" },
    why: "D27 token chain-empty. An empty (or absent) signed_by is UNSIGNED — it carries no verifiable identity. Under an enforcing conformance class (D21/D22) an unsigned envelope MUST reject. Classes differ only on whether UNSIGNED is admissible; a NON-empty chain that fails is covered by the signature/chain tokens below (D22).",
  },
  {
    id: "verify/federated-unsigned-rejected", rfc: 4, kind: "verifyEnvelopeIdentity",
    input: { freshness: FRESH_OFF, scope: "federated", registry: REG, envelope: { ...BASE, signed_by: [] } },
    expect: { ok: false, reason: "chain-empty" },
    why: "D24 ENFORCE FLOOR ON ALL FEDERATED. Cross-principal (federated) traffic ALWAYS gets enforcing verify regardless of local posture: reject-unsigned + reject-invalid + resolve-peer-key. The posture ladder governs local.* only. Registry reachability is a correctness precondition here.",
  },
  {
    id: "verify/chain-too-long-rejected", rfc: 4, kind: "verifyEnvelopeIdentity",
    input: {
      freshness: FRESH_OFF, registry: REG,
      envelope: { ...BASE, signed_by: Array.from({ length: 17 }, () => ({ ...stamp0 })) },
    },
    expect: { ok: false, reason: "chain-too-long" },
    why: "D6 chain-length cap 16. A 17-stamp chain MUST fail cleanly (result token chain-too-long) and MAY be rejected before any signature work (D19 cheap-reject: cheap tier before expensive). Bounds verifier DoS (§9 verify-unbounded-work). A successor RFC MAY harden the floor MAY->MUST-reject.",
  },
  {
    id: "verify/unknown-principal-rejected", rfc: 4, kind: "verifyEnvelopeIdentity",
    input: {
      freshness: FRESH_OFF, registry: REG_NO_HUBS,
      envelope: { ...BASE, signed_by: [{ ...stamp0, identity: "did:mf:agent.andreas.meta-factory.ghost" }] },
    },
    expect: { ok: false, reason: "unknown-principal" },
    why: "§7.1 step 2: a stamp identity that does not resolve in the registry rejects. `...ghost` is a syntactically valid keyed-plane agent DID that is simply not registered.",
  },
  {
    id: "verify/untrusted-hub-rejected", rfc: 4, kind: "verifyEnvelopeIdentity",
    input: { freshness: FRESH_OFF, registry: REG_NO_HUBS, envelope: HUBCHAIN },
    expect: { ok: false, reason: "untrusted-hub" },
    why: "§7.3: a hub-stamp whose stamped_by is not in the registry's trusted_hubs rejects. Same chain as verify/hub-stamp-ok but with an empty trusted_hubs set — trust is file-local (the hub-trust scope OPEN DECISION, D14, lives here).",
  },
  {
    id: "verify/stackless-chain-fail-closed", rfc: 4, kind: "verifyEnvelopeIdentity",
    input: {
      freshness: FRESH_OFF, registry: REG,
      envelope: { ...BASE, originator: DID_ECHO, signed_by: [stamp1] },
    },
    expect: { ok: false, reason: "chain-stack-binding-unresolved" },
    why: "D16 FAIL CLOSED. The envelope names an agent-class originator (did:mf:agent...echo) but the signing chain has NO stack stamp, so the agent-prefix<->stack binding (RFC-0001 §2.2) cannot be established. An unbindable agent originator is REJECTED, never admitted. (When originator is absent the binding is vacuous — contrast verify/two-stamp-chain-ok.)",
  },
  // ── D8 verification-equation edge cases (each carries exactly ONE defect, D19) ──
  {
    id: "verify/small-order-key-rejected", rfc: 4, kind: "verifyEnvelopeIdentity",
    input: { freshness: FRESH_OFF, registry: REG_SMALL_ORDER_KEY, envelope: { ...BASE, signed_by: [stamp0] } },
    expect: { ok: false, reason: "small-order-key" },
    why: "D8: reject a small-order point on the public key A. The registry maps echo's identity to the order-1 identity point; everything else is well-formed. libsodium rejects, some libraries do not — this vector pins the strict (intersection) behaviour myelin adopts at R.",
  },
  {
    id: "verify/small-order-point-R-rejected", rfc: 4, kind: "verifyEnvelopeIdentity",
    input: { freshness: FRESH_OFF, registry: REG, envelope: { ...BASE, signed_by: [{ ...stamp0, signature: SIG_SMALL_ORDER_R }] } },
    expect: { ok: false, reason: "small-order-point" },
    why: "D8: reject a small-order point on the signature component R. R here is a canonically-encoded order-8 point (y < p, so a bare canonicity check does NOT catch it — only an explicit small-order check does). The S component is a valid small scalar; the sole defect is R's order.",
  },
  {
    id: "verify/non-canonical-point-R-rejected", rfc: 4, kind: "verifyEnvelopeIdentity",
    input: { freshness: FRESH_OFF, registry: REG, envelope: { ...BASE, signed_by: [{ ...stamp0, signature: SIG_NONCANON_R }] } },
    expect: { ok: false, reason: "non-canonical-point" },
    why: "D8: reject a non-canonical point ENCODING (y >= p). R here encodes y = p (the field prime), which is not a reduced coordinate; a strict decoder rejects it. Distinct from small-order: this is a malformed encoding, not a valid point of small order.",
  },
  {
    id: "verify/non-canonical-scalar-S-rejected", rfc: 4, kind: "verifyEnvelopeIdentity",
    input: { freshness: FRESH_OFF, registry: REG, envelope: { ...BASE, signed_by: [{ ...stamp0, signature: SIG_SCALAR_TOO_BIG }] } },
    expect: { ok: false, reason: "non-canonical-scalar" },
    why: "D8: reject a non-canonical scalar S >= L (the group order) — the malleability the S<L check (RFC 8032 §5.1.7) closes. R is a valid point (echo's public-key bytes reused as a valid encoding); S is all-ones, which exceeds L. The sole defect is S.",
  },
];

// ───────────────────────── write files ─────────────────────────
const HERE = new URL(".", import.meta.url).pathname;
const write = (name: string, arr: Vector[]) =>
  writeFileSync(join(HERE, name), JSON.stringify(arr, null, 2) + "\n");
write("canonicalize.json", canonicalize);
write("sign-verify.json", signVerify);
write("reject.json", reject);

console.log("wrote canonicalize.json (" + canonicalize.length + "), sign-verify.json (" + signVerify.length + "), reject.json (" + reject.length + ")");
console.log("pubkeys: echo=" + ECHO_PK + " hub=" + HUB_PK + " stack=" + STACK_PK);
