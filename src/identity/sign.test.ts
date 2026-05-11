import { describe, it, expect } from "bun:test";
import { signEnvelope } from "./sign";
import { validateEnvelope } from "../envelope";
import { getPublicKeyAsync, verifyAsync, utils } from "@noble/ed25519";
import { canonicalizeForSigning } from "./canonicalize";
import type { MyelinEnvelope } from "../types";

function makeTestEnvelope(): MyelinEnvelope {
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    source: "metafactory.echo.local",
    type: "test.identity.verify",
    timestamp: "2026-05-07T12:00:00Z",
    sovereignty: {
      classification: "local",
      data_residency: "CH",
      max_hop: 0,
      frontier_ok: false,
      model_class: "local-only",
    },
    payload: { message: "hello" },
  };
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function fromBase64(str: string): Uint8Array {
  return new Uint8Array(Buffer.from(str, "base64"));
}

describe("signEnvelope", () => {
  it("signs an envelope and produces valid Base64 signature", async () => {
    const privKey = utils.randomSecretKey();
    const privKeyBase64 = toBase64(privKey);
    const envelope = makeTestEnvelope();

    const signed = await signEnvelope(envelope, privKeyBase64, "did:mf:echo");

    expect(signed.signed_by).toBeDefined();
    expect(signed.signed_by).toHaveLength(1);
    expect(signed.signed_by![0]!.method).toBe("ed25519");
    expect(signed.signed_by![0]!.principal).toBe("did:mf:echo");

    // Signature should be valid Base64
    const sig = signed.signed_by![0]!.signature;
    expect(sig.length).toBeGreaterThan(0);
    const sigBytes = fromBase64(sig);
    expect(sigBytes.length).toBe(64); // Ed25519 signatures are 64 bytes
  });

  it("signature verifies with the corresponding public key", async () => {
    const privKey = utils.randomSecretKey();
    const pubKey = await getPublicKeyAsync(privKey);
    const privKeyBase64 = toBase64(privKey);
    const envelope = makeTestEnvelope();

    const signed = await signEnvelope(envelope, privKeyBase64, "did:mf:echo");

    const sig = signed.signed_by![0]!.signature;
    const sigBytes = fromBase64(sig);
    const message = canonicalizeForSigning(signed);
    const valid = await verifyAsync(sigBytes, message, pubKey);
    expect(valid).toBe(true);
  });

  it("appends to the chain when envelope already has signed_by (myelin#31)", async () => {
    const privKey = utils.randomSecretKey();
    const privKeyBase64 = toBase64(privKey);
    const envelope = makeTestEnvelope();

    const first = await signEnvelope(envelope, privKeyBase64, "did:mf:echo");
    const second = await signEnvelope(first, privKeyBase64, "did:mf:echo");

    expect(second.signed_by).toHaveLength(2);
    expect(second.signed_by![0]!.signature).toBe(first.signed_by![0]!.signature);
    expect(second.signed_by![1]!.principal).toBe("did:mf:echo");
  });

  it("does not mutate the original envelope", async () => {
    const privKey = utils.randomSecretKey();
    const privKeyBase64 = toBase64(privKey);
    const envelope = makeTestEnvelope();
    const originalJson = JSON.stringify(envelope);

    await signEnvelope(envelope, privKeyBase64, "did:mf:echo");

    expect(JSON.stringify(envelope)).toBe(originalJson);
  });

  it("signed envelope passes validateEnvelope", async () => {
    const privKey = utils.randomSecretKey();
    const privKeyBase64 = toBase64(privKey);
    const envelope = makeTestEnvelope();

    const signed = await signEnvelope(envelope, privKeyBase64, "did:mf:echo");
    const result = validateEnvelope(signed);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("sets signed_by[0].at to a valid ISO-8601 timestamp", async () => {
    const privKey = utils.randomSecretKey();
    const privKeyBase64 = toBase64(privKey);
    const envelope = makeTestEnvelope();

    const signed = await signEnvelope(envelope, privKeyBase64, "did:mf:echo");

    const at = signed.signed_by![0]!.at;
    // Should parse as a valid date
    const parsed = new Date(at);
    expect(parsed.toISOString()).toBe(at);
  });

  it("returns a new envelope object (immutability)", async () => {
    const privKey = utils.randomSecretKey();
    const privKeyBase64 = toBase64(privKey);
    const envelope = makeTestEnvelope();

    const signed = await signEnvelope(envelope, privKeyBase64, "did:mf:echo");

    expect(signed).not.toBe(envelope);
    expect(signed.signed_by).toBeDefined();
    expect(envelope.signed_by).toBeUndefined();
  });
});
