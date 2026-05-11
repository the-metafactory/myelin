import { describe, it, expect } from "bun:test";
import { getPublicKeyAsync, utils } from "@noble/ed25519";
import { createEnvelope, validateEnvelope } from "../envelope";
import type { CreateEnvelopeInput, MyelinEnvelope } from "../types";
import { signEnvelope } from "./sign";
import { verifyEnvelopeIdentity, requireVerifiedIdentity } from "./verify";
import { createInMemoryRegistry } from "./registry";
import {
  toSignedByChain,
  getSignedByChain,
  normalizeSignedBy,
} from "./chain";
import type { Principal } from "./types";

const validInput: CreateEnvelopeInput = {
  source: "metafactory.echo.local",
  type: "test.identity.chain",
  sovereignty: {
    classification: "local",
    data_residency: "CH",
    max_hop: 0,
    frontier_ok: false,
    model_class: "local-only",
  },
  payload: { message: "chain-of-stamps test" },
};

async function makeKeypair() {
  const seed = utils.randomSecretKey();
  const privateKey = Buffer.from(seed).toString("base64");
  const publicKey = Buffer.from(await getPublicKeyAsync(seed)).toString("base64");
  return { privateKey, publicKey };
}

function makePrincipal(id: string, publicKey: string, overrides: Partial<Principal> = {}): Principal {
  return {
    id,
    operator: "metafactory",
    public_key: publicKey,
    type: "agent",
    created_at: "2026-05-07T00:00:00Z",
    ...overrides,
  };
}

describe("chain helpers — toSignedByChain", () => {
  it("returns [] for undefined / null", () => {
    expect(toSignedByChain(undefined)).toEqual([]);
    expect(toSignedByChain(null)).toEqual([]);
  });

  it("wraps a single SignedBy object into a one-element chain", () => {
    const stamp = { method: "ed25519", principal: "did:mf:echo", signature: "x", at: "2026-05-10T00:00:00Z" };
    expect(toSignedByChain(stamp)).toEqual([stamp as never]);
  });

  it("returns the array unchanged", () => {
    const chain = [
      { method: "ed25519", principal: "did:mf:echo", signature: "x", at: "2026-05-10T00:00:00Z" },
      { method: "ed25519", principal: "did:mf:luna", signature: "y", at: "2026-05-10T00:00:01Z" },
    ];
    expect(toSignedByChain(chain)).toEqual(chain as never);
  });
});

describe("chain helpers — normalizeSignedBy", () => {
  it("is a no-op for unsigned envelopes", () => {
    const env = createEnvelope(validInput);
    const normalized = normalizeSignedBy(env);
    expect(normalized).toBe(env); // same reference — true no-op
  });

  it("coerces single-object back-compat shim into one-element chain", () => {
    const env = createEnvelope(validInput);
    // Simulate a wire envelope arriving with the legacy single-object form.
    const wireForm = {
      ...env,
      signed_by: { method: "ed25519", principal: "did:mf:echo", signature: "x", at: "2026-05-10T00:00:00Z" },
    } as unknown as MyelinEnvelope;
    const normalized = normalizeSignedBy(wireForm);
    expect(Array.isArray(normalized.signed_by)).toBe(true);
    expect(normalized.signed_by).toHaveLength(1);
    expect(normalized.signed_by![0]!.principal).toBe("did:mf:echo");
  });

  it("leaves array form unchanged", () => {
    const chain = [{ method: "ed25519" as const, principal: "did:mf:echo", signature: "x", at: "2026-05-10T00:00:00Z" }];
    const env: MyelinEnvelope = { ...createEnvelope(validInput), signed_by: chain };
    const normalized = normalizeSignedBy(env);
    expect(normalized.signed_by).toEqual(chain);
  });
});

