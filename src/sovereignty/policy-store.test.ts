import { describe, it, expect } from "bun:test";
import type { KV, KvEntry, KvWatchEntry, KvWatchOptions } from "@nats-io/kv";
import type { QueuedIterator } from "@nats-io/nats-core";
import { createInMemoryPolicyStore, createKVPolicyStore } from "./policy-store";
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

const otherOrgPolicy: SovereigntyPolicy = { ...validPolicy, org: "other-org" };

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
      createInMemoryPolicyStore({ initial: { ...validPolicy, version: 2 as unknown as 1 } }),
    ).toThrow(/invalid initial policy/);
  });

  it("set() swaps policy after validation", () => {
    const store = createInMemoryPolicyStore({ initial: validPolicy });
    store.set(otherOrgPolicy);
    expect(store.get().org).toBe("other-org");
  });

  it("set() rejects invalid update and retains old policy", () => {
    const store = createInMemoryPolicyStore({ initial: validPolicy });
    expect(() => store.set({ ...validPolicy, version: 99 as unknown as 1 })).toThrow(/invalid policy/);
    expect(store.get().org).toBe("metafactory");
  });

  it("reload/watch/unwatch are no-ops on in-memory store", async () => {
    const store = createInMemoryPolicyStore({ initial: validPolicy });
    await store.reload();
    await store.watch();
    await store.unwatch();
    expect(store.get().org).toBe("metafactory");
  });

  it("close() resolves without error", async () => {
    const store = createInMemoryPolicyStore({ initial: validPolicy });
    await store.close();
    expect(store.isLoaded()).toBe(true);
  });
});

interface FakeKvEntry {
  data: Uint8Array;
  operation: "PUT" | "DEL" | "PURGE";
}

class FakeWatcher implements QueuedIterator<KvWatchEntry> {
  private readonly queue: KvWatchEntry[] = [];
  private wake: (() => void) | null = null;
  private stopped = false;

  push(entry: KvWatchEntry): void {
    if (this.stopped) return;
    this.queue.push(entry);
    const w = this.wake;
    this.wake = null;
    if (w) w();
  }

  stop(): void {
    this.stopped = true;
    const w = this.wake;
    this.wake = null;
    if (w) w();
  }

  getProcessed(): number { return 0; }
  getPending(): number { return this.queue.length; }
  getReceived(): number { return 0; }

  async *[Symbol.asyncIterator](): AsyncIterator<KvWatchEntry> {
    while (!this.stopped) {
      while (this.queue.length > 0) {
        yield this.queue.shift()!;
      }
      if (this.stopped) break;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
    }
  }
}

class FakeKv {
  readonly watchers = new Set<FakeWatcher>();
  private current: FakeKvEntry | null = null;
  private revision = 0;

  putJSON(value: unknown, options: { skipNotify?: boolean } = {}): void {
    const data = new TextEncoder().encode(JSON.stringify(value));
    this.current = { data, operation: "PUT" };
    this.revision += 1;
    if (!options.skipNotify) {
      for (const w of this.watchers) {
        w.push(this.makeWatchEntry(true));
      }
    }
  }

  putRawString(raw: string): void {
    const data = new TextEncoder().encode(raw);
    this.current = { data, operation: "PUT" };
    this.revision += 1;
    for (const w of this.watchers) {
      w.push(this.makeWatchEntry(true));
    }
  }

  clear(): void {
    this.current = null;
  }

  asKv(): KV {
    return this as unknown as KV;
  }

  async get(_key: string): Promise<KvEntry | null> {
    if (!this.current) return null;
    return this.makeEntry();
  }

  async watch(_opts?: KvWatchOptions): Promise<QueuedIterator<KvWatchEntry>> {
    const w = new FakeWatcher();
    this.watchers.add(w);
    return w;
  }

  private makeEntry(): KvEntry {
    const data = this.current!.data;
    const rev = this.revision;
    return {
      bucket: "TEST",
      key: "config",
      rawKey: "config",
      value: data,
      created: new Date(),
      revision: rev,
      operation: this.current!.operation,
      length: data.byteLength,
      json: <T>() => JSON.parse(new TextDecoder().decode(data)) as T,
      string: () => new TextDecoder().decode(data),
    };
  }

  private makeWatchEntry(isUpdate: boolean): KvWatchEntry {
    return { ...this.makeEntry(), isUpdate };
  }
}

