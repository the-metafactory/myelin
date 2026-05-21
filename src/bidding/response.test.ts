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
    expect(bid.signed_by.identity).toBe("did:mf:luna");
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
    registry.add({ id: "did:mf:luna", operator: "metafactory", public_key: publicKey, type: "agent", created_at: "2026-05-07T00:00:00Z" });
    const bid = await signBidResponse({ task_id: "t1", bidder: "did:mf:luna", load: 0.2, capability_match: 0.9 }, identity);
    const result = await verifyBidResponse(bid, registry);
    expect(result.valid).toBe(true);
  });

  it("rejects unknown principal", async () => {
    const { identity } = await makeIdentity("did:mf:luna");
    const registry = createInMemoryRegistry();
    const bid = await signBidResponse({ task_id: "t1", bidder: "did:mf:luna", load: 0.2, capability_match: 0.9 }, identity);
    const result = await verifyBidResponse(bid, registry);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/unknown principal/);
  });

  it("rejects tampered payload", async () => {
    const { identity, publicKey } = await makeIdentity("did:mf:luna");
    const registry = createInMemoryRegistry();
    registry.add({ id: "did:mf:luna", operator: "metafactory", public_key: publicKey, type: "agent", created_at: "2026-05-07T00:00:00Z" });
    const bid = await signBidResponse({ task_id: "t1", bidder: "did:mf:luna", load: 0.2, capability_match: 0.9 }, identity);
    bid.load = 0.0;
    const result = await verifyBidResponse(bid, registry);
    expect(result.valid).toBe(false);
  });

  it("rejects bidder/principal mismatch", async () => {
    const { identity, publicKey } = await makeIdentity("did:mf:luna");
    const registry = createInMemoryRegistry();
    registry.add({ id: "did:mf:luna", operator: "metafactory", public_key: publicKey, type: "agent", created_at: "2026-05-07T00:00:00Z" });
    const bid = await signBidResponse({ task_id: "t1", bidder: "did:mf:luna", load: 0.2, capability_match: 0.9 }, identity);
    bid.bidder = "did:mf:fern";
    const result = await verifyBidResponse(bid, registry);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/mismatch/);
  });
});