describe("validator — accepts both single-object and array shapes (back-compat shim)", () => {
  it("accepts a single-object signed_by (legacy wire form)", () => {
    const env = {
      ...createEnvelope(validInput),
      signed_by: {
        method: "ed25519",
        principal: "did:mf:echo",
        signature: "A".repeat(88),
        at: "2026-05-10T00:00:00Z",
      },
    };
    const result = validateEnvelope(env);
    expect(result.valid).toBe(true);
  });

  it("accepts a multi-stamp chain", () => {
    const env: MyelinEnvelope = {
      ...createEnvelope(validInput),
      signed_by: [
        { method: "ed25519", principal: "did:mf:echo", signature: "A".repeat(88), at: "2026-05-10T00:00:00Z" },
        { method: "ed25519", principal: "did:mf:luna", signature: "A".repeat(88), at: "2026-05-10T00:00:01Z" },
      ],
    };
    expect(validateEnvelope(env).valid).toBe(true);
  });

  it("rejects an empty chain", () => {
    const env: MyelinEnvelope = { ...createEnvelope(validInput), signed_by: [] };
    const result = validateEnvelope(env);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "signed_by")).toBe(true);
  });

  it("rejects a chain that exceeds MAX_CHAIN_LENGTH", () => {
    const stamp = { method: "ed25519" as const, principal: "did:mf:echo", signature: "A".repeat(88), at: "2026-05-10T00:00:00Z" };
    const longChain = Array.from({ length: 17 }, () => ({ ...stamp }));
    const env: MyelinEnvelope = { ...createEnvelope(validInput), signed_by: longChain };
    const result = validateEnvelope(env);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "signed_by" && e.message.includes("exceeds maximum"))).toBe(true);
  });

  it("validates each stamp in the chain (positional error path)", () => {
    const env: MyelinEnvelope = {
      ...createEnvelope(validInput),
      signed_by: [
        { method: "ed25519", principal: "did:mf:echo", signature: "A".repeat(88), at: "2026-05-10T00:00:00Z" },
        { method: "ed25519", principal: "bad-did", signature: "A".repeat(88), at: "2026-05-10T00:00:01Z" },
      ],
    };
    const result = validateEnvelope(env);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "signed_by[1].principal")).toBe(true);
  });

  it("accepts a stamp with a valid role", () => {
    const env: MyelinEnvelope = {
      ...createEnvelope(validInput),
      signed_by: [
        {
          method: "ed25519",
          principal: "did:mf:echo",
          signature: "A".repeat(88),
          at: "2026-05-10T00:00:00Z",
          role: "accountability",
        },
      ],
    };
    expect(validateEnvelope(env).valid).toBe(true);
  });

  it("rejects a stamp with an unknown role", () => {
    const env: MyelinEnvelope = {
      ...createEnvelope(validInput),
      signed_by: [
        {
          method: "ed25519",
          principal: "did:mf:echo",
          signature: "A".repeat(88),
          at: "2026-05-10T00:00:00Z",
          role: "bogus-role" as never,
        },
      ],
    };
    const result = validateEnvelope(env);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "signed_by[0].role")).toBe(true);
  });
});

describe("signEnvelope — chain-append (myelin#31)", () => {
  it("produces a one-element chain on first sign", async () => {
    const { privateKey } = await makeKeypair();
    const env = createEnvelope(validInput);
    const signed = await signEnvelope(env, privateKey, "did:mf:echo");
    expect(signed.signed_by).toHaveLength(1);
    expect(signed.signed_by![0]!.principal).toBe("did:mf:echo");
  });

  it("appends a second stamp without altering the first signature", async () => {
    const k1 = await makeKeypair();
    const k2 = await makeKeypair();
    const env = createEnvelope(validInput);
    const first = await signEnvelope(env, k1.privateKey, "did:mf:echo");
    const second = await signEnvelope(first, k2.privateKey, "did:mf:luna");
    expect(second.signed_by).toHaveLength(2);
    // First stamp's signature is preserved bit-for-bit.
    expect(second.signed_by![0]!.signature).toBe(first.signed_by![0]!.signature);
    expect(second.signed_by![1]!.principal).toBe("did:mf:luna");
  });

  it("records role when provided", async () => {
    const { privateKey } = await makeKeypair();
    const env = createEnvelope(validInput);
    const signed = await signEnvelope(env, privateKey, "did:mf:echo", { role: "origin" });
    expect(signed.signed_by![0]!.role).toBe("origin");
  });

  it("omits role when not provided", async () => {
    const { privateKey } = await makeKeypair();
    const signed = await signEnvelope(createEnvelope(validInput), privateKey, "did:mf:echo");
    expect(signed.signed_by![0]!.role).toBeUndefined();
  });
});

