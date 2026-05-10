import { describe, it, expect } from "bun:test";
import { utils, getPublicKeyAsync } from "@noble/ed25519";
import {
  canonicalizeAdvertisement,
  signCapabilityRegistration,
  registerCapabilities,
  updateLoad,
  verifyCapabilityRegistration,
  InMemoryCapabilityStore,
  type CapabilityAdvertisement,
  type SigningIdentity,
} from "./index";
import { createInMemoryRegistry } from "../identity/registry";

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

async function makeIdentity(did: string): Promise<{ identity: SigningIdentity; publicKey: string }> {
  const priv = utils.randomSecretKey();
  const pub = await getPublicKeyAsync(priv);
  return {
    identity: { did, privateKey: bytesToBase64(priv) },
    publicKey: bytesToBase64(pub),
  };
}

const baseAdvertisement: CapabilityAdvertisement = {
  principal: "did:mf:luna",
  capabilities: ["code-review", "typescript"],
  sovereignty: "selective",
  load: 0.2,
  maxConcurrent: 3,
  updatedAt: "2026-05-09T20:00:00Z",
};

describe("canonicalizeAdvertisement", () => {
  it("produces deterministic sorted JSON", () => {
    const out = new TextDecoder().decode(canonicalizeAdvertisement(baseAdvertisement));
    expect(out).toBe(
      '{"capabilities":["code-review","typescript"],"load":0.2,"maxConcurrent":3,"principal":"did:mf:luna","sovereignty":"selective","updatedAt":"2026-05-09T20:00:00Z"}',
    );
  });

  it("differs on different field values", () => {
    const a = new TextDecoder().decode(canonicalizeAdvertisement(baseAdvertisement));
    const b = new TextDecoder().decode(canonicalizeAdvertisement({ ...baseAdvertisement, load: 0.3 }));
    expect(a).not.toBe(b);
  });
});

