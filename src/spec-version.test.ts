import { describe, it, expect } from "bun:test";
import { getPublicKeyAsync } from "@noble/ed25519";
import { createEnvelope, validateEnvelope } from "./envelope";
import type { CreateEnvelopeInput, MyelinEnvelope } from "./types";
import { signEnvelope } from "./identity/sign";
import { canonicalizeForSigning } from "./identity/canonicalize";
import { verifyEnvelopeIdentity } from "./identity/verify";
import { createInMemoryRegistry } from "./identity/registry";
import type { Identity } from "./identity/types";

/**
 * B1 (spec_version, Phase 4a — accept-never-emit). Proves the two safety
 * properties the rollout depends on:
 *   (a) an envelope WITHOUT spec_version canonicalizes and verifies EXACTLY as
 *       before the field existed (adding it to SIGNABLE_FIELDS is a no-op for
 *       absent-field envelopes), so pre-change signatures keep verifying;
 *   (b) an envelope WITH spec_version signs + verifies round-trip, and the
 *       field is genuinely under the signature (tamper => reject).
 */

const validInput: CreateEnvelopeInput = {
  source: "metafactory.echo.local",
  type: "test.spec.version",
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

function makeIdentity(publicKey: string): Identity {
  return {
    id: "did:mf:echo",
    network: "metafactory",
    public_key: publicKey,
    type: "agent",
    created_at: "2026-05-07T00:00:00Z",
  };
}

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

/** Keypair + a registry that resolves did:mf:echo to its public key. */
async function makeSignedSetup(): Promise<{ privateKey: string; registry: ReturnType<typeof createInMemoryRegistry> }> {
  const { privateKey, publicKey } = await makeKeypair();
  const registry = createInMemoryRegistry();
  registry.add(makeIdentity(publicKey));
  return { privateKey, registry };
}

describe("spec_version — canonicalization back-compat (property a)", () => {
  it("absent spec_version is not in the canonical payload", () => {
    const envelope = createEnvelope(validInput);
    expect(envelope.spec_version).toBeUndefined();
    expect(decode(canonicalizeForSigning(envelope))).not.toContain("spec_version");
  });

  it("absent-field canonical bytes equal the exact pre-field canonical form", () => {
    // A deterministic envelope with NO spec_version. EXPECTED is the frozen
    // pre-spec_version canonical form (JCS, keys sorted) captured before the
    // field was added to SIGNABLE_FIELDS. If adding `spec_version` ever leaked
    // into an absent-field envelope's canonical bytes, this exact-string
    // equality breaks — and with it every signature ever produced over the old
    // form. This is the byte-identity guarantee the two-phase rollout rests on.
    const fixed: MyelinEnvelope = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      source: "metafactory.echo.local",
      type: "test.spec.version",
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
    const EXPECTED =
      '{"id":"550e8400-e29b-41d4-a716-446655440000","payload":{"message":"hello"},"source":"metafactory.echo.local","sovereignty":{"classification":"local","data_residency":"CH","frontier_ok":false,"max_hop":0,"model_class":"local-only"},"timestamp":"2026-05-07T12:00:00Z","type":"test.spec.version"}';
    expect(decode(canonicalizeForSigning(fixed))).toBe(EXPECTED);
  });

  it("an envelope without spec_version signs and verifies (unchanged behavior)", async () => {
    const { privateKey, registry } = await makeSignedSetup();

    const signed = await signEnvelope(createEnvelope(validInput), privateKey, "did:mf:echo");
    const result = await verifyEnvelopeIdentity(signed, registry);

    expect(result.status).toBe("verified");
  });
});

describe("spec_version — signed round-trip (property b)", () => {
  it("present spec_version IS in the canonical payload", () => {
    const envelope: MyelinEnvelope = { ...createEnvelope(validInput), spec_version: 3 };
    expect(decode(canonicalizeForSigning(envelope))).toContain("spec_version");
  });

  it("an envelope with spec_version signs and verifies round-trip", async () => {
    const { privateKey, registry } = await makeSignedSetup();

    const envelope: MyelinEnvelope = { ...createEnvelope(validInput), spec_version: 3 };
    const signed = await signEnvelope(envelope, privateKey, "did:mf:echo");
    const result = await verifyEnvelopeIdentity(signed, registry);

    expect(result.status).toBe("verified");
  });

  it("tampering spec_version after signing fails verification (it is signed)", async () => {
    const { privateKey, registry } = await makeSignedSetup();

    const envelope: MyelinEnvelope = { ...createEnvelope(validInput), spec_version: 3 };
    const signed = await signEnvelope(envelope, privateKey, "did:mf:echo");

    const tampered = { ...signed, spec_version: 4 };
    const result = await verifyEnvelopeIdentity(tampered, registry);

    expect(result.status).toBe("rejected");
  });
});

describe("spec_version — validation + non-emission", () => {
  it("createEnvelope does NOT emit spec_version (Phase 4a)", () => {
    expect(createEnvelope(validInput).spec_version).toBeUndefined();
  });

  it("accepts a valid spec_version", () => {
    const envelope = { ...createEnvelope(validInput), spec_version: 3 };
    expect(validateEnvelope(envelope).valid).toBe(true);
  });

  it("accepts an absent spec_version", () => {
    expect(validateEnvelope(createEnvelope(validInput)).valid).toBe(true);
  });

  it("rejects a non-integer / < 1 spec_version", () => {
    const bad = { ...createEnvelope(validInput), spec_version: 0 };
    const result = validateEnvelope(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "spec_version")).toBe(true);
  });

  it("accepts (does not reject) a future spec_version", () => {
    const future = { ...createEnvelope(validInput), spec_version: 99 };
    expect(validateEnvelope(future).valid).toBe(true);
  });
});
