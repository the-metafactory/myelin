import { describe, it, expect } from "bun:test";
import { createInMemoryPolicyStore } from "./policy-store";
import type { SovereigntyPolicy } from "./types";

const validPolicy: SovereigntyPolicy = {
  version: 1,
  org: "metafactory",
  egress: {
    block_local_escape: true,
    rules: [{ classification: "local", allowed_subjects: ["local.metafactory.>"] }],
  },
  ingress: { scope_mappings: [], reject_unknown_partners: true },
  chain_of_stamps: { verify_delegation_sovereignty: false },
};

describe("InMemoryPolicyStore", () => {
  it("starts unloaded when no initial policy", () => {
    const store = createInMemoryPolicyStore({ requirePolicy: false });
    expect(store.isLoaded()).toBe(false);
  });

  it("get() throws fail-closed when policy unloaded with requirePolicy", () => {
    const store = createInMemoryPolicyStore();
    expect(() => store.get()).toThrow(/fail-closed/);
  });

  it("loads with valid initial policy", () => {
    const store = createInMemoryPolicyStore({ initial: validPolicy });
    expect(store.isLoaded()).toBe(true);
    expect(store.get().org).toBe("metafactory");
  });

  it("rejects invalid initial policy", () => {
    expect(() =>
      createInMemoryPolicyStore({ initial: { ...validPolicy, version: 2 as any } }),
    ).toThrow(/invalid initial policy/);
  });

  it("set() swaps policy after validation", () => {
    const store = createInMemoryPolicyStore({ initial: validPolicy });
    const updated = { ...validPolicy, org: "other-org" };
    store.set(updated);
    expect(store.get().org).toBe("other-org");
  });

  it("set() rejects invalid update and retains old policy", () => {
    const store = createInMemoryPolicyStore({ initial: validPolicy });
    expect(() => store.set({ ...validPolicy, version: 99 as any })).toThrow(/invalid policy/);
    expect(store.get().org).toBe("metafactory");
  });

  it("close() resolves without error", async () => {
    const store = createInMemoryPolicyStore({ initial: validPolicy });
    await store.close();
    expect(store.isLoaded()).toBe(true);
  });
});
