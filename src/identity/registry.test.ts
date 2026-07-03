import { describe, it, expect, beforeEach } from "bun:test";
import { createInMemoryRegistry, loadRegistry } from "./registry";
import type { IdentityRegistry } from "./registry";
import type { Identity } from "./types";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function makePrincipal(overrides: Partial<Identity> = {}): Identity {
  return {
    id: "did:mf:echo",
    display_name: "Echo",
    network: "metafactory",
    public_key: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    type: "agent",
    created_at: "2026-05-07T00:00:00Z",
    ...overrides,
  };
}

describe("InMemoryRegistry", () => {
  let registry: IdentityRegistry;

  beforeEach(() => {
    registry = createInMemoryRegistry();
  });

  it("add() then resolve() returns the principal", () => {
    const p = makePrincipal({ id: "did:mf:alpha" });
    registry.add(p);
    expect(registry.resolve("did:mf:alpha")).toEqual(p);
  });

  it("resolve() unknown returns null", () => {
    expect(registry.resolve("did:mf:nonexistent")).toBeNull();
  });

  it("list() returns all added principals", () => {
    const a = makePrincipal({ id: "did:mf:a" });
    const b = makePrincipal({ id: "did:mf:b" });
    registry.add(a);
    registry.add(b);
    expect(registry.list()).toHaveLength(2);
  });

  it("trustedHubs() returns principals with is_hub flag", () => {
    const hub = makePrincipal({ id: "did:mf:hub.metafactory", type: "hub", is_hub: true });
    const agent = makePrincipal({ id: "did:mf:echo" });
    registry.add(hub);
    registry.add(agent);
    const hubs = registry.trustedHubs();
    expect(hubs).toHaveLength(1);
    expect(hubs[0]!.id).toBe("did:mf:hub.metafactory");
  });
});

describe("JsonFileRegistry (loadRegistry)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "myelin-registry-"));
  });

  it("loads principals from a valid JSON file", () => {
    const principal = makePrincipal({ id: "did:mf:fromfile" });
    const data = { version: 1, principals: [principal], trusted_hubs: [] };
    const filePath = join(tempDir, "principals.json");
    writeFileSync(filePath, JSON.stringify(data));

    const registry = loadRegistry(filePath);
    expect(registry.resolve("did:mf:fromfile")).toEqual(principal);
    expect(registry.list()).toHaveLength(1);
  });

  it("trustedHubs() respects trusted_hubs array", () => {
    const agent = makePrincipal({ id: "did:mf:agent" });
    const data = { version: 1, principals: [agent], trusted_hubs: ["did:mf:agent"] };
    const filePath = join(tempDir, "principals.json");
    writeFileSync(filePath, JSON.stringify(data));

    const registry = loadRegistry(filePath);
    const hubs = registry.trustedHubs();
    expect(hubs).toHaveLength(1);
    expect(hubs[0]!.id).toBe("did:mf:agent");
  });

  it("trustedHubs() combines is_hub flag and trusted_hubs array", () => {
    const hub = makePrincipal({ id: "did:mf:hub", type: "hub", is_hub: true });
    const agent = makePrincipal({ id: "did:mf:agent" });
    const data = { version: 1, principals: [hub, agent], trusted_hubs: ["did:mf:agent"] };
    const filePath = join(tempDir, "principals.json");
    writeFileSync(filePath, JSON.stringify(data));

    const registry = loadRegistry(filePath);
    expect(registry.trustedHubs()).toHaveLength(2);
  });

  it("throws on missing file with path in message", () => {
    const missingPath = join(tempDir, "does-not-exist.json");
    expect(() => loadRegistry(missingPath)).toThrow(/not found/i);
  });

  it("throws on invalid JSON structure", () => {
    const filePath = join(tempDir, "bad.json");
    writeFileSync(filePath, JSON.stringify({ principals: [] }));
    expect(() => loadRegistry(filePath)).toThrow(/invalid.*registry/i);
  });

  it("throws on malformed JSON with file path in error", () => {
    const filePath = join(tempDir, "corrupt.json");
    writeFileSync(filePath, "not json at all");
    expect(() => loadRegistry(filePath)).toThrow(filePath);
  });

  it("throws on invalid principal content (bad public_key)", () => {
    const data = {
      version: 1,
      principals: [{ id: "did:mf:bad", network: "mf", public_key: "x", type: "agent", created_at: "2026-01-01T00:00:00Z" }],
      trusted_hubs: [],
    };
    const filePath = join(tempDir, "bad-key.json");
    writeFileSync(filePath, JSON.stringify(data));
    expect(() => loadRegistry(filePath)).toThrow(/public_key/);
  });

  it("add() throws on read-only registry", () => {
    const data = { version: 1, principals: [makePrincipal()], trusted_hubs: [] };
    const filePath = join(tempDir, "principals.json");
    writeFileSync(filePath, JSON.stringify(data));

    const registry = loadRegistry(filePath);
    expect(() => { registry.add(makePrincipal({ id: "did:mf:new" })); }).toThrow(/read-only/i);
    expect(registry.resolve("did:mf:new")).toBeNull();
  });

  it("validates principal type field", () => {
    const data = {
      version: 1,
      principals: [{ ...makePrincipal(), type: "invalid" }],
      trusted_hubs: [],
    };
    const filePath = join(tempDir, "bad-type.json");
    writeFileSync(filePath, JSON.stringify(data));
    expect(() => loadRegistry(filePath)).toThrow(/type/);
  });

  it("validates trusted_hubs array entries are DIDs", () => {
    const data = {
      version: 1,
      principals: [makePrincipal()],
      trusted_hubs: ["not-a-did"],
    };
    const filePath = join(tempDir, "bad-hubs.json");
    writeFileSync(filePath, JSON.stringify(data));
    expect(() => loadRegistry(filePath)).toThrow(/trusted_hubs/);
  });
});

