import { describe, it, expect } from "bun:test";
import { utils, getPublicKeyAsync } from "@noble/ed25519";
import { signBidResponse, verifyBidResponse } from "./response";
import { createInMemoryRegistry } from "../identity/registry";
import type { SigningIdentity } from "../identity/types";

function bytesToBase64(b: Uint8Array): string {
  return Buffer.from(b).toString("base64");
}

async function makeIdentity(did: string): Promise<{ identity: SigningIdentity; publicKey: string }> {
  const priv = utils.randomSecretKey();
  const pub = await getPublicKeyAsync(priv);
  return {
    identity: { did, privateKey: bytesToBase64(priv) },
    publicKey: bytesToBase64(pub),
  };
}

describe("signBidResponse", () => {
  it("produces a signed bid response", async () => {
    const { identity } = await makeIdentity("did:mf:luna");
    const bid = await signBidResponse(
      { task_id: "t1", bidder: "did:mf:luna", load: 0.2, capability_match: 0.9 },
      identity,
    );
    expect(bid.bidder).toBe("did:mf:luna");
    // R2 (vocabulary migration 2026-05, PR-10) — bid-response stamps now
    // sign with the canonical `identity` key. Pre-PR-10 bids carrying the
    // deprecated `principal` key still verify (dual-schema read).
    expect((bid.signed_by as { identity: string }).identity).toBe("did:mf:luna");
    expect((bid.signed_by as { principal?: string }).principal).toBeUndefined();
    expect(bid.signed_by.method).toBe("ed25519");
    expect(bid.signed_by.signature.length).toBeGreaterThan(0);
  });

  it("rejects bidder/identity DID mismatch (anti-spoof)", async () => {
    const { identity } = await makeIdentity("did:mf:luna");
    await expect(
      signBidResponse({ task_id: "t1", bidder: "did:mf:fern", load: 0.2, capability_match: 0.9 }, identity),
    ).rejects.toThrow(/must match identity/);
  });

  it("rejects out-of-range load", async () => {
    const { identity } = await makeIdentity("did:mf:luna");
    await expect(
      signBidResponse({ task_id: "t1", bidder: "did:mf:luna", load: 1.5, capability_match: 0.9 }, identity),
    ).rejects.toThrow(/load must be in/);
  });

  it("rejects negative cost", async () => {
    const { identity } = await makeIdentity("did:mf:luna");
    await expect(
      signBidResponse(
        { task_id: "t1", bidder: "did:mf:luna", load: 0.5, capability_match: 0.5, cost: -1 },
        identity,
      ),
    ).rejects.toThrow(/cost/);
  });

  it("rejects bad DID", async () => {
    const identity: SigningIdentity = { did: "rogue", privateKey: bytesToBase64(utils.randomSecretKey()) };
    await expect(
      signBidResponse({ task_id: "t1", bidder: "rogue", load: 0.2, capability_match: 0.9 }, identity),
    ).rejects.toThrow(/invalid bidder DID/);
  });
});

