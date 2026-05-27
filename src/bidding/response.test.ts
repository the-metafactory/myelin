import { describe, it, expect } from "bun:test";
import { utils, getPublicKeyAsync, signAsync } from "@noble/ed25519";
import { signBidResponse, verifyBidResponse } from "./response";
import { createInMemoryRegistry } from "../identity/registry";
import type { SigningIdentity } from "../identity/types";
import type { BidResponse } from "./types";
import { canonicalStringify } from "../jcs";
import { bytesFromBase64 } from "../base64";

function bytesToBase64(b: Uint8Array): string {
  return Buffer.from(b).toString("base64");
}

/**
 * Test helper — build a {@link BidResponse} stamped with the deprecated
 * `signed_by.principal` key (pre-myelin#182 wire shape) so the rejection
 * regression test can assert the validator refuses it.
 */
async function signWithDeprecatedPrincipal(
  input: { task_id: string; bidder: string; load: number; capability_match: number },
  identity: SigningIdentity,
  at: string,
): Promise<BidResponse> {
  const stamp = { method: "ed25519" as const, principal: identity.did, signature: "", at };
  const { signature: _drop, ...stampForSigning } = stamp;
  void _drop;
  const bytes = new TextEncoder().encode(
    canonicalStringify({
      task_id: input.task_id,
      bidder: input.bidder,
      load: input.load,
      capability_match: input.capability_match,
      signed_by: stampForSigning,
    }),
  );
  const sig = await signAsync(bytes, bytesFromBase64(identity.privateKey));
  return {
    task_id: input.task_id,
    bidder: input.bidder,
    load: input.load,
    capability_match: input.capability_match,
    signed_by: { ...stamp, signature: bytesToBase64(sig) } as unknown as BidResponse["signed_by"],
  };
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

  // myelin#182 — R2 breaking cut. Bids carrying the deprecated `principal`
  // stamp key are rejected at the trust boundary.
  it("rejects a pre-migration bid signed with the deprecated `principal` key", async () => {
    const { identity, publicKey } = await makeIdentity("did:mf:luna");
    const registry = createInMemoryRegistry();
    registry.add({ id: "did:mf:luna", network: "metafactory", public_key: publicKey, type: "agent", created_at: "2026-05-07T00:00:00Z" });
    const oldForm = await signWithDeprecatedPrincipal(
      { task_id: "t1", bidder: "did:mf:luna", load: 0.2, capability_match: 0.9 },
      identity,
      new Date().toISOString(),
    );
    const result = await verifyBidResponse(oldForm, registry);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/dropped from the wire/);
  });

  it("rejects a bid carrying BOTH `principal` and `identity` (principal still unknown)", async () => {
    const { identity, publicKey } = await makeIdentity("did:mf:luna");
    const registry = createInMemoryRegistry();
    registry.add({ id: "did:mf:luna", network: "metafactory", public_key: publicKey, type: "agent", created_at: "2026-05-07T00:00:00Z" });
    const bid = await signBidResponse({ task_id: "t1", bidder: "did:mf:luna", load: 0.2, capability_match: 0.9 }, identity);
    // Splice the deprecated `principal` key in alongside the canonical
    // `identity` key — should be refused at the trust boundary.
    (bid.signed_by as unknown as Record<string, unknown>).principal = "did:mf:luna";
    const result = await verifyBidResponse(bid, registry);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/dropped from the wire/);
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
