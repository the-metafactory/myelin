import { describe, it, expect } from "bun:test";
import { getPublicKeyAsync, signAsync } from "@noble/ed25519";
import { createEnvelope, createSignedEnvelope, validateEnvelope } from "./envelope";
import { canonicalizeForSigning } from "./identity/canonicalize";
import { verifyEnvelopeIdentity } from "./identity/verify";
import { createInMemoryRegistry } from "./identity/registry";
import type { Identity } from "./identity/types";
import type { CreateEnvelopeInput, MyelinEnvelope } from "./types";

/**
 * Cross-version compatibility — the envelope wire transition (vocabulary
 * migration 2026-05, PR-6).
 *
 * PR-6 lands the transition release of the wire-affecting renames R2
 * (`signed_by[].principal`/`originator.principal` → `.identity`), R6
 * (`source` grammar), R11 (`distribution_mode` `broadcast` → `offer`) and
 * R13 (`target_principal` → `target_assistant`). The transition release is
 * NOT the breaking major: the validator/parser MUST accept BOTH the old
 * and the new wire form of every renamed field, signature verification
 * MUST canonicalize against the bytes as received, and a record carrying
 * BOTH the old and new key MUST be rejected with `dual_field_conflict`
 * before any canonicalization.
 *
 * These tests are the rollback safety net and the breaking-major deletion
 * guard mandated by the manifest's JetStream-replay section.
 *
 * myelin#182 — R2 breaking cut. The stamp DID rename (`signed_by[].principal`
 * → `.identity`) has now LEFT the transition window. The R2 stamp section
 * below is the deletion guard: the deprecated `principal` key is rejected
 * on the wire.
 *
 * R13 breaking cut — the routing-target rename (`target_principal` →
 * `target_assistant`) has now LEFT the transition window too. The R13
 * section below is the deletion guard: the deprecated `target_principal`
 * key is rejected on the wire (unknown field). The other R2 fields
 * (originator), R6, and R11 remain in transition.
 */

const validInput: CreateEnvelopeInput = {
  source: "metafactory.echo.local",
  type: "test.envelope.transition",
  sovereignty: {
    classification: "local",
    data_residency: "CH",
    max_hop: 0,
    frontier_ok: false,
    model_class: "local-only",
  },
  payload: { message: "transition" },
};

async function makeKeypair() {
  const seed = crypto.getRandomValues(new Uint8Array(32));
  const privateKey = Buffer.from(seed).toString("base64");
  const publicKey = Buffer.from(await getPublicKeyAsync(seed)).toString("base64");
  return { seed, privateKey, publicKey };
}

function makeIdentity(id: string, publicKey: string): Identity {
  return {
    id,
    network: "metafactory",
    public_key: publicKey,
    type: "agent",
    created_at: "2026-05-07T00:00:00Z",
  };
}

// ---------------------------------------------------------------------------
// R2 — stamp DID field: `signed_by[].principal` → `.identity`
//   Breaking cut completed by myelin#182. The deprecated `principal` key is
//   rejected on the wire; the section below is the deletion guard.
// ---------------------------------------------------------------------------

