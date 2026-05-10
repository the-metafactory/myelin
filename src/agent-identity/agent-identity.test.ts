import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generateAgentIdentity,
  saveAgentIdentity,
  loadAgentIdentity,
  toSigningIdentity,
  toPrincipal,
  registerSelf,
} from "./index";
import type { AgentIdentity } from "./types";
import { InMemoryCapabilityStore } from "../discovery/memory-store";
import { verifyCapabilityRegistration } from "../discovery/verify";
import { createInMemoryRegistry } from "../identity/registry";

describe("generateAgentIdentity", () => {
  it("creates a valid identity with Ed25519 keypair", async () => {
    const id = await generateAgentIdentity({
      did: "did:mf:luna",
      source_uri: "file:///etc/agents/luna",
      capabilities: ["code-review"],
    });
    expect(id.did).toBe("did:mf:luna");
    expect(id.public_key.length).toBeGreaterThan(0);
    expect(id.private_key.length).toBeGreaterThan(0);
    expect(id.capabilities).toEqual(["code-review"]);
    expect(id.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("rejects invalid DID", async () => {
    await expect(generateAgentIdentity({ did: "not-a-did", source_uri: "file:///x" })).rejects.toThrow(/invalid DID/);
  });

  it("rejects DID with consecutive hyphens", async () => {
    await expect(generateAgentIdentity({ did: "did:mf:hub--metafactory", source_uri: "file:///x" })).rejects.toThrow(/invalid DID/);
  });

  it("rejects bad source URI", async () => {
    await expect(generateAgentIdentity({ did: "did:mf:luna", source_uri: "ftp://x" })).rejects.toThrow(/source_uri/);
    await expect(generateAgentIdentity({ did: "did:mf:luna", source_uri: "luna" })).rejects.toThrow(/source_uri/);
  });

  it("accepts http/https/file/did source URIs", async () => {
    for (const uri of ["http://x", "https://x", "file:///x", "did:mf:provisioner"]) {
      const id = await generateAgentIdentity({ did: "did:mf:luna", source_uri: uri });
      expect(id.source_uri).toBe(uri);
    }
  });

  it("rejects bad capability tags", async () => {
    await expect(
      generateAgentIdentity({ did: "did:mf:luna", source_uri: "file:///x", capabilities: ["Bad_Tag"] }),
    ).rejects.toThrow(/capability tag/);
  });

  it("preserves operator + display_name when provided", async () => {
    const id = await generateAgentIdentity({
      did: "did:mf:luna",
      source_uri: "file:///x",
      operator: "metafactory",
      display_name: "Luna",
    });
    expect(id.operator).toBe("metafactory");
    expect(id.display_name).toBe("Luna");
  });

  it("each generation produces a fresh keypair", async () => {
    const a = await generateAgentIdentity({ did: "did:mf:luna", source_uri: "file:///x" });
    const b = await generateAgentIdentity({ did: "did:mf:luna", source_uri: "file:///x" });
    expect(a.private_key).not.toBe(b.private_key);
    expect(a.public_key).not.toBe(b.public_key);
  });

  it("does not mutate input.capabilities array (defensive copy)", async () => {
    const caps = ["code-review"];
    const id = await generateAgentIdentity({ did: "did:mf:luna", source_uri: "file:///x", capabilities: caps });
    caps.push("deploy");
    expect(id.capabilities).toEqual(["code-review"]);
  });
});

describe("saveAgentIdentity / loadAgentIdentity", () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "myelin-f7-"));
  });
  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("round-trips an identity through file storage", async () => {
    const id = await generateAgentIdentity({ did: "did:mf:luna", source_uri: "file:///x", capabilities: ["code-review"] });
    const path = join(tmpDir, "luna.json");
    await saveAgentIdentity(id, path);
    const loaded = await loadAgentIdentity(path);
    expect(loaded).toEqual(id);
  });

  it("writes file with mode 0o600 (owner read/write only)", async () => {
    const id = await generateAgentIdentity({ did: "did:mf:luna", source_uri: "file:///x" });
    const path = join(tmpDir, "private.json");
    await saveAgentIdentity(id, path);
    const s = await stat(path);
    // Mask out file-type bits, keep permission bits.
    expect(s.mode & 0o777).toBe(0o600);
  });

  it("creates parent directories when missing", async () => {
    const id = await generateAgentIdentity({ did: "did:mf:luna", source_uri: "file:///x" });
    const path = join(tmpDir, "nested", "deep", "luna.json");
    await saveAgentIdentity(id, path);
    const loaded = await loadAgentIdentity(path);
    expect(loaded.did).toBe(id.did);
  });

  it("writes a versioned wrapper, not a bare identity", async () => {
    const id = await generateAgentIdentity({ did: "did:mf:luna", source_uri: "file:///x" });
    const path = join(tmpDir, "luna.json");
    await saveAgentIdentity(id, path);
    const text = await readFile(path, "utf8");
    const parsed = JSON.parse(text);
    expect(parsed.version).toBe(1);
    expect(parsed.identity.did).toBe(id.did);
  });

  it("rejects loading a file with wrong version", async () => {
    const path = join(tmpDir, "wrong.json");
    await Bun.write(path, JSON.stringify({ version: 99, identity: {} }));
    await expect(loadAgentIdentity(path)).rejects.toThrow(/unsupported version/);
  });

  it("rejects loading invalid JSON", async () => {
    const path = join(tmpDir, "broken.json");
    await Bun.write(path, "not json");
    await expect(loadAgentIdentity(path)).rejects.toThrow(/invalid JSON/);
  });

  it("rejects loading an identity that fails validation", async () => {
    const path = join(tmpDir, "bad.json");
    await Bun.write(path, JSON.stringify({ version: 1, identity: { did: "broken", capabilities: [] } }));
    await expect(loadAgentIdentity(path)).rejects.toThrow(/failed validation/);
  });

  it("refuses to save a malformed identity (defensive)", async () => {
    const bad = { did: "broken" } as unknown as AgentIdentity;
    await expect(saveAgentIdentity(bad, join(tmpDir, "bad.json"))).rejects.toThrow(/refusing to write/);
  });
});