describe("verifyBidResponse", () => {
  it("verifies a valid signature", async () => {
    const { identity, publicKey } = await makeIdentity("did:mf:luna");
    const registry = createInMemoryRegistry();
    registry.add({ id: "did:mf:luna", network: "metafactory", public_key: publicKey, type: "agent", created_at: "2026-05-07T00:00:00Z" });
    const bid = await signBidResponse({ task_id: "t1", bidder: "did:mf:luna", load: 0.2, capability_match: 0.9 }, identity);
    const result = await verifyBidResponse(bid, registry);
    expect(result.valid).toBe(true);
  });

  it("rejects unknown identity", async () => {
    const { identity } = await makeIdentity("did:mf:luna");
    const registry = createInMemoryRegistry();
    const bid = await signBidResponse({ task_id: "t1", bidder: "did:mf:luna", load: 0.2, capability_match: 0.9 }, identity);
    const result = await verifyBidResponse(bid, registry);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/unknown identity/);
  });

  it("rejects tampered payload", async () => {
    const { identity, publicKey } = await makeIdentity("did:mf:luna");
    const registry = createInMemoryRegistry();
    registry.add({ id: "did:mf:luna", network: "metafactory", public_key: publicKey, type: "agent", created_at: "2026-05-07T00:00:00Z" });
    const bid = await signBidResponse({ task_id: "t1", bidder: "did:mf:luna", load: 0.2, capability_match: 0.9 }, identity);
    bid.load = 0.0;
    const result = await verifyBidResponse(bid, registry);
    expect(result.valid).toBe(false);
  });

  // R2 (vocabulary migration 2026-05, PR-10) — dual-schema regression tests.
  // Mirrors the envelope.ts PR-6 conflict-rejection contract.
  it("accepts a pre-migration bid signed with the deprecated `principal` key", async () => {
    const { identity, publicKey } = await makeIdentity("did:mf:luna");
    const registry = createInMemoryRegistry();
    registry.add({ id: "did:mf:luna", network: "metafactory", public_key: publicKey, type: "agent", created_at: "2026-05-07T00:00:00Z" });
    const newForm = await signBidResponse({ task_id: "t1", bidder: "did:mf:luna", load: 0.2, capability_match: 0.9 }, identity);
    // Synthesise an old-form bid: re-sign with `principal` instead of `identity`.
    // The canonical bytes serialize whichever key is present, so re-keying the
    // draft + re-signing yields a bid that should still verify.
    const oldFormDraft = {
      ...newForm,
      signed_by: {
        method: "ed25519" as const,
        principal: "did:mf:luna",
        signature: "",
        at: (newForm.signed_by as { at: string }).at,
      },
    };
    const { canonicalStringify } = await import("../jcs");
    const { signAsync } = await import("@noble/ed25519");
    const { bytesFromBase64, bytesToBase64 } = await import("../base64");
    const { signature: _drop, ...sbForSigning } = oldFormDraft.signed_by;
    void _drop;
    const oldFormPayload = new TextEncoder().encode(canonicalStringify({
      task_id: oldFormDraft.task_id,
      bidder: oldFormDraft.bidder,
      load: oldFormDraft.load,
      capability_match: oldFormDraft.capability_match,
      signed_by: sbForSigning,
    }));
    const priv = bytesFromBase64(identity.privateKey);
    const sig = await signAsync(oldFormPayload, priv);
    const oldForm = {
      ...oldFormDraft,
      signed_by: { ...oldFormDraft.signed_by, signature: bytesToBase64(sig) },
    } as typeof newForm;
    const result = await verifyBidResponse(oldForm, registry);
    expect(result.valid).toBe(true);
  });

  it("rejects a bid carrying BOTH `principal` and `identity` (dual_field_conflict)", async () => {
    const { identity, publicKey } = await makeIdentity("did:mf:luna");
    const registry = createInMemoryRegistry();
    registry.add({ id: "did:mf:luna", network: "metafactory", public_key: publicKey, type: "agent", created_at: "2026-05-07T00:00:00Z" });
    const bid = await signBidResponse({ task_id: "t1", bidder: "did:mf:luna", load: 0.2, capability_match: 0.9 }, identity);
    // Splice the deprecated `principal` key in alongside the canonical
    // `identity` key — should be refused at the trust boundary.
    (bid.signed_by as unknown as Record<string, unknown>).principal = "did:mf:luna";
    const result = await verifyBidResponse(bid, registry);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/dual_field_conflict/);
  });

  it("rejects bidder/identity mismatch", async () => {
    const { identity, publicKey } = await makeIdentity("did:mf:luna");
    const registry = createInMemoryRegistry();
    registry.add({ id: "did:mf:luna", network: "metafactory", public_key: publicKey, type: "agent", created_at: "2026-05-07T00:00:00Z" });
    const bid = await signBidResponse({ task_id: "t1", bidder: "did:mf:luna", load: 0.2, capability_match: 0.9 }, identity);
    bid.bidder = "did:mf:fern";
    const result = await verifyBidResponse(bid, registry);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/mismatch/);
  });
});
