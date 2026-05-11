import type { KV, KvWatchEntry } from "@nats-io/kv";
import type { QueuedIterator } from "@nats-io/nats-core";
import type { SovereigntyPolicy } from "./types";
import { describeErrors, validatePolicy } from "./schema";
import { clearSubjectPatternCache } from "../subject-matching";

/**
 * F-5 sovereignty policy backing store. Production uses
 * `createKVPolicyStore` against a NATS KV bucket (canonical
 * `SOVEREIGNTY_POLICY`, key `config`). `createInMemoryPolicyStore`
 * is the unit-test backing — it satisfies the same interface and
 * exposes a `set()` helper for tests that need to mutate the
 * cached policy without a backing source.
 */
export interface PolicyStore {
  /** Returns cached policy. Throws when unloaded and `requirePolicy` is true. */
  get(): SovereigntyPolicy;
  isLoaded(): boolean;
  /** Refresh cached policy from the backing source. No-op for in-memory. */
  reload(): Promise<void>;
  /** Subscribe to backing-source updates for hot reload. No-op for in-memory. */
  watch(): Promise<void>;
  /** Stop the hot-reload subscription. No-op for in-memory. */
  unwatch(): Promise<void>;
  /** Release backing-source resources. */
  close(): Promise<void>;
}

export interface InMemoryPolicyStoreOptions {
  initial?: SovereigntyPolicy;
  requirePolicy?: boolean;
}

/** Backwards-compatible alias kept so older callers compile. */
export type PolicyStoreOptions = InMemoryPolicyStoreOptions;

/**
 * In-memory PolicyStore with an extra `set()` helper for tests.
 * The watch/unwatch/reload methods are no-ops; tests drive policy
 * changes via `set()` instead of a live backing source.
 */
export interface InMemoryPolicyStore extends PolicyStore {
  set(policy: SovereigntyPolicy): void;
}

export function createInMemoryPolicyStore(options: InMemoryPolicyStoreOptions = {}): InMemoryPolicyStore {
  const requirePolicy = options.requirePolicy ?? true;
  let cached: SovereigntyPolicy | null = null;

  if (options.initial) {
    const result = validatePolicy(options.initial);
    if (!result.valid) {
      throw new Error(`invalid initial policy: ${describeErrors(result.errors)}`);
    }
    cached = options.initial;
    // Initial policy load is a swap from "no policy" → "policy"; drop
    // any patterns the cache may hold from a prior store lifetime.
    clearSubjectPatternCache();
  }

  return {
    get(): SovereigntyPolicy {
      if (cached === null) {
        if (requirePolicy) throw new Error("sovereignty policy not loaded (fail-closed)");
        throw new Error("sovereignty policy not set");
      }
      return cached;
    },
    isLoaded(): boolean {
      return cached !== null;
    },
    set(policy: SovereigntyPolicy): void {
      const result = validatePolicy(policy);
      if (!result.valid) {
        throw new Error(`invalid policy: ${describeErrors(result.errors)}`);
      }
      cached = policy;
      // Drop compiled patterns from the prior policy so the cache
      // doesn't retain entries that are no longer reachable.
      clearSubjectPatternCache();
    },
    async reload(): Promise<void> {},
    async watch(): Promise<void> {},
    async unwatch(): Promise<void> {},
    async close(): Promise<void> {},
  };
}

export interface KVPolicyStoreOptions {
  /** Opened NATS KV handle (typically `new Kvm(js).create("SOVEREIGNTY_POLICY")`). */
  kv: KV;
  /** Key inside the bucket holding the JSON-encoded policy. Defaults to `config`. */
  key?: string;
  /** When true (default), `get()`/`reload()` throw on missing or invalid policy. */
  requirePolicy?: boolean;
  /** Debounce window for rapid KV updates, milliseconds. Defaults to 100. */
  debounceMs?: number;
  /**
   * Callback invoked when a KV update arrives but fails validation. The
   * previous policy is retained. Defaults to `console.error`.
   */
  onInvalidUpdate?: (error: Error, raw: unknown) => void;
}

/**
 * KV-backed PolicyStore. Loads policy from `kv.get(key)` on `reload()`,
 * hot-reloads via `kv.watch()` while a watch subscription is active.
 *
 * Behavior contract:
 *   - `reload()` fetches the current value once. Missing policy with
 *     `requirePolicy: true` (default) throws. Invalid policy throws.
 *   - `watch()` opens a KV watcher on the configured key. Each KV PUT
 *     is debounced (default 100ms) — only the last write in a burst
 *     triggers the validation + swap. Invalid updates fire
 *     `onInvalidUpdate` and retain the previous policy.
 *   - `unwatch()` / `close()` stop the watcher and release the async
 *     iterator. The store remains queryable via `get()` afterward.
 */
