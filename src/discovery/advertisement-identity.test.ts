import { describe, it, expect } from "bun:test";
import { utils, getPublicKeyAsync, signAsync } from "@noble/ed25519";
import { readAdvertisementIdentity } from "./advertisement-identity";
import { canonicalizeAdvertisement } from "./canonicalize";
import { signCapabilityRegistration, verifyCapabilityRegistration } from "./index";
import { InMemoryCapabilityStore } from "./memory-store";
import type { CapabilityAdvertisement, SigningIdentity } from "./types";
import { createInMemoryRegistry } from "../identity/registry";

// R2 advertisement cross-version tests (vocabulary migration 2026-05,
// PR-9) — the `principal` → `identity` rename on `CapabilityAdvertisement`.
// A capability advertisement is SIGNED canonical content:
// `canonicalizeAdvertisement` JCS-serializes the WHOLE advertisement
// object, so the actor-DID key is part of the signed bytes. This rename
// therefore has the same wire-safety profile as PR-6's envelope-level R2
// and PR-7's dispatch-payload R2: an OLD-form advertisement (`principal`)
// must still verify, a NEW-form one (`identity`) must verify, and an
// advertisement carrying BOTH keys must be rejected with
// `dual_field_conflict`.

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function makeIdentity(
  did: string,
): Promise<{ identity: SigningIdentity; publicKey: string }> {
  const priv = utils.randomSecretKey();
  const pub = await getPublicKeyAsync(priv);
  return {
    identity: { did, privateKey: bytesToBase64(priv) },
    publicKey: bytesToBase64(pub),
  };
}

/**
 * Build a capability advertisement keyed with the supplied actor-DID key.
 * `identity` is the canonical (post-R2) key; `principal` is the
 * deprecated pre-migration key.
 */
function advertisement(
  didKey: "principal" | "identity",
  did = "did:mf:luna",
): Record<string, unknown> {
  return {
    [didKey]: did,
    capabilities: ["code-review", "typescript"],
    sovereignty: "selective",
    load: 0.2,
    maxConcurrent: 3,
    updatedAt: "2026-05-09T20:00:00Z",
  };
}

/**
 * GENUINELY sign an OLD-form advertisement — one carrying the deprecated
 * `principal` key — exactly as a pre-migration myelin would have. Mirrors
 * `signCapabilityRegistration` but keeps the `principal` key so the signed
 * canonical bytes contain `"principal"`. This is the cross-version
 * fixture: a record produced before the R2 rename.
 */
async function signOldFormRegistration(
  oldAdvertisement: Record<string, unknown>,
  identity: SigningIdentity,
) {
  const bytes = canonicalizeAdvertisement(
    oldAdvertisement as unknown as CapabilityAdvertisement,
  );
  const privKey = Uint8Array.from(atob(identity.privateKey), (c) => c.charCodeAt(0));
  const signature = await signAsync(bytes, privKey);
  return {
    advertisement: oldAdvertisement as unknown as CapabilityAdvertisement,
    signed_by: {
      method: "ed25519" as const,
      identity: identity.did,
      signature: bytesToBase64(signature),
      at: new Date().toISOString(),
    },
  };
}

describe("readAdvertisementIdentity — R2 advertisement transition reader", () => {
  it("reads the canonical `identity` key when present", () => {
    const r = readAdvertisementIdentity(advertisement("identity"));
    expect(r.conflict).toBe(false);
    expect(r.value).toBe("did:mf:luna");
  });

  it("falls back to the deprecated `principal` key (pre-migration advertisement)", () => {
    const r = readAdvertisementIdentity(advertisement("principal"));
    expect(r.conflict).toBe(false);
    expect(r.value).toBe("did:mf:luna");
  });

  it("rejects both keys even when their values are identical (over-eager producer)", () => {
    const both = { ...advertisement("identity"), principal: "did:mf:luna" };
    const r = readAdvertisementIdentity(both);
    expect(r.conflict).toBe(true);
    expect(r.error?.code).toBe("dual_field_conflict");
  });

  it("rejects both keys when their values DIFFER (attack vector)", () => {
    const both = { ...advertisement("identity"), principal: "did:mf:attacker" };
    const r = readAdvertisementIdentity(both);
    expect(r.conflict).toBe(true);
    expect(r.error?.code).toBe("dual_field_conflict");
    expect(r.value).toBeUndefined();
  });

  it("returns undefined when neither key is present", () => {
    const r = readAdvertisementIdentity({ capabilities: [] });
    expect(r.conflict).toBe(false);
    expect(r.value).toBeUndefined();
  });
});

