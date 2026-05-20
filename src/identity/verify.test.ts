import { describe, it, expect } from "bun:test";
import { getPublicKeyAsync, signAsync } from "@noble/ed25519";
import { createEnvelope } from "../envelope";
import type { CreateEnvelopeInput, MyelinEnvelope } from "../types";
import { signEnvelope } from "./sign";
import { canonicalizeForSigning } from "./canonicalize";
import { verifyEnvelopeIdentity, requireVerifiedIdentity } from "./verify";
import { createInMemoryRegistry } from "./registry";
import type { Identity } from "./types";

const validInput: CreateEnvelopeInput = {
  source: "metafactory.echo.local",
  type: "test.identity.verify",
  sovereignty: {
    classification: "local",
    data_residency: "CH",
    max_hop: 0,
    frontier_ok: false,
    model_class: "local-only",
  },
  payload: { message: "hello" },
};

async function makeKeypair() {
  const seed = crypto.getRandomValues(new Uint8Array(32));
  const privateKey = Buffer.from(seed).toString("base64");
  const publicKey = Buffer.from(await getPublicKeyAsync(seed)).toString("base64");
  return { privateKey, publicKey };
}

function makePrincipal(publicKey: string, overrides: Partial<Identity> = {}): Identity {
  return {
    id: "did:mf:echo",
    operator: "metafactory",
    public_key: publicKey,
    type: "agent",
    created_at: "2026-05-07T00:00:00Z",
    ...overrides,
  };
}

describe("verifyEnvelopeIdentity — ed25519", () => {
  it("verifies a correctly signed envelope", async () => {
    const { privateKey, publicKey } = await makeKeypair();
    const registry = createInMemoryRegistry();
    registry.add(makePrincipal(publicKey));

    const envelope = createEnvelope(validInput);
    const signed = await signEnvelope(envelope, privateKey, "did:mf:echo");
    const result = await verifyEnvelopeIdentity(signed, registry);

    expect(result.status).toBe("verified");
    if (result.status === "verified") {
      expect(result.principal.id).toBe("did:mf:echo");
      expect(result.method).toBe("ed25519");
    }
  });

  it("rejects tampered payload", async () => {
    const { privateKey, publicKey } = await makeKeypair();
    const registry = createInMemoryRegistry();
    registry.add(makePrincipal(publicKey));

    const envelope = createEnvelope(validInput);
    const signed = await signEnvelope(envelope, privateKey, "did:mf:echo");

    const tampered = { ...signed, payload: { message: "tampered" } };
    const result = await verifyEnvelopeIdentity(tampered, registry);

    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.reason).toContain("verification failed");
    }
  });

  it("rejects unknown principal", async () => {
    const { privateKey } = await makeKeypair();
    const registry = createInMemoryRegistry();

    const envelope = createEnvelope(validInput);
    const signed = await signEnvelope(envelope, privateKey, "did:mf:echo");
    const result = await verifyEnvelopeIdentity(signed, registry);

    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.reason).toContain("unknown principal");
    }
  });

  it("rejects wrong public key", async () => {
    const { privateKey } = await makeKeypair();
    const { publicKey: wrongKey } = await makeKeypair();
    const registry = createInMemoryRegistry();
    registry.add(makePrincipal(wrongKey));

    const envelope = createEnvelope(validInput);
    const signed = await signEnvelope(envelope, privateKey, "did:mf:echo");
    const result = await verifyEnvelopeIdentity(signed, registry);

    expect(result.status).toBe("rejected");
  });
});

describe("verifyEnvelopeIdentity — missing signed_by", () => {
  it("rejects unsigned envelope (strict mode)", async () => {
    const registry = createInMemoryRegistry();
    const envelope = createEnvelope(validInput);
    const result = await verifyEnvelopeIdentity(envelope, registry);

    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.reason).toContain("missing signed_by");
    }
  });
});

describe("verifyEnvelopeIdentity — hub-stamp", () => {
  async function makeHubStampedEnvelope(hubPrivateKey: Uint8Array) {
    const envelope = createEnvelope(validInput);
    const signedByWithoutSig = {
      method: "hub-stamp" as const,
      principal: "did:mf:echo",
      stamped_by: "did:mf:hub.metafactory",
      at: new Date().toISOString(),
    };
    // myelin#31 — chain form, length 1: bytes signed are the canonical of
    // envelope with signed_by:[stamp-sans-signature].
    const envelopeForSigning = {
      ...envelope,
      signed_by: [{ ...signedByWithoutSig, signature: "" }],
    };
    const message = canonicalizeForSigning(envelopeForSigning);
    const sig = await signAsync(message, hubPrivateKey);
    return {
      ...envelope,
      signed_by: [{ ...signedByWithoutSig, signature: Buffer.from(sig).toString("base64") }],
    };
  }

  it("verifies hub-stamp from trusted hub with valid signature", async () => {
    const hubSeed = crypto.getRandomValues(new Uint8Array(32));
    const hubPublicKey = Buffer.from(await getPublicKeyAsync(hubSeed)).toString("base64");
    const agentKey = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");

    const registry = createInMemoryRegistry();
    registry.add(makePrincipal(agentKey));
    registry.add(makePrincipal(hubPublicKey, {
      id: "did:mf:hub.metafactory",
      type: "operator",
      is_hub: true,
    }));

    const stamped = await makeHubStampedEnvelope(hubSeed);
    const result = await verifyEnvelopeIdentity(stamped, registry);
    expect(result.status).toBe("verified");
    if (result.status === "verified") {
      expect(result.method).toBe("hub-stamp");
    }
  });

  it("rejects hub-stamp from untrusted hub", async () => {
    const hubSeed = crypto.getRandomValues(new Uint8Array(32));
    const agentKey = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");

    const registry = createInMemoryRegistry();
    registry.add(makePrincipal(agentKey));

    const stamped = await makeHubStampedEnvelope(hubSeed);
    const result = await verifyEnvelopeIdentity(stamped, registry);
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.reason).toContain("untrusted hub");
    }
  });
});

