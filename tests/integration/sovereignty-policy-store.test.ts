/**
 * F-5 T-2.x integration test for the KV-backed PolicyStore.
 *
 * Runs only when NATS_URL is set (CI sets this via docker-compose.test.yml).
 * The test provisions a fresh KV bucket per case, exercises load /
 * hot-reload / invalid-retain semantics against a live NATS server,
 * and tears the bucket down via Kvm.destroy().
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { connect } from "@nats-io/transport-node";
import type { NatsConnection } from "@nats-io/nats-core";
import { Kvm } from "@nats-io/kv";
import type { KV } from "@nats-io/kv";
import { createKVPolicyStore } from "../../src/sovereignty/policy-store";
import type { SovereigntyPolicy } from "../../src/sovereignty/types";
import { hasNats, NATS_URL, testPrefix, waitFor } from "./setup";

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

const otherOrgPolicy: SovereigntyPolicy = { ...validPolicy, org: "other-org" };

const suite = hasNats ? describe : describe.skip;

suite("F-5 KVPolicyStore (integration)", () => {
  let nc: NatsConnection;
  let kvm: Kvm;
  const bucketsCreated: string[] = [];

  beforeAll(async () => {
    if (!hasNats) return;
    nc = await connect({ servers: NATS_URL, name: "myelin-test-policy-store" });
    kvm = new Kvm(nc);
  });

  afterAll(async () => {
    if (!hasNats) return;
    for (const bucket of bucketsCreated) {
      try {
        const kv = await kvm.open(bucket);
        await kv.destroy();
      } catch {
        // best-effort cleanup
      }
    }
    await nc.close();
  });

  async function freshBucket(): Promise<KV> {
    const name = testPrefix("SOV_POLICY");
    bucketsCreated.push(name);
    return kvm.create(name, { history: 5 });
  }

  it("loads policy from KV on reload()", async () => {
    const kv = await freshBucket();
    await kv.put("config", JSON.stringify(validPolicy));
    const store = createKVPolicyStore({ kv });
    await store.reload();
    expect(store.isLoaded()).toBe(true);
    expect(store.get().org).toBe("metafactory");
    await store.close();
  });

  it("fail-closed when KV has no policy", async () => {
    const kv = await freshBucket();
    const store = createKVPolicyStore({ kv });
    await expect(store.reload()).rejects.toThrow(/fail-closed/);
    await store.close();
  });

  it("hot-reload swaps policy when KV update arrives", async () => {
    const kv = await freshBucket();
    await kv.put("config", JSON.stringify(validPolicy));
    const store = createKVPolicyStore({ kv, debounceMs: 50 });
    await store.reload();
    await store.watch();

    await kv.put("config", JSON.stringify(otherOrgPolicy));
    await waitFor(() => store.get().org === "other-org", {
      timeoutMs: 2000,
      intervalMs: 25,
      message: "hot-reload did not pick up the KV update",
    });

    await store.close();
  });

  it("retains previous policy when KV receives invalid JSON update", async () => {
    const kv = await freshBucket();
    await kv.put("config", JSON.stringify(validPolicy));
    const errors: Error[] = [];
    const store = createKVPolicyStore({
      kv,
      debounceMs: 25,
      onInvalidUpdate: (err) => errors.push(err),
    });
    await store.reload();
    await store.watch();

    await kv.put("config", JSON.stringify({ ...validPolicy, version: 99 }));
    await waitFor(() => errors.length > 0, {
      timeoutMs: 2000,
      intervalMs: 25,
      message: "expected onInvalidUpdate to fire",
    });

    expect(store.get().org).toBe("metafactory");
    expect(errors[0]?.message).toMatch(/invalid sovereignty policy/);

    await store.close();
  });

  it("close() stops watch — no further updates applied", async () => {
    const kv = await freshBucket();
    await kv.put("config", JSON.stringify(validPolicy));
    const store = createKVPolicyStore({ kv, debounceMs: 25 });
    await store.reload();
    await store.watch();
    await store.close();

    await kv.put("config", JSON.stringify(otherOrgPolicy));
    // Wait long enough for any in-flight debounce to fire if the watcher
    // were still active.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(store.get().org).toBe("metafactory");
  });
});
