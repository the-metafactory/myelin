import { describe, it, expect } from "bun:test";
import { getPublicKeyAsync } from "@noble/ed25519";
import { createEnvelope, validateEnvelope } from "../envelope";
import type { CreateEnvelopeInput } from "../types";
import { signEnvelope } from "./sign";
import { verifyEnvelopeIdentity } from "./verify";
import { createInMemoryRegistry } from "./registry";

describe("identity integration — end-to-end", () => {
  async function makeKeypair() {
    const seed = crypto.getRandomValues(new Uint8Array(32));
    const privateKey = Buffer.from(seed).toString("base64");
    const publicKey = Buffer.from(await getPublicKeyAsync(seed)).toString("base64");
    return { privateKey, publicKey };
  }

  const input: CreateEnvelopeInput = {
    source: "metafactory.echo.local",
    type: "test.integration.verify",
    sovereignty: {
      classification: "local",
      data_residency: "CH",
      max_hop: 0,
      frontier_ok: false,
      model_class: "local-only",
    },
    payload: { test: "integration", round_trip: true },
  };

  it("create → sign → validate → verify round-trip", async () => {
    const { privateKey, publicKey } = await makeKeypair();

    const registry = createInMemoryRegistry();
    registry.add({
      id: "did:mf:echo",
      operator: "metafactory",
      public_key: publicKey,
      type: "agent",
      created_at: "2026-05-07T00:00:00Z",
    });

    const envelope = createEnvelope(input);
    expect(validateEnvelope(envelope).valid).toBe(true);

    const signed = await signEnvelope(envelope, privateKey, "did:mf:echo");
    expect(signed.signed_by).toBeDefined();
    expect(signed.signed_by![0].method).toBe("ed25519");

    const validationResult = validateEnvelope(signed);
    expect(validationResult.valid).toBe(true);

    const verifyResult = await verifyEnvelopeIdentity(signed, registry);
    expect(verifyResult.status).toBe("verified");
    if (verifyResult.status === "verified") {
      expect(verifyResult.principal.id).toBe("did:mf:echo");
      expect(verifyResult.method).toBe("ed25519");
    }
  });

  it("tampered payload detected across full pipeline", async () => {
    const { privateKey, publicKey } = await makeKeypair();

    const registry = createInMemoryRegistry();
    registry.add({
      id: "did:mf:echo",
      operator: "metafactory",
      public_key: publicKey,
      type: "agent",
      created_at: "2026-05-07T00:00:00Z",
    });

    const envelope = createEnvelope(input);
    const signed = await signEnvelope(envelope, privateKey, "did:mf:echo");

    const tampered = { ...signed, payload: { test: "tampered" } };
    const result = await verifyEnvelopeIdentity(tampered, registry);
    expect(result.status).toBe("rejected");
  });

  it("multi-agent scenario — two agents, correct verification", async () => {
    const echoKeys = await makeKeypair();
    const lunaKeys = await makeKeypair();

    const registry = createInMemoryRegistry();
    registry.add({
      id: "did:mf:echo",
      operator: "metafactory",
      public_key: echoKeys.publicKey,
      type: "agent",
      created_at: "2026-05-07T00:00:00Z",
    });
    registry.add({
      id: "did:mf:luna",
      operator: "metafactory",
      public_key: lunaKeys.publicKey,
      type: "agent",
      created_at: "2026-05-07T00:00:00Z",
    });

    const echoEnvelope = createEnvelope({ ...input, source: "metafactory.echo.local" });
    const echoSigned = await signEnvelope(echoEnvelope, echoKeys.privateKey, "did:mf:echo");
    const echoResult = await verifyEnvelopeIdentity(echoSigned, registry);
    expect(echoResult.status).toBe("verified");
    if (echoResult.status === "verified") {
      expect(echoResult.principal.id).toBe("did:mf:echo");
    }

    const lunaEnvelope = createEnvelope({ ...input, source: "metafactory.luna.local" });
    const lunaSigned = await signEnvelope(lunaEnvelope, lunaKeys.privateKey, "did:mf:luna");
    const lunaResult = await verifyEnvelopeIdentity(lunaSigned, registry);
    expect(lunaResult.status).toBe("verified");
    if (lunaResult.status === "verified") {
      expect(lunaResult.principal.id).toBe("did:mf:luna");
    }
  });
});