describe("R2 stamp field — post-myelin#182 (`principal` dropped from wire)", () => {
  it("NEW form: a freshly signed envelope (identity key) validates and verifies", async () => {
    const { privateKey, publicKey } = await makeKeypair();
    const registry = createInMemoryRegistry();
    registry.add(makeIdentity("did:mf:echo", publicKey));

    const env = await createSignedEnvelope(validInput, {
      did: "did:mf:echo",
      privateKey,
    });
    expect(env.signed_by![0].identity).toBe("did:mf:echo");
    expect(validateEnvelope(env).valid).toBe(true);

    const result = await verifyEnvelopeIdentity(env, registry);
    expect(result.status).toBe("verified");
  });

  it("OLD form (principal-only): rejected by the validator", async () => {
    // Construct a stamp whose only DID key is the deprecated `principal`.
    // The literal needs an `unknown` cast because the SignedBy type no
    // longer admits the `principal` key.
    const env = {
      ...createEnvelope(validInput),
      signed_by: [
        {
          method: "ed25519",
          principal: "did:mf:echo",
          signature: "A".repeat(88),
          at: "2026-05-10T00:00:00Z",
        },
      ],
    } as unknown as MyelinEnvelope;

    const result = validateEnvelope(env);
    expect(result.valid).toBe(false);
    // The `principal` key is now reported as an unknown field, and
    // `.identity` is missing.
    expect(
      result.errors.some(
        (e) =>
          e.field === "signed_by[0].principal" &&
          e.message.includes("dropped from the wire"),
      ),
    ).toBe(true);
    expect(result.errors.some((e) => e.field === "signed_by[0].identity")).toBe(true);
  });

  it("OLD form (principal-only, valid signature): rejected before verification", async () => {
    // A pre-migration envelope whose signature commits to the `principal`
    // bytes. Even with a cryptographically valid signature, the validator
    // rejects the stamp shape before verify is reached.
    const { seed, publicKey } = await makeKeypair();
    const registry = createInMemoryRegistry();
    registry.add(makeIdentity("did:mf:echo", publicKey));

    const at = new Date().toISOString();
    const draft = {
      method: "ed25519" as const,
      principal: "did:mf:echo",
      signature: "",
      at,
    };
    const forSigning = {
      ...createEnvelope(validInput),
      signed_by: [draft],
    } as unknown as MyelinEnvelope;
    const message = canonicalizeForSigning(forSigning);
    const signature = Buffer.from(await signAsync(message, seed)).toString("base64");
    const env = {
      ...createEnvelope(validInput),
      signed_by: [{ method: "ed25519", principal: "did:mf:echo", signature, at }],
    } as unknown as MyelinEnvelope;

    expect(validateEnvelope(env).valid).toBe(false);

    const result = await verifyEnvelopeIdentity(env, registry);
    // verify rejects the stamp because the DID accessor returns undefined —
    // post-myelin#182 the accessor reads only `identity`.
    expect(result.status).toBe("rejected");
  });

  it("BOTH forms on one stamp → rejected (principal still unknown post-#182)", () => {
    const env = {
      ...createEnvelope(validInput),
      signed_by: [
        {
          method: "ed25519",
          identity: "did:mf:echo",
          principal: "did:mf:echo",
          signature: "A".repeat(88),
          at: "2026-05-10T00:00:00Z",
        },
      ],
    } as unknown as MyelinEnvelope;
    const result = validateEnvelope(env);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "signed_by[0].principal")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// R2 — originator DID field: `originator.principal` → `.identity`
// ---------------------------------------------------------------------------

describe("R2 originator field — cross-version", () => {
  const baseEnv = createEnvelope(validInput);

  it("NEW form: originator.identity validates", () => {
    const r = validateEnvelope({
      ...baseEnv,
      originator: { identity: "did:mf:mike", attribution: "adapter-resolved" },
    });
    expect(r.valid).toBe(true);
  });

  it("OLD form: originator.principal still validates", () => {
    const r = validateEnvelope({
      ...baseEnv,
      originator: { principal: "did:mf:mike", attribution: "adapter-resolved" },
    });
    expect(r.valid).toBe(true);
  });

  it("BOTH keys on originator → dual_field_conflict", () => {
    const r = validateEnvelope({
      ...baseEnv,
      originator: {
        identity: "did:mf:mike",
        principal: "did:mf:mike",
        attribution: "adapter-resolved",
      },
    });
    expect(r.valid).toBe(false);
    expect(
      r.errors.some(
        (e) => e.code === "dual_field_conflict" && e.field === "originator.identity",
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// R13 — routing target: `target_principal` → `target_assistant`
// (breaking cut — the deprecated `target_principal` key has LEFT the
//  transition window and is now rejected on the wire as an unknown field.)
// ---------------------------------------------------------------------------

describe("R13 target field — breaking cut", () => {
  const baseEnv = createEnvelope(validInput);

  it("NEW form: target_assistant satisfies a direct envelope", () => {
    const r = validateEnvelope({
      ...baseEnv,
      distribution_mode: "direct",
      target_assistant: "did:mf:forge",
    });
    expect(r.valid).toBe(true);
  });

  it("legacy target_principal is now REJECTED (unknown field)", () => {
    const r = validateEnvelope({
      ...baseEnv,
      distribution_mode: "direct",
      target_principal: "did:mf:forge",
    });
    expect(r.valid).toBe(false);
    // Rejected both as an unknown field AND for missing the required target.
    expect(
      r.errors.some(
        (e) => e.field === "target_principal" && e.message.includes("unknown field"),
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// R11 — distribution_mode enum: `broadcast` → `offer`
// ---------------------------------------------------------------------------

describe("R11 distribution_mode — cross-version", () => {
  const baseEnv = createEnvelope(validInput);

  it("NEW value: distribution_mode 'offer' validates", () => {
    expect(validateEnvelope({ ...baseEnv, distribution_mode: "offer" }).valid).toBe(true);
  });

  it("OLD value: distribution_mode 'broadcast' still validates (deprecated)", () => {
    expect(validateEnvelope({ ...baseEnv, distribution_mode: "broadcast" }).valid).toBe(true);
  });

  it("an unknown distribution_mode is still rejected", () => {
    expect(validateEnvelope({ ...baseEnv, distribution_mode: "multicast" }).valid).toBe(
      false,
    );
  });

  it("emit side: createEnvelope normalises 'broadcast' input to 'offer'", () => {
    const env = createEnvelope({ ...validInput, distribution_mode: "broadcast" });
    expect(env.distribution_mode).toBe("offer");
  });
});

// ---------------------------------------------------------------------------
// R6 — source grammar: fixed 3 segments `{principal}.{stack}.{assistant}`
// (myelin#183 breaking cut — the legacy `org.agent.instance` 3-5 form is
//  no longer accepted; CONTEXT.md line 99 + the prior R6 transition window
//  closed.)
// ---------------------------------------------------------------------------

describe("R6 source grammar — myelin#183 breaking cut", () => {
  const baseEnv = createEnvelope(validInput);

  it("NEW form: a fixed-3 source validates", () => {
    expect(
      validateEnvelope({ ...baseEnv, source: "metafactory.security.luna" }).valid,
    ).toBe(true);
  });

  it("legacy 4-segment source is now REJECTED (myelin#183 breaking cut)", () => {
    expect(
      validateEnvelope({ ...baseEnv, source: "acme.security.scanner.prod-01" }).valid,
    ).toBe(false);
  });

  it("legacy 5-segment source is now REJECTED (myelin#183 breaking cut)", () => {
    expect(
      validateEnvelope({
        ...baseEnv,
        source: "acme.security.scanner.prod-01.replica",
      }).valid,
    ).toBe(false);
  });

  it("a 2-segment source is rejected (below the minimum)", () => {
    expect(validateEnvelope({ ...baseEnv, source: "acme.monitor" }).valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// End-to-end — an all-old-vocabulary envelope round-trips
// ---------------------------------------------------------------------------

describe("transition E2E — a partially pre-migration envelope verifies", () => {
  it("current-form stamp + canonical target + old enum on a fixed-3 source (post myelin#182 + #183 + R13)", async () => {
    // Post myelin#182, #183 AND R13 all cut:
    //  - `signed_by[].principal` was dropped from the wire (myelin#182); stamps must emit `.identity`
    //  - `{org}` → `{principal}` renamed + source grammar tightened to strict 3 segments (myelin#183)
    //  - `target_principal` → `target_assistant` (R13); the deprecated key is dropped from the wire
    // The R-codes still in transition: R11 distribution_mode (here `"broadcast"`
    // is still accepted on read). This test ensures an envelope on the strict-3
    // source grammar with a current-form `.identity` stamp, the canonical
    // `target_assistant` routing key, and the old-form enum value still
    // validates + verifies through the remaining dual-schema reader.
    const { privateKey, publicKey } = await makeKeypair();
    const registry = createInMemoryRegistry();
    registry.add(makeIdentity("did:mf:echo", publicKey));

    const { signEnvelope } = await import("./identity/sign");
    const unsigned = {
      ...createEnvelope({ ...validInput, source: "acme.security.scanner" }),
      distribution_mode: "direct",
      target_assistant: "did:mf:forge",
    } as unknown as MyelinEnvelope;
    const signed = await signEnvelope(unsigned, privateKey, "did:mf:echo");

    expect(validateEnvelope(signed).valid).toBe(true);
    const result = await verifyEnvelopeIdentity(signed, registry);
    expect(result.status).toBe("verified");
  });
});