export function createKVPolicyStore(options: KVPolicyStoreOptions): PolicyStore {
  const { kv } = options;
  const key = options.key ?? "config";
  const requirePolicy = options.requirePolicy ?? true;
  const debounceMs = options.debounceMs ?? 100;
  const onInvalidUpdate =
    options.onInvalidUpdate ??
    ((err, raw) => {
      console.error(`[sovereignty] KV policy update rejected: ${err.message}`, { raw });
    });

  let cached: SovereigntyPolicy | null = null;
  let watcher: QueuedIterator<KvWatchEntry> | null = null;
  let watchPump: Promise<void> | null = null;
  let pendingDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingRaw: unknown = undefined;
  let pendingHasValue = false;
  let closed = false;

  function applyRaw(raw: unknown): void {
    const result = validatePolicy(raw);
    if (!result.valid) {
      onInvalidUpdate(
        new Error(`invalid sovereignty policy: ${describeErrors(result.errors)}`),
        raw,
      );
      return;
    }
    cached = raw as SovereigntyPolicy;
    // Hot-reload swap: drop compiled patterns from the prior policy
    // so subsequent validations recompile against the new pattern set.
    clearSubjectPatternCache();
  }

  function flushPending(): void {
    pendingDebounceTimer = null;
    if (!pendingHasValue) return;
    const raw = pendingRaw;
    pendingRaw = undefined;
    pendingHasValue = false;
    applyRaw(raw);
  }

  function schedulePending(raw: unknown): void {
    pendingRaw = raw;
    pendingHasValue = true;
    if (pendingDebounceTimer) clearTimeout(pendingDebounceTimer);
    pendingDebounceTimer = setTimeout(flushPending, debounceMs);
  }

  async function pumpWatcher(iter: QueuedIterator<KvWatchEntry>): Promise<void> {
    try {
      for await (const entry of iter) {
        if (closed) break;
        if (entry.operation !== "PUT") continue;
        let parsed: unknown;
        try {
          parsed = entry.json<unknown>();
        } catch (err) {
          onInvalidUpdate(
            err instanceof Error ? err : new Error(String(err)),
            entry.string?.() ?? null,
          );
          continue;
        }
        schedulePending(parsed);
      }
    } catch (err) {
      // Expected terminal states: caller stopped the watcher (close/unwatch)
      // or NATS disconnected — both leave `closed` or `watcher === null`,
      // so swallow silently. Anything else is a real bug in the loop body;
      // surface it via the onInvalidUpdate hook so it isn't lost.
      if (!closed && watcher !== null) {
        onInvalidUpdate(err instanceof Error ? err : new Error(String(err)), null);
      }
    }
  }

  async function doUnwatch(): Promise<void> {
    const w = watcher;
    const pump = watchPump;
    watcher = null;
    watchPump = null;
    if (pendingDebounceTimer) {
      clearTimeout(pendingDebounceTimer);
      pendingDebounceTimer = null;
      pendingHasValue = false;
      pendingRaw = undefined;
    }
    if (w) w.stop();
    if (pump) await pump;
  }

  return {
    get(): SovereigntyPolicy {
      if (cached === null) {
        if (requirePolicy) throw new Error("sovereignty policy not loaded (fail-closed)");
        throw new Error("sovereignty policy not set");
      }
      return cached;
    },
    isLoaded(): boolean {
      return cached !== null;
    },
    async reload(): Promise<void> {
      const entry = await kv.get(key);
      if (entry === null || entry.operation !== "PUT") {
        if (requirePolicy) {
          throw new Error(
            `sovereignty policy missing in KV (key '${key}') — fail-closed: provision the policy before starting the engine`,
          );
        }
        cached = null;
        return;
      }
      let raw: unknown;
      try {
        raw = entry.json<unknown>();
      } catch (err) {
        throw new Error(
          `sovereignty policy at KV key '${key}' is not valid JSON: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      const result = validatePolicy(raw);
      if (!result.valid) {
        throw new Error(`invalid sovereignty policy in KV: ${describeErrors(result.errors)}`);
      }
      cached = raw as SovereigntyPolicy;
      // Drop compiled patterns from any prior policy so the cache
      // doesn't retain unreachable entries across reloads.
      clearSubjectPatternCache();
    },
    async watch(): Promise<void> {
      if (watcher) return;
      watcher = await kv.watch({ key, ignoreDeletes: true });
      watchPump = pumpWatcher(watcher);
    },
    async unwatch(): Promise<void> {
      await doUnwatch();
    },
    async close(): Promise<void> {
      closed = true;
      await doUnwatch();
    },
  };
}
