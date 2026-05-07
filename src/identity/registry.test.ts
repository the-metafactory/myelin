import { describe, it, expect, beforeEach, spyOn } from "bun:test";
import { createInMemoryRegistry, loadRegistry } from "./registry";
import type { PrincipalRegistry } from "./registry";
import type { Principal } from "./types";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function makePrincipal(overrides: Partial<Principal> = {}): Principal {
  return {
    id: "did:mf:echo",
    display_name: "Echo",
    operator: "metafactory",
    public_key: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    type: "agent",
    created_at: "2026-05-07T00:00:00Z",
    ...overrides,
  };
}

describe("InMemoryRegistry", () => {
  let registry: PrincipalRegistry;

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

    const result = registry.list();
    expect(result).toHaveLength(2);
    expect(result).toContainEqual(a);
    expect(result).toContainEqual(b);
  });

  it("trustedHubs() returns only is_hub principals", () => {
    const hub = makePrincipal({
      id: "did:mf:hub.metafactory",
      type: "operator",
      is_hub: true,
    });
    const agent = makePrincipal({ id: "did:mf:echo" });

    registry.add(hub);
    registry.add(agent);

    const hubs = registry.trustedHubs();
    expect(hubs).toHaveLength(1);
    expect(hubs[0].id).toBe("did:mf:hub.metafactory");
    expect(hubs[0].is_hub).toBe(true);
  });
});

describe("JsonFileRegistry (loadRegistry)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "myelin-registry-"));
  });

  it("loads principals from a valid JSON file", () => {
    const principal = makePrincipal({ id: "did:mf:fromfile" });
    const data = {
      version: 1,
      principals: [principal],
      trusted_hubs: ["did:mf:fromfile"],
    };
    const filePath = join(tempDir, "principals.json");
    writeFileSync(filePath, JSON.stringify(data));

    const registry = loadRegistry(filePath);
    expect(registry.resolve("did:mf:fromfile")).toEqual(principal);
    expect(registry.list()).toHaveLength(1);
  });

  it("trustedHubs() returns principals with is_hub === true", () => {
    const hub = makePrincipal({
      id: "did:mf:hub",
      type: "operator",
      is_hub: true,
    });
    const agent = makePrincipal({ id: "did:mf:agent" });
    const data = {
      version: 1,
      principals: [hub, agent],
      trusted_hubs: ["did:mf:hub"],
    };
    const filePath = join(tempDir, "principals.json");
    writeFileSync(filePath, JSON.stringify(data));

    const registry = loadRegistry(filePath);
    const hubs = registry.trustedHubs();
    expect(hubs).toHaveLength(1);
    expect(hubs[0].id).toBe("did:mf:hub");
  });

  it("throws on missing file with helpful message", () => {
    const missingPath = join(tempDir, "does-not-exist.json");
    expect(() => loadRegistry(missingPath)).toThrow(/not found/i);
  });

  it("throws on invalid JSON structure (missing version)", () => {
    const filePath = join(tempDir, "bad.json");
    writeFileSync(filePath, JSON.stringify({ principals: [] }));
    expect(() => loadRegistry(filePath)).toThrow(/invalid.*registry/i);
  });

  it("throws on invalid JSON structure (missing principals)", () => {
    const filePath = join(tempDir, "bad2.json");
    writeFileSync(filePath, JSON.stringify({ version: 1 }));
    expect(() => loadRegistry(filePath)).toThrow(/invalid.*registry/i);
  });

  it("throws on malformed JSON", () => {
    const filePath = join(tempDir, "corrupt.json");
    writeFileSync(filePath, "not json at all");
    expect(() => loadRegistry(filePath)).toThrow();
  });

  it("add() logs warning (read-only)", () => {
    const principal = makePrincipal({ id: "did:mf:readonly" });
    const data = {
      version: 1,
      principals: [principal],
      trusted_hubs: [],
    };
    const filePath = join(tempDir, "principals.json");
    writeFileSync(filePath, JSON.stringify(data));

    const registry = loadRegistry(filePath);

    const stderrSpy = spyOn(console, "warn").mockImplementation(() => {});
    registry.add(makePrincipal({ id: "did:mf:new" }));
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("read-only")
    );
    stderrSpy.mockRestore();

    // Verify it was NOT actually added
    expect(registry.resolve("did:mf:new")).toBeNull();
  });
});