describe("toSigningIdentity", () => {
  it("strips to did + privateKey", async () => {
    const id = await generateAgentIdentity({ did: "did:mf:luna", source_uri: "file:///x", capabilities: ["code-review"] });
    const s = toSigningIdentity(id);
    expect(s).toEqual({ did: id.did, privateKey: id.private_key });
  });
});

describe("toPrincipal", () => {
  it("returns a public-only Principal — never includes private key", async () => {
    const id = await generateAgentIdentity({ did: "did:mf:luna", source_uri: "file:///x", operator: "metafactory" });
    const p = toPrincipal(id);
    expect((p as unknown as Record<string, unknown>).private_key).toBeUndefined();
    expect(p.id).toBe(id.did);
    expect(p.public_key).toBe(id.public_key);
    expect(p.operator).toBe("metafactory");
    expect(p.type).toBe("agent");
    expect(p.is_hub).toBeUndefined();
  });

  it("infers operator from DID when not on identity", async () => {
    const id = await generateAgentIdentity({ did: "did:mf:luna", source_uri: "file:///x" });
    const p = toPrincipal(id);
    expect(p.operator).toBe("luna");
  });

  it("flags is_hub when requested", async () => {
    const id = await generateAgentIdentity({ did: "did:mf:hub", source_uri: "file:///x" });
    const p = toPrincipal(id, { is_hub: true });
    expect(p.is_hub).toBe(true);
  });
});

describe("registerSelf", () => {
  it("registers via F-11 capability store, signature verifies", async () => {
    const id = await generateAgentIdentity({
      did: "did:mf:luna",
      source_uri: "file:///x",
      capabilities: ["code-review", "security-scan"],
      operator: "metafactory",
    });
    const store = new InMemoryCapabilityStore();
    await registerSelf(id, { store, sovereignty: "open", load: 0.2, maxConcurrent: 4 });
    const entry = await store.get(id.did);
    expect(entry).not.toBeNull();
    expect(entry!.advertisement.capabilities).toEqual(["code-review", "security-scan"]);
    expect(entry!.advertisement.sovereignty).toBe("open");
    expect(entry!.advertisement.maxConcurrent).toBe(4);

    const registry = createInMemoryRegistry();
    registry.add(toPrincipal(id));
    const result = await verifyCapabilityRegistration(entry!, registry);
    expect(result.status).toBe("verified");
    await store.close();
  });

  it("registration is verifiable only with the matching public key in the registry (anti-spoof end-to-end)", async () => {
    // Two agents — fern's stored signing public key is registered, but
    // luna registers a capability claim and signs it with luna's key.
    // Verification must reject luna's registration when the registry
    // only knows fern's public key.
    const luna = await generateAgentIdentity({ did: "did:mf:luna", source_uri: "file:///x" });
    const fern = await generateAgentIdentity({ did: "did:mf:fern", source_uri: "file:///x" });
    const store = new InMemoryCapabilityStore();
    await registerSelf(luna, { store, sovereignty: "open", load: 0, maxConcurrent: 1 });
    const entry = await store.get(luna.did);

    // Registry has only fern's public key — tries to look up luna by id.
    const registry = createInMemoryRegistry();
    registry.add(toPrincipal(fern));

    const result = await verifyCapabilityRegistration(entry!, registry);
    expect(result.status).not.toBe("verified");
    await store.close();
  });
});