describe("R2 advertisement — cross-version wire safety (signed registrations)", () => {
  it("an OLD-form advertisement (`principal` key) still verifies", async () => {
    const { identity, publicKey } = await makeIdentity("did:mf:luna");
    const registry = createInMemoryRegistry();
    registry.add({
      id: "did:mf:luna",
      network: "metafactory",
      public_key: publicKey,
      type: "agent",
      created_at: "2026-05-07T00:00:00Z",
    });

    // Genuinely sign a pre-migration advertisement carrying `principal`.
    const oldReg = await signOldFormRegistration(advertisement("principal"), identity);
    // Sanity: the signed advertisement really does carry the old key.
    expect("principal" in oldReg.advertisement).toBe(true);
    expect("identity" in oldReg.advertisement).toBe(false);

    // A post-migration verifier canonicalizes bytes-as-received, so the
    // old-signed advertisement still verifies against its own bytes.
    const result = await verifyCapabilityRegistration(oldReg, registry);
    expect(result.status).toBe("verified");
    if (result.status === "verified") {
      expect(result.identity).toBe("did:mf:luna");
    }
  });

  it("a NEW-form advertisement (`identity` key) signs and verifies", async () => {
    const { identity, publicKey } = await makeIdentity("did:mf:luna");
    const registry = createInMemoryRegistry();
    registry.add({
      id: "did:mf:luna",
      network: "metafactory",
      public_key: publicKey,
      type: "agent",
      created_at: "2026-05-07T00:00:00Z",
    });

    const reg = await signCapabilityRegistration(
      advertisement("identity") as unknown as CapabilityAdvertisement,
      identity,
    );
    expect("identity" in reg.advertisement).toBe(true);
    expect("principal" in reg.advertisement).toBe(false);

    const result = await verifyCapabilityRegistration(reg, registry);
    expect(result.status).toBe("verified");
  });

  it("signCapabilityRegistration never re-keys — old-form bytes survive round-trip", async () => {
    // Wire-safety invariant: the advertisement is canonicalized
    // bytes-as-received. signCapabilityRegistration spreads the input
    // verbatim, so an advertisement passed in carrying `principal` keeps
    // that key — never silently re-keyed to `identity`.
    const { identity } = await makeIdentity("did:mf:luna");
    const reg = await signCapabilityRegistration(
      advertisement("principal") as unknown as CapabilityAdvertisement,
      identity,
    );
    expect("principal" in reg.advertisement).toBe(true);
    expect("identity" in reg.advertisement).toBe(false);
  });

  it("a signed both-keys advertisement is rejected by verify", async () => {
    const { identity, publicKey } = await makeIdentity("did:mf:luna");
    const registry = createInMemoryRegistry();
    registry.add({
      id: "did:mf:luna",
      network: "metafactory",
      public_key: publicKey,
      type: "agent",
      created_at: "2026-05-07T00:00:00Z",
    });

    // A both-keys advertisement, genuinely signed over its dual-keyed
    // canonical bytes. Even though the signature is cryptographically
    // well-formed, the dual-keyed advertisement is refused at the
    // discovery trust boundary before canonicalization.
    const both = { ...advertisement("identity"), principal: "did:mf:attacker" };
    const signedBoth = await signOldFormRegistration(both, identity);
    const result = await verifyCapabilityRegistration(signedBoth, registry);
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.reason).toContain("dual_field_conflict");
    }
  });

  it("signCapabilityRegistration rejects a both-keys advertisement", async () => {
    const { identity } = await makeIdentity("did:mf:luna");
    const both = { ...advertisement("identity"), principal: "did:mf:luna" };
    await expect(
      signCapabilityRegistration(both as unknown as CapabilityAdvertisement, identity),
    ).rejects.toThrow(/dual_field_conflict/);
  });

  it("InMemoryCapabilityStore keys an OLD-form advertisement by its `principal` value", async () => {
    const { identity } = await makeIdentity("did:mf:luna");
    const store = new InMemoryCapabilityStore();
    const oldReg = await signOldFormRegistration(advertisement("principal"), identity);
    await store.put(oldReg);
    // The store keys by the dual-field-resolved actor-DID, so a get with
    // the DID resolves the pre-migration advertisement.
    const got = await store.get("did:mf:luna");
    expect(got).not.toBeNull();
  });

  it("InMemoryCapabilityStore.put rejects a both-keys advertisement", async () => {
    const { identity } = await makeIdentity("did:mf:luna");
    const store = new InMemoryCapabilityStore();
    const both = { ...advertisement("identity"), principal: "did:mf:luna" };
    const signedBoth = await signOldFormRegistration(both, identity);
    await expect(store.put(signedBoth)).rejects.toThrow(/dual_field_conflict/);
  });
});
