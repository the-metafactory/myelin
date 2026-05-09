import type {
  SignedCapabilityRegistration,
  CapabilityWatcher,
} from "./types";

/**
 * F-11 abstract capability store. NATS KV is the canonical
 * implementation (`NATSCapabilityStore`, deferred to follow-up issue);
 * `InMemoryCapabilityStore` is the unit-test backing.
 *
 * The watcher is an async iterable so consumers can `for await` and
 * fan events into their own pipeline.
 */
export interface CapabilityStore {
  put(registration: SignedCapabilityRegistration): Promise<void>;
  get(principal: string): Promise<SignedCapabilityRegistration | null>;
  delete(principal: string): Promise<void>;
  list(): Promise<SignedCapabilityRegistration[]>;
  watch(options?: { startRevision?: number }): CapabilityWatcher;
  close(): Promise<void>;
}
