import type {
  SignedCapabilityRegistration,
  CapabilityWatchEntry,
  CapabilityWatcher,
} from "./types";
import type { CapabilityStore } from "./store";

interface StoredEntry {
  registration: SignedCapabilityRegistration;
  revision: number;
}

/**
 * F-11 in-memory capability store for unit testing. Mirrors NATS KV
 * semantics enough to drive integration tests:
 *
 *   - put / get / delete keyed by advertisement.principal
 *   - revision auto-increments on each put / delete
 *   - watch() returns an async iterable that emits PUT / DELETE / PURGE
 *     events; multiple watchers can run concurrently and each receives
 *     every subsequent event
 *
 * Not thread-safe and not ttl-aware — that's the NATS-backed impl's job.
 */
export class InMemoryCapabilityStore implements CapabilityStore {
  private readonly entries = new Map<string, StoredEntry>();
  private revisionCounter = 0;
  private readonly watchers = new Set<(entry: CapabilityWatchEntry) => void>();
  private closed = false;

  async put(registration: SignedCapabilityRegistration): Promise<void> {
    if (this.closed) throw new Error("InMemoryCapabilityStore: closed");
    const key = registration.advertisement.principal;
    const revision = ++this.revisionCounter;
    this.entries.set(key, { registration, revision });
    this.emit({ operation: "put", key, revision, registration });
  }

  async get(principal: string): Promise<SignedCapabilityRegistration | null> {
    return this.entries.get(principal)?.registration ?? null;
  }

  async delete(principal: string): Promise<void> {
    if (!this.entries.has(principal)) return;
    this.entries.delete(principal);
    const revision = ++this.revisionCounter;
    this.emit({ operation: "delete", key: principal, revision });
  }

  async list(): Promise<SignedCapabilityRegistration[]> {
    return [...this.entries.values()].map((e) => e.registration);
  }

  watch(_options?: { startRevision?: number }): CapabilityWatcher {
    const queue: CapabilityWatchEntry[] = [];
    const wakers: (() => void)[] = [];
    let stopped = false;

    const subscriber = (entry: CapabilityWatchEntry) => {
      if (stopped) return;
      queue.push(entry);
      const waker = wakers.shift();
      if (waker) waker();
    };
    this.watchers.add(subscriber);

    const self = this;
    return {
      async *[Symbol.asyncIterator]() {
        try {
          while (!stopped && !self.closed) {
            if (queue.length === 0) {
              await new Promise<void>((resolve) => {
                wakers.push(resolve);
                if (stopped || self.closed) resolve();
              });
            }
            while (queue.length > 0) yield queue.shift()!;
          }
        } finally {
          stopped = true;
          self.watchers.delete(subscriber);
        }
      },
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    // Wake any pending iterators so they observe `closed` and exit.
    for (const w of this.watchers) w({ operation: "purge", key: "_close", revision: -1 });
    this.watchers.clear();
  }

  private emit(entry: CapabilityWatchEntry): void {
    for (const w of this.watchers) w(entry);
  }
}