describe("verifyEnvelopeIdentity — chain semantics", () => {
  it("verifies a two-stamp chain end-to-end", async () => {
    const k1 = await makeKeypair();
    const k2 = await makeKeypair();
    const registry = createInMemoryRegistry();
    registry.add(makePrincipal("did:mf:echo", k1.publicKey));
    registry.add(makePrincipal("did:mf:luna", k2.publicKey));

    const env = createEnvelope(validInput);
    const first = await signEnvelope(env, k1.privateKey, "did:mf:echo", { role: "origin" });
    const second = await signEnvelope(first, k2.privateKey, "did:mf:luna", { role: "accountability" });

    const result = await verifyEnvelopeIdentity(second, registry);
    expect(result.status).toBe("verified");
    if (result.status === "verified") {
      expect(result.chain).toHaveLength(2);
      expect(result.chain.every((v) => v.valid)).toBe(true);
      expect(result.chain[0]!.principal!.id).toBe("did:mf:echo");
      expect(result.chain[1]!.principal!.id).toBe("did:mf:luna");
      // Convenience handle = last verified principal.
      expect(result.principal.id).toBe("did:mf:luna");
    }
  });

  it("rejects when stamp 0 is tampered (chain invalidates everything downstream)", async () => {
    const k1 = await makeKeypair();
    const k2 = await makeKeypair();
    const registry = createInMemoryRegistry();
    registry.add(makePrincipal("did:mf:echo", k1.publicKey));
    registry.add(makePrincipal("did:mf:luna", k2.publicKey));

    const env = createEnvelope(validInput);
    const first = await signEnvelope(env, k1.privateKey, "did:mf:echo");
    const second = await signEnvelope(first, k2.privateKey, "did:mf:luna");

    // Tamper with stamp 0's signature.
    const tamperedSig = Buffer.from(new Uint8Array(64).fill(0)).toString("base64");
    const tampered: MyelinEnvelope = {
      ...second,
      signed_by: [{ ...second.signed_by![0]!, signature: tamperedSig }, second.signed_by![1]!],
    };
    const result = await verifyEnvelopeIdentity(tampered, registry);
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      // The walker reports the FIRST failing stamp.
      expect(result.reason).toContain("stamp[0]");
      expect(result.chain).toBeDefined();
      expect(result.chain![0]!.valid).toBe(false);
    }
  });

  it("rejects when envelope body is tampered (every stamp fails)", async () => {
    const k1 = await makeKeypair();
    const k2 = await makeKeypair();
    const registry = createInMemoryRegistry();
    registry.add(makePrincipal("did:mf:echo", k1.publicKey));
    registry.add(makePrincipal("did:mf:luna", k2.publicKey));

    const env = createEnvelope(validInput);
    const first = await signEnvelope(env, k1.privateKey, "did:mf:echo");
    const second = await signEnvelope(first, k2.privateKey, "did:mf:luna");

    const tampered: MyelinEnvelope = { ...second, payload: { message: "tampered body" } };
    const result = await verifyEnvelopeIdentity(tampered, registry);
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      // Stamp 0 fails first because the canonical bytes don't match.
      expect(result.reason).toContain("stamp[0]");
    }
  });

  it("verifies a single-stamp envelope (back-compat shape, array form)", async () => {
    const { privateKey, publicKey } = await makeKeypair();
    const registry = createInMemoryRegistry();
    registry.add(makePrincipal("did:mf:echo", publicKey));

    const signed = await signEnvelope(createEnvelope(validInput), privateKey, "did:mf:echo");
    const result = await verifyEnvelopeIdentity(signed, registry);
    expect(result.status).toBe("verified");
    if (result.status === "verified") {
      expect(result.chain).toHaveLength(1);
    }
  });

  it("rejects an empty chain array", async () => {
    const registry = createInMemoryRegistry();
    const env: MyelinEnvelope = { ...createEnvelope(validInput), signed_by: [] };
    const result = await verifyEnvelopeIdentity(env, registry);
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.reason).toContain("empty");
    }
  });

  it("rejects mid-chain principal unknown to registry", async () => {
    const k1 = await makeKeypair();
    const k2 = await makeKeypair();
    const registry = createInMemoryRegistry();
    registry.add(makePrincipal("did:mf:echo", k1.publicKey));
    // luna NOT in registry

    const env = createEnvelope(validInput);
    const first = await signEnvelope(env, k1.privateKey, "did:mf:echo");
    const second = await signEnvelope(first, k2.privateKey, "did:mf:luna");

    const result = await verifyEnvelopeIdentity(second, registry);
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.reason).toContain("stamp[1]");
      expect(result.reason).toContain("unknown principal");
    }
  });
});