async function tick(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe("KVPolicyStore", () => {
  describe("reload()", () => {
    it("loads policy from KV", async () => {
      const fake = new FakeKv();
      fake.putJSON(validPolicy);
      const store = createKVPolicyStore({ kv: fake.asKv() });
      await store.reload();
      expect(store.isLoaded()).toBe(true);
      expect(store.get().org).toBe("metafactory");
      await store.close();
    });

    it("fails closed when policy missing and requirePolicy is default", async () => {
      const fake = new FakeKv();
      const store = createKVPolicyStore({ kv: fake.asKv() });
      await expect(store.reload()).rejects.toThrow(/fail-closed/);
      expect(store.isLoaded()).toBe(false);
      await store.close();
    });

    it("allows missing policy when requirePolicy is false", async () => {
      const fake = new FakeKv();
      const store = createKVPolicyStore({ kv: fake.asKv(), requirePolicy: false });
      await store.reload();
      expect(store.isLoaded()).toBe(false);
      await store.close();
    });

    it("rejects malformed JSON", async () => {
      const fake = new FakeKv();
      fake.putRawString("{ not valid json");
      const store = createKVPolicyStore({ kv: fake.asKv() });
      await expect(store.reload()).rejects.toThrow(/not valid JSON/);
      await store.close();
    });

    it("rejects schema-invalid policy", async () => {
      const fake = new FakeKv();
      fake.putJSON({ ...validPolicy, version: 99 });
      const store = createKVPolicyStore({ kv: fake.asKv() });
      await expect(store.reload()).rejects.toThrow(/invalid sovereignty policy/);
      await store.close();
    });
  });

  describe("get()", () => {
    it("throws fail-closed when never reloaded", async () => {
      const fake = new FakeKv();
      fake.putJSON(validPolicy);
      const store = createKVPolicyStore({ kv: fake.asKv() });
      expect(() => store.get()).toThrow(/fail-closed/);
      await store.close();
    });
  });

  describe("watch() hot reload", () => {
    it("swaps cached policy when valid update arrives", async () => {
      const fake = new FakeKv();
      fake.putJSON(validPolicy, { skipNotify: true });
      const store = createKVPolicyStore({ kv: fake.asKv(), debounceMs: 5 });
      await store.reload();
      await store.watch();
      fake.putJSON(otherOrgPolicy);
      await tick(30);
      expect(store.get().org).toBe("other-org");
      await store.close();
    });

    it("retains previous policy on invalid update and calls onInvalidUpdate", async () => {
      const fake = new FakeKv();
      fake.putJSON(validPolicy, { skipNotify: true });
      const errors: Error[] = [];
      const store = createKVPolicyStore({
        kv: fake.asKv(),
        debounceMs: 5,
        onInvalidUpdate: (err) => errors.push(err),
      });
      await store.reload();
      await store.watch();
      fake.putJSON({ ...validPolicy, version: 99 });
      await tick(30);
      expect(store.get().org).toBe("metafactory");
      expect(errors.length).toBe(1);
      expect(errors[0]?.message).toMatch(/invalid sovereignty policy/);
      await store.close();
    });

    it("debounces rapid updates, applying only the last value", async () => {
      const fake = new FakeKv();
      fake.putJSON(validPolicy, { skipNotify: true });
      const store = createKVPolicyStore({ kv: fake.asKv(), debounceMs: 40 });
      await store.reload();
      await store.watch();
      fake.putJSON({ ...validPolicy, org: "burst-one" });
      fake.putJSON({ ...validPolicy, org: "burst-two" });
      fake.putJSON({ ...validPolicy, org: "burst-three" });
      await tick(10);
      expect(store.get().org).toBe("metafactory");
      await tick(60);
      expect(store.get().org).toBe("burst-three");
      await store.close();
    });

    it("unwatch() stops applying updates", async () => {
      const fake = new FakeKv();
      fake.putJSON(validPolicy, { skipNotify: true });
      const store = createKVPolicyStore({ kv: fake.asKv(), debounceMs: 5 });
      await store.reload();
      await store.watch();
      await store.unwatch();
      fake.putJSON(otherOrgPolicy);
      await tick(30);
      expect(store.get().org).toBe("metafactory");
      await store.close();
    });

    it("watch() called twice is idempotent", async () => {
      const fake = new FakeKv();
      fake.putJSON(validPolicy, { skipNotify: true });
      const store = createKVPolicyStore({ kv: fake.asKv(), debounceMs: 5 });
      await store.reload();
      await store.watch();
      await store.watch();
      expect(fake.watchers.size).toBe(1);
      await store.close();
    });
  });

  describe("close()", () => {
    it("stops the watcher and releases resources", async () => {
      const fake = new FakeKv();
      fake.putJSON(validPolicy, { skipNotify: true });
      const store = createKVPolicyStore({ kv: fake.asKv(), debounceMs: 5 });
      await store.reload();
      await store.watch();
      await store.close();
      const watcher = [...fake.watchers][0]! as FakeWatcher;
      expect(watcher.getPending()).toBe(0);
    });
  });
});