describe("signCapabilityRegistration", () => {
  it("produces valid signed registration", async () => {
    const { identity } = await makeIdentity("did:mf:luna");
    const reg = await signCapabilityRegistration(baseAdvertisement, identity);
    expect(reg.signed_by.method).toBe("ed25519");
    expect(reg.signed_by.principal).toBe("did:mf:luna");
    expect(reg.signed_by.signature).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(reg.signed_by.signature.length).toBeGreaterThanOrEqual(86);
    expect(reg.signed_by.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("rejects principal/identity mismatch (anti-spoof)", async () => {
    const { identity } = await makeIdentity("did:mf:fern");
    await expect(signCapabilityRegistration(baseAdvertisement, identity))
      .rejects.toThrow(/must match identity\.did/);
  });

  it("rejects invalid DID", async () => {
    const { identity } = await makeIdentity("did:web:foo");
    await expect(signCapabilityRegistration({ ...baseAdvertisement, principal: "did:web:foo" }, identity))
      .rejects.toThrow(/invalid DID/);
  });

  it("rejects non-positive maxConcurrent", async () => {
    const { identity } = await makeIdentity("did:mf:luna");
    await expect(signCapabilityRegistration({ ...baseAdvertisement, maxConcurrent: 0 }, identity))
      .rejects.toThrow(/maxConcurrent/);
  });

  it("clamps load to [0,1]", async () => {
    const { identity } = await makeIdentity("did:mf:luna");
    const high = await signCapabilityRegistration({ ...baseAdvertisement, load: 1.5 }, identity);
    expect(high.advertisement.load).toBe(1);
    const low = await signCapabilityRegistration({ ...baseAdvertisement, load: -0.2 }, identity);
    expect(low.advertisement.load).toBe(0);
  });

  it("rejects wrong-length private key", async () => {
    const identity: SigningIdentity = { did: "did:mf:luna", privateKey: btoa("short") };
    await expect(signCapabilityRegistration(baseAdvertisement, identity))
      .rejects.toThrow(/expected 32-byte/);
  });
});

describe("verifyCapabilityRegistration", () => {
  it("verifies a valid signed registration", async () => {
    const { identity, publicKey } = await makeIdentity("did:mf:luna");
    const reg = await signCapabilityRegistration(baseAdvertisement, identity);
    const registry = createInMemoryRegistry();
    registry.add({
      id: "did:mf:luna",
      operator: "metafactory",
      public_key: publicKey,
      type: "agent",
      created_at: "2026-05-07T00:00:00Z",
    });
    const result = await verifyCapabilityRegistration(reg, registry);
    expect(result.status).toBe("verified");
  });

  it("rejects principal mismatch", async () => {
    const { identity } = await makeIdentity("did:mf:luna");
    const reg = await signCapabilityRegistration(baseAdvertisement, identity);
    // Tamper: swap signed_by.principal
    const tampered = { ...reg, signed_by: { ...reg.signed_by, principal: "did:mf:fern" } };
    const registry = createInMemoryRegistry();
    const result = await verifyCapabilityRegistration(tampered, registry);
    expect(result.status).toBe("rejected");
    expect((result as any).reason).toContain("principal mismatch");
  });

  it("rejects unknown principal", async () => {
    const { identity } = await makeIdentity("did:mf:ghost");
    const reg = await signCapabilityRegistration({ ...baseAdvertisement, principal: "did:mf:ghost" }, identity);
    const registry = createInMemoryRegistry();
    const result = await verifyCapabilityRegistration(reg, registry);
    expect(result.status).toBe("rejected");
    expect((result as any).reason).toContain("unknown principal");
  });

  it("rejects tampered advertisement (signature no longer verifies)", async () => {
    const { identity, publicKey } = await makeIdentity("did:mf:luna");
    const reg = await signCapabilityRegistration(baseAdvertisement, identity);
    const tampered = { ...reg, advertisement: { ...reg.advertisement, capabilities: ["evil-capability"] } };
    const registry = createInMemoryRegistry();
    registry.add({ id: "did:mf:luna", operator: "metafactory", public_key: publicKey, type: "agent", created_at: "2026-05-07T00:00:00Z" });
    const result = await verifyCapabilityRegistration(tampered, registry);
    expect(result.status).toBe("rejected");
    expect((result as any).reason).toContain("signature");
  });

  it("rejects clock skew exceeded", async () => {
    const { identity, publicKey } = await makeIdentity("did:mf:luna");
    const reg = await signCapabilityRegistration(baseAdvertisement, identity);
    // Backdate
    const old = { ...reg, signed_by: { ...reg.signed_by, at: "2020-01-01T00:00:00Z" } };
    const registry = createInMemoryRegistry();
    registry.add({ id: "did:mf:luna", operator: "metafactory", public_key: publicKey, type: "agent", created_at: "2026-05-07T00:00:00Z" });
    const result = await verifyCapabilityRegistration(old, registry, { clockSkewMs: 1000 });
    expect(result.status).toBe("rejected");
    expect((result as any).reason).toContain("clock skew");
  });

  it("respects clockSkewMs override", async () => {
    const { identity, publicKey } = await makeIdentity("did:mf:luna");
    const reg = await signCapabilityRegistration(baseAdvertisement, identity);
    const registry = createInMemoryRegistry();
    registry.add({ id: "did:mf:luna", operator: "metafactory", public_key: publicKey, type: "agent", created_at: "2026-05-07T00:00:00Z" });
    // Generous skew tolerance — passes
    const result = await verifyCapabilityRegistration(reg, registry, { clockSkewMs: 60_000 });
    expect(result.status).toBe("verified");
  });
});

describe("InMemoryCapabilityStore", () => {
  it("put/get round-trip", async () => {
    const { identity } = await makeIdentity("did:mf:luna");
    const store = new InMemoryCapabilityStore();
    const reg = await signCapabilityRegistration(baseAdvertisement, identity);
    await store.put(reg);
    const got = await store.get("did:mf:luna");
    expect(got).not.toBeNull();
    expect(got!.advertisement.capabilities).toEqual(["code-review", "typescript"]);
  });

  it("get returns null for unknown principal", async () => {
    const store = new InMemoryCapabilityStore();
    expect(await store.get("did:mf:ghost")).toBeNull();
  });

  it("list returns all entries", async () => {
    const { identity: lunaIdentity } = await makeIdentity("did:mf:luna");
    const { identity: fernIdentity } = await makeIdentity("did:mf:fern");
    const store = new InMemoryCapabilityStore();
    await store.put(await signCapabilityRegistration(baseAdvertisement, lunaIdentity));
    await store.put(await signCapabilityRegistration({ ...baseAdvertisement, principal: "did:mf:fern" }, fernIdentity));
    const all = await store.list();
    expect(all.map((r) => r.advertisement.principal).sort()).toEqual(["did:mf:fern", "did:mf:luna"]);
  });

  it("delete removes entry", async () => {
    const { identity } = await makeIdentity("did:mf:luna");
    const store = new InMemoryCapabilityStore();
    await store.put(await signCapabilityRegistration(baseAdvertisement, identity));
    await store.delete("did:mf:luna");
    expect(await store.get("did:mf:luna")).toBeNull();
  });

  it("watch receives PUT and DELETE events in order", async () => {
    const { identity } = await makeIdentity("did:mf:luna");
    const store = new InMemoryCapabilityStore();
    const events: string[] = [];

    const watcher = store.watch();
    const watchPromise = (async () => {
      for await (const entry of watcher) {
        events.push(entry.operation);
        if (events.length >= 2) break;
      }
    })();

    await store.put(await signCapabilityRegistration(baseAdvertisement, identity));
    await store.delete("did:mf:luna");
    await watchPromise;

    expect(events).toEqual(["put", "delete"]);
    await store.close();
  });

  it("two concurrent watchers each receive every event (multi-subscriber fanout)", async () => {
    const { identity } = await makeIdentity("did:mf:luna");
    const store = new InMemoryCapabilityStore();
    const eventsA: string[] = [];
    const eventsB: string[] = [];

    const watcherA = store.watch();
    const watcherB = store.watch();
    const consumeA = (async () => {
      for await (const entry of watcherA) {
        eventsA.push(entry.operation);
        if (eventsA.length >= 2) break;
      }
    })();
    const consumeB = (async () => {
      for await (const entry of watcherB) {
        eventsB.push(entry.operation);
        if (eventsB.length >= 2) break;
      }
    })();

    await store.put(await signCapabilityRegistration(baseAdvertisement, identity));
    await store.delete("did:mf:luna");
    await Promise.all([consumeA, consumeB]);

    expect(eventsA).toEqual(["put", "delete"]);
    expect(eventsB).toEqual(["put", "delete"]);
    await store.close();
  });
});

describe("registerCapabilities + updateLoad (integration)", () => {
  it("registerCapabilities round-trips through verify", async () => {
    const { identity, publicKey } = await makeIdentity("did:mf:luna");
    const store = new InMemoryCapabilityStore();
    const registry = createInMemoryRegistry();
    registry.add({ id: "did:mf:luna", operator: "metafactory", public_key: publicKey, type: "agent", created_at: "2026-05-07T00:00:00Z" });

    await registerCapabilities(store, baseAdvertisement, identity);
    const stored = await store.get("did:mf:luna");
    expect(stored).not.toBeNull();
    const result = await verifyCapabilityRegistration(stored!, registry);
    expect(result.status).toBe("verified");
  });

  it("updateLoad re-signs with new load + bumps updatedAt", async () => {
    const { identity, publicKey } = await makeIdentity("did:mf:luna");
    const store = new InMemoryCapabilityStore();
    const registry = createInMemoryRegistry();
    registry.add({ id: "did:mf:luna", operator: "metafactory", public_key: publicKey, type: "agent", created_at: "2026-05-07T00:00:00Z" });

    await registerCapabilities(store, baseAdvertisement, identity);
    const before = await store.get("did:mf:luna");
    await new Promise((r) => setTimeout(r, 5)); // ensure updatedAt advances
    await updateLoad(store, "did:mf:luna", 0.7, identity);
    const after = await store.get("did:mf:luna");

    expect(after!.advertisement.load).toBe(0.7);
    expect(after!.advertisement.updatedAt).not.toBe(before!.advertisement.updatedAt);
    // Signature still verifies
    const result = await verifyCapabilityRegistration(after!, registry);
    expect(result.status).toBe("verified");
  });

  it("updateLoad rejects identity mismatch (anti-spoof)", async () => {
    const { identity: lunaIdentity, publicKey } = await makeIdentity("did:mf:luna");
    const { identity: fernIdentity } = await makeIdentity("did:mf:fern");
    const store = new InMemoryCapabilityStore();
    const registry = createInMemoryRegistry();
    registry.add({ id: "did:mf:luna", operator: "metafactory", public_key: publicKey, type: "agent", created_at: "2026-05-07T00:00:00Z" });

    await registerCapabilities(store, baseAdvertisement, lunaIdentity);
    await expect(updateLoad(store, "did:mf:luna", 0.7, fernIdentity))
      .rejects.toThrow(/cannot update registration/);
  });

  it("updateLoad throws when no existing registration", async () => {
    const { identity } = await makeIdentity("did:mf:ghost");
    const store = new InMemoryCapabilityStore();
    await expect(updateLoad(store, "did:mf:ghost", 0.7, identity))
      .rejects.toThrow(/no registration found/);
  });
});