describe("requireVerifiedIdentity — chain-shape predicates", () => {
  async function setupTwoStampChain() {
    const k1 = await makeKeypair();
    const k2 = await makeKeypair();
    const registry = createInMemoryRegistry();
    registry.add(makePrincipal("did:mf:echo", k1.publicKey, { type: "agent" }));
    registry.add(
      makePrincipal("did:mf:hub.metafactory", k2.publicKey, { type: "operator", is_hub: true }),
    );
    const env = createEnvelope(validInput);
    const first = await signEnvelope(env, k1.privateKey, "did:mf:echo", { role: "origin" });
    const second = await signEnvelope(first, k2.privateKey, "did:mf:hub.metafactory", {
      role: "accountability",
    });
    return { registry, envelope: second };
  }

  it("returns the LAST verified principal", async () => {
    const { registry, envelope } = await setupTwoStampChain();
    const principal = await requireVerifiedIdentity(envelope, registry);
    expect(principal.id).toBe("did:mf:hub.metafactory");
  });

  it("accepts mustIncludeRole when the role appears in chain", async () => {
    const { registry, envelope } = await setupTwoStampChain();
    const principal = await requireVerifiedIdentity(envelope, registry, {
      mustIncludeRole: "accountability",
    });
    expect(principal.id).toBe("did:mf:hub.metafactory");
  });

  it("rejects mustIncludeRole when the role is missing", async () => {
    const { registry, envelope } = await setupTwoStampChain();
    await expect(
      requireVerifiedIdentity(envelope, registry, { mustIncludeRole: "notary" }),
    ).rejects.toThrow(/does not include role=notary/);
  });

  it("accepts mustIncludePrincipalType when present", async () => {
    const { registry, envelope } = await setupTwoStampChain();
    await expect(
      requireVerifiedIdentity(envelope, registry, { mustIncludePrincipalType: "operator" }),
    ).resolves.toBeDefined();
  });

  it("rejects mustIncludePrincipalType when absent", async () => {
    const { registry, envelope } = await setupTwoStampChain();
    await expect(
      requireVerifiedIdentity(envelope, registry, { mustIncludePrincipalType: "service" }),
    ).rejects.toThrow(/does not include principal of type=service/);
  });

  it("accepts mustIncludePrincipal when present", async () => {
    const { registry, envelope } = await setupTwoStampChain();
    await expect(
      requireVerifiedIdentity(envelope, registry, { mustIncludePrincipal: "did:mf:echo" }),
    ).resolves.toBeDefined();
  });

  it("rejects mustIncludePrincipal when absent", async () => {
    const { registry, envelope } = await setupTwoStampChain();
    await expect(
      requireVerifiedIdentity(envelope, registry, { mustIncludePrincipal: "did:mf:rogue" }),
    ).rejects.toThrow(/does not include principal=did:mf:rogue/);
  });

  it("rejects minLength when chain is too short", async () => {
    const { privateKey, publicKey } = await makeKeypair();
    const registry = createInMemoryRegistry();
    registry.add(makePrincipal("did:mf:echo", publicKey));
    const signed = await signEnvelope(createEnvelope(validInput), privateKey, "did:mf:echo");
    await expect(
      requireVerifiedIdentity(signed, registry, { minLength: 2 }),
    ).rejects.toThrow(/chain length 1 < required 2/);
  });
});

describe("back-compat — single-object wire form normalizes for verification", () => {
  it("verifies an envelope arriving over the wire as a single signed_by object", async () => {
    const { privateKey, publicKey } = await makeKeypair();
    const registry = createInMemoryRegistry();
    registry.add(makePrincipal("did:mf:echo", publicKey));
    const signed = await signEnvelope(createEnvelope(validInput), privateKey, "did:mf:echo");
    // Simulate the wire-form transformation: the appended stamp arrives as a
    // single object instead of a one-element array.
    const wire = { ...signed, signed_by: signed.signed_by![0] } as unknown as MyelinEnvelope;
    const result = await verifyEnvelopeIdentity(wire, registry);
    expect(result.status).toBe("verified");
  });
});

describe("getSignedByChain — runtime accessor", () => {
  it("returns [] for unsigned envelope", () => {
    expect(getSignedByChain(createEnvelope(validInput))).toEqual([]);
  });

  it("returns chain for array form", () => {
    const env: MyelinEnvelope = {
      ...createEnvelope(validInput),
      signed_by: [
        { method: "ed25519", principal: "did:mf:echo", signature: "x", at: "2026-05-10T00:00:00Z" },
      ],
    };
    expect(getSignedByChain(env)).toHaveLength(1);
  });

  it("coerces single-object back-compat wire shape", () => {
    const env = {
      ...createEnvelope(validInput),
      signed_by: { method: "ed25519", principal: "did:mf:echo", signature: "x", at: "2026-05-10T00:00:00Z" },
    } as unknown as MyelinEnvelope;
    const chain = getSignedByChain(env);
    expect(chain).toHaveLength(1);
    expect(chain[0]!.principal).toBe("did:mf:echo");
  });
});