// R1/R2 (vocabulary migration 2026-05) — the registry-file JSON key
// `principals` was renamed to `identities` and `version` bumped 1 → 2.
// `loadRegistry` is a transition reader: it accepts both v1 (`principals`)
// and v2 (`identities`) files. A file carrying BOTH keys is rejected
// (`dual_field_conflict`) — silently choosing a key on the trusted
// identity list is a trust-list confusion path.
describe("loadRegistry — registry-file key transition (principals → identities)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "myelin-registry-xkey-"));
  });

  function writeFile(name: string, data: unknown): string {
    const filePath = join(tempDir, name);
    writeFileSync(filePath, JSON.stringify(data));
    return filePath;
  }

  it("accepts a version-1 file with the legacy `principals` key", () => {
    const p = makePrincipal({ id: "did:mf:legacy" });
    const filePath = writeFile("v1.json", { version: 1, principals: [p], trusted_hubs: [] });
    const registry = loadRegistry(filePath);
    expect(registry.resolve("did:mf:legacy")).toEqual(p);
  });

  it("accepts a version-2 file with the new `identities` key", () => {
    const p = makePrincipal({ id: "did:mf:current" });
    const filePath = writeFile("v2.json", { version: 2, identities: [p], trusted_hubs: [] });
    const registry = loadRegistry(filePath);
    expect(registry.resolve("did:mf:current")).toEqual(p);
  });

  it("rejects a file carrying both keys with different lists (dual_field_conflict)", () => {
    const filePath = writeFile("both-diff.json", {
      version: 2,
      principals: [makePrincipal({ id: "did:mf:alice" })],
      identities: [makePrincipal({ id: "did:mf:bob" })],
      trusted_hubs: [],
    });
    expect(() => loadRegistry(filePath)).toThrow(/dual_field_conflict/);
  });

  it("rejects a file carrying both keys even with identical lists (dual_field_conflict)", () => {
    const same = [makePrincipal({ id: "did:mf:same" })];
    const filePath = writeFile("both-same.json", {
      version: 2,
      principals: same,
      identities: same,
      trusted_hubs: [],
    });
    expect(() => loadRegistry(filePath)).toThrow(/dual_field_conflict/);
  });

  it("rejects an unsupported version", () => {
    const filePath = writeFile("v3.json", {
      version: 3,
      identities: [makePrincipal()],
      trusted_hubs: [],
    });
    expect(() => loadRegistry(filePath)).toThrow(/unsupported version/);
  });
});
