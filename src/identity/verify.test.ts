import { describe, it, expect } from "bun:test";
import { getPublicKeyAsync } from "@noble/ed25519";
import { createEnvelope } from "../envelope";
import type { CreateEnvelopeInput } from "../types";
import { signEnvelope } from "./sign";
import { verifyEnvelopeIdentity, requireVerifiedIdentity } from "./verify";
import { createInMemoryRegistry } from "./registry";
import type { Principal } from "./types";

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

function makePrincipal(publicKey: string, overrides: Partial<Principal> = {}): Principal {
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
  it("verifies hub-stamp from trusted hub", async () => {
    const { publicKey } = await makeKeypair();
    const registry = createInMemoryRegistry();
    registry.add(makePrincipal(publicKey));
    registry.add(makePrincipal(publicKey, {
      id: "did:mf:hub.metafactory",
      type: "operator",
      is_hub: true,
    }));

    const envelope = createEnvelope(validInput);
    const stamped = {
      ...envelope,
      signed_by: {
        method: "hub-stamp" as const,
        principal: "did:mf:echo",
        stamped_by: "did:mf:hub.metafactory",
        at: new Date().toISOString(),
      },
    };

    const result = await verifyEnvelopeIdentity(stamped, registry);
    expect(result.status).toBe("verified");
    if (result.status === "verified") {
      expect(result.method).toBe("hub-stamp");
    }
  });

  it("rejects hub-stamp from untrusted hub", async () => {
    const { publicKey } = await makeKeypair();
    const registry = createInMemoryRegistry();
    registry.add(makePrincipal(publicKey));

    const envelope = createEnvelope(validInput);
    const stamped = {
      ...envelope,
      signed_by: {
        method: "hub-stamp" as const,
        principal: "did:mf:echo",
        stamped_by: "did:mf:rogue.hub",
        at: new Date().toISOString(),
      },
    };

    const result = await verifyEnvelopeIdentity(stamped, registry);
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.reason).toContain("untrusted hub");
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

    const stale = {
      ...signed,
      signed_by: { ...signed.signed_by!, at: "2020-01-01T00:00:00Z" },
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
