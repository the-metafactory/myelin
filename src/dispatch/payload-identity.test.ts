import { describe, it, expect } from "bun:test";
import { getPublicKeyAsync } from "@noble/ed25519";
import { readPayloadIdentity } from "./payload-identity";
import { createEnvelope } from "../envelope";
import { signEnvelope } from "../identity/sign";
import { verifyEnvelopeIdentity } from "../identity/verify";
import { createInMemoryRegistry } from "../identity/registry";
import type { CreateEnvelopeInput } from "../types";
import type { Identity } from "../identity/types";

// R2 dispatch-payload cross-version tests (vocabulary migration 2026-05,
// PR-7) — the `principal` → `identity` rename on the lifecycle payload
// interfaces. The dispatch payloads ride inside the SIGNABLE envelope
// `payload` field, so this rename has the same wire-safety profile as
// PR-6's envelope-level R2: an OLD-form payload (`principal`) must still
// validate AND verify; a NEW-form payload (`identity`) must validate AND
// verify; a payload carrying BOTH keys must be rejected.

async function makeKeypair() {
  const seed = crypto.getRandomValues(new Uint8Array(32));
  const privateKey = Buffer.from(seed).toString("base64");
  const publicKey = Buffer.from(await getPublicKeyAsync(seed)).toString("base64");
  return { privateKey, publicKey };
}

function makeIdentity(publicKey: string): Identity {
  return {
    id: "did:mf:pilot",
    network: "metafactory",
    public_key: publicKey,
    type: "agent",
    created_at: "2026-05-07T00:00:00Z",
  };
}

/** A dispatch `assigned` lifecycle payload, keyed with the supplied DID key. */
function assignedPayload(didKey: "principal" | "identity"): Record<string, unknown> {
  return {
    task_id: "task-1",
    correlation_id: "550e8400-e29b-41d4-a716-446655440000",
    distribution_mode: "delegate",
    timestamp: "2026-05-21T12:00:00Z",
    [didKey]: "did:mf:pilot",
    claimed_at: "2026-05-21T12:00:00Z",
  };
}

const baseInput: Omit<CreateEnvelopeInput, "payload"> = {
  source: "metafactory.cortex.dispatch",
  type: "dispatch.task.assigned",
  sovereignty: {
    classification: "local",
    data_residency: "CH",
    max_hop: 0,
    frontier_ok: false,
    model_class: "any",
  },
};

describe("readPayloadIdentity — R2 dispatch-payload transition reader", () => {
  it("reads the canonical `identity` key when present", () => {
    const r = readPayloadIdentity(assignedPayload("identity"));
    expect(r.conflict).toBe(false);
    expect(r.value).toBe("did:mf:pilot");
  });

  it("falls back to the deprecated `principal` key (pre-migration payload)", () => {
    const r = readPayloadIdentity(assignedPayload("principal"));
    expect(r.conflict).toBe(false);
    expect(r.value).toBe("did:mf:pilot");
  });

  it("prefers `identity` over `principal` is moot — a both-keys payload is rejected", () => {
    const both = { ...assignedPayload("identity"), principal: "did:mf:pilot" };
    const r = readPayloadIdentity(both);
    expect(r.conflict).toBe(true);
    expect(r.error?.code).toBe("dual_field_conflict");
  });

  it("rejects both keys even when their values are identical (over-eager producer)", () => {
    const both = { ...assignedPayload("identity"), principal: "did:mf:pilot" };
    const r = readPayloadIdentity(both);
    expect(r.conflict).toBe(true);
    expect(r.error?.code).toBe("dual_field_conflict");
  });

  it("rejects both keys when their values DIFFER (attack vector)", () => {
    const both = { ...assignedPayload("identity"), principal: "did:mf:attacker" };
    const r = readPayloadIdentity(both);
    expect(r.conflict).toBe(true);
    expect(r.error?.code).toBe("dual_field_conflict");
    expect(r.value).toBeUndefined();
  });

  it("returns undefined when neither key is present (optional-identity payloads)", () => {
    const r = readPayloadIdentity({ task_id: "t", reason: "timeout" });
    expect(r.conflict).toBe(false);
    expect(r.value).toBeUndefined();
  });
});

describe("R2 dispatch-payload — cross-version wire safety (signed envelopes)", () => {
  it("an OLD-form payload (`principal` key) still validates AND verifies", async () => {
    const { privateKey, publicKey } = await makeKeypair();
    const registry = createInMemoryRegistry();
    registry.add(makeIdentity(publicKey));

    // Envelope built with a pre-migration payload — `payload.principal`.
    const envelope = createEnvelope({ ...baseInput, payload: assignedPayload("principal") });
    const signed = await signEnvelope(envelope, privateKey, "did:mf:pilot");

    // payload bytes are canonicalized verbatim — the old key is part of
    // the signed content, so a new-myelin verifier still verifies it.
    const result = await verifyEnvelopeIdentity(signed, registry);
    expect(result.status).toBe("verified");

    // …and the transition reader resolves the DID off the old key.
    const read = readPayloadIdentity(signed.payload);
    expect(read.conflict).toBe(false);
    expect(read.value).toBe("did:mf:pilot");
  });

  it("a NEW-form payload (`identity` key) validates AND verifies", async () => {
    const { privateKey, publicKey } = await makeKeypair();
    const registry = createInMemoryRegistry();
    registry.add(makeIdentity(publicKey));

    const envelope = createEnvelope({ ...baseInput, payload: assignedPayload("identity") });
    const signed = await signEnvelope(envelope, privateKey, "did:mf:pilot");

    const result = await verifyEnvelopeIdentity(signed, registry);
    expect(result.status).toBe("verified");

    const read = readPayloadIdentity(signed.payload);
    expect(read.conflict).toBe(false);
    expect(read.value).toBe("did:mf:pilot");
  });

  it("createEnvelope never re-keys `payload` — old-form bytes survive round-trip", () => {
    // Wire-safety invariant: PR-6 canonicalizes `payload` bytes-as-received.
    // PR-7 must NOT introduce any re-keying. Confirm the old key is passed
    // through verbatim so the signature stays valid.
    const oldForm = assignedPayload("principal");
    const envelope = createEnvelope({ ...baseInput, payload: oldForm });
    expect("principal" in envelope.payload).toBe(true);
    expect("identity" in envelope.payload).toBe(false);
    expect(envelope.payload.principal).toBe("did:mf:pilot");
  });

  it("a signed both-keys payload is rejected by the transition reader", async () => {
    const { privateKey } = await makeKeypair();
    const both = { ...assignedPayload("identity"), principal: "did:mf:attacker" };
    const envelope = createEnvelope({ ...baseInput, payload: both });
    const signed = await signEnvelope(envelope, privateKey, "did:mf:pilot");

    // Even though the envelope is cryptographically well-formed, the
    // dual-keyed payload is refused at the dispatch trust boundary.
    const read = readPayloadIdentity(signed.payload);
    expect(read.conflict).toBe(true);
    expect(read.error?.code).toBe("dual_field_conflict");
  });
});