describe("verifyEnvelopeIdentity — input validation", () => {
  it("rejects malformed signed_by.at timestamp", async () => {
    const { publicKey } = await makeKeypair();
    const registry = createInMemoryRegistry();
    registry.add(makePrincipal(publicKey));

    const envelope = createEnvelope(validInput);
    const bad: MyelinEnvelope = {
      ...envelope,
      signed_by: [
        {
          method: "ed25519",
          principal: "did:mf:echo",
          signature: "A".repeat(88),
          at: "not-a-date",
        },
      ],
    };
    const result = await verifyEnvelopeIdentity(bad, registry);
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.reason).toContain("invalid signed_by.at");
    }
  });

  it("rejects empty signed_by.at", async () => {
    const { publicKey } = await makeKeypair();
    const registry = createInMemoryRegistry();
    registry.add(makePrincipal(publicKey));

    const envelope = createEnvelope(validInput);
    const bad: MyelinEnvelope = {
      ...envelope,
      signed_by: [
        {
          method: "ed25519",
          principal: "did:mf:echo",
          signature: "A".repeat(88),
          at: "",
        },
      ],
    };
    const result = await verifyEnvelopeIdentity(bad, registry);
    expect(result.status).toBe("rejected");
  });

  it("rejects wrong-length ed25519 signature", async () => {
    const { publicKey } = await makeKeypair();
    const registry = createInMemoryRegistry();
    registry.add(makePrincipal(publicKey));

    const envelope = createEnvelope(validInput);
    const bad: MyelinEnvelope = {
      ...envelope,
      signed_by: [
        {
          method: "ed25519",
          principal: "did:mf:echo",
          signature: Buffer.from("short").toString("base64"),
          at: new Date().toISOString(),
        },
      ],
    };
    const result = await verifyEnvelopeIdentity(bad, registry);
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.reason).toContain("64 bytes");
    }
  });

  it("rejects wrong-length public key in registry", async () => {
    const registry = createInMemoryRegistry();
    registry.add({
      ...makePrincipal("AAAA"),
      public_key: Buffer.from("short-key").toString("base64"),
    });

    const { privateKey } = await makeKeypair();
    const envelope = createEnvelope(validInput);
    const signed = await signEnvelope(envelope, privateKey, "did:mf:echo");
    const result = await verifyEnvelopeIdentity(signed, registry);

    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.reason).toContain("32 bytes");
    }
  });
});

describe("verifyEnvelopeIdentity — clock skew", () => {
  it("rejects envelope with timestamp outside tolerance", async () => {
    const { privateKey, publicKey } = await makeKeypair();
    const registry = createInMemoryRegistry();
    registry.add(makePrincipal(publicKey));

    const envelope = createEnvelope(validInput);
    const signed = await signEnvelope(envelope, privateKey, "did:mf:echo");

    const stale: MyelinEnvelope = {
      ...signed,
      signed_by: [{ ...signed.signed_by![0], at: "2020-01-01T00:00:00Z" }],
    };
    const result = await verifyEnvelopeIdentity(stale, registry);

    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.reason).toContain("timestamp outside tolerance");
    }
  });

  it("accepts envelope within custom tolerance", async () => {
    const { privateKey, publicKey } = await makeKeypair();
    const registry = createInMemoryRegistry();
    registry.add(makePrincipal(publicKey));

    const envelope = createEnvelope(validInput);
    const signed = await signEnvelope(envelope, privateKey, "did:mf:echo");
    const result = await verifyEnvelopeIdentity(signed, registry, { clockSkewMs: 60_000 });

    expect(result.status).toBe("verified");
  });
});

describe("requireVerifiedIdentity", () => {
  it("returns principal on success", async () => {
    const { privateKey, publicKey } = await makeKeypair();
    const registry = createInMemoryRegistry();
    registry.add(makePrincipal(publicKey));

    const envelope = createEnvelope(validInput);
    const signed = await signEnvelope(envelope, privateKey, "did:mf:echo");
    const principal = await requireVerifiedIdentity(signed, registry);

    expect(principal.id).toBe("did:mf:echo");
  });

  it("throws on unsigned envelope", async () => {
    const registry = createInMemoryRegistry();
    const envelope = createEnvelope(validInput);

    await expect(requireVerifiedIdentity(envelope, registry)).rejects.toThrow("Identity verification failed");
  });
});
