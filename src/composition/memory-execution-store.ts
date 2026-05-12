import type {
  WorkflowExecutionEvent,
  WorkflowExecutionStore,
} from "./execution-store";
import type { WorkflowExecution } from "./types";

/**
 * F-16 T-5.2: in-memory implementation of `WorkflowExecutionStore`.
 *
 * Backs tests + single-process orchestrators. Holds a `Map` keyed
 * on `execution_id` and a small set of active watchers. Production
 * usage goes through the (deferred) NATS KV store.
 *
 * Watcher implementation:
 *   - `watch()` returns an async-iterable that fans out every
 *     subsequent `put` / `delete` until the store closes.
 *   - Each watcher owns its own bounded queue. The queue grows
 *     unbounded by design — fan-out volumes for in-memory tests
 *     are small and bounding would hide ordering bugs in the
 *     orchestrator under test.
 *   - On `close()`, every pending watcher resolves its `next()` to
 *     `{ value: undefined, done: true }` so consumers exit cleanly.
 *   - A watcher that returns early (`break` in a `for await`) drops
 *     itself from the active set on the next `return()` call.
 *
 * Cloning:
 *   - `put` deep-clones the input via `structuredClone` so callers
 *     mutating the original after `put` don't corrupt the stored
 *     record. `get` and `listRunning` likewise clone the result so
 *     mutations on the returned value don't bleed back into the
 *     store. This matches the semantics a real KV-backed store will
 *     give (serialise-on-write, deserialise-on-read).
 */

export interface InMemoryWorkflowExecutionStoreOptions {
  /** Pre-populated executions, keyed by `execution_id`. Defaults to empty. */
  initial?: WorkflowExecution[];
}

export interface InMemoryWorkflowExecutionStore extends WorkflowExecutionStore {
  /** Snapshot of every execution currently in the store (cloned). */
  snapshot(): WorkflowExecution[];
}

interface Watcher {
  queue: WorkflowExecutionEvent[];
  pending?: {
    resolve: (value: IteratorResult<WorkflowExecutionEvent>) => void;
  };
  closed: boolean;
}

export function createInMemoryWorkflowExecutionStore(
  options: InMemoryWorkflowExecutionStoreOptions = {},
): InMemoryWorkflowExecutionStore {
  const records = new Map<string, WorkflowExecution>();
  const watchers = new Set<Watcher>();
  let closed = false;

  for (const initial of options.initial ?? []) {
    records.set(initial.execution_id, structuredClone(initial));
  }

  function fanout(event: WorkflowExecutionEvent): void {
    for (const watcher of watchers) {
      if (watcher.closed) continue;
      if (watcher.pending) {
        const { resolve } = watcher.pending;
        watcher.pending = undefined;
        resolve({ value: event, done: false });
      } else {
        watcher.queue.push(event);
      }
    }
  }

  function rejectIfClosed(): void {
    if (closed) {
      throw new Error("InMemoryWorkflowExecutionStore is closed");
    }
  }

  return {
    async put(execution) {
      rejectIfClosed();
      const cloned = structuredClone(execution);
      records.set(cloned.execution_id, cloned);
      fanout({ operation: "put", execution: structuredClone(cloned) });
    },

    async get(execution_id) {
      rejectIfClosed();
      const record = records.get(execution_id);
      return record ? structuredClone(record) : null;
    },

    async listRunning() {
      rejectIfClosed();
      const out: WorkflowExecution[] = [];
      for (const record of records.values()) {
        if (record.status === "running") out.push(structuredClone(record));
      }
      return out;
    },

    async delete(execution_id) {
      rejectIfClosed();
      const existing = records.get(execution_id);
      if (!existing) return;
      records.delete(execution_id);
      fanout({ operation: "delete", execution: structuredClone(existing) });
    },

    watch() {
      const watcher: Watcher = { queue: [], closed: false };
      watchers.add(watcher);

      const iterator: AsyncIterator<WorkflowExecutionEvent> = {
        async next() {
          if (watcher.queue.length > 0) {
            return { value: watcher.queue.shift()!, done: false };
          }
          if (watcher.closed || closed) {
            return { value: undefined, done: true };
          }
          return new Promise<IteratorResult<WorkflowExecutionEvent>>((resolve) => {
            watcher.pending = { resolve };
          });
        },
        async return() {
          watcher.closed = true;
          watchers.delete(watcher);
          if (watcher.pending) {
            const { resolve } = watcher.pending;
            watcher.pending = undefined;
            resolve({ value: undefined, done: true });
          }
          return { value: undefined, done: true };
        },
      };

      return {
        [Symbol.asyncIterator]: () => iterator,
      };
    },

    async close() {
      if (closed) return;
      closed = true;
      for (const watcher of watchers) {
        watcher.closed = true;
        if (watcher.pending) {
          const { resolve } = watcher.pending;
          watcher.pending = undefined;
          resolve({ value: undefined, done: true });
        }
      }
      watchers.clear();
    },

    snapshot() {
      const out: WorkflowExecution[] = [];
      for (const record of records.values()) {
        out.push(structuredClone(record));
      }
      return out;
    },
  };
}
