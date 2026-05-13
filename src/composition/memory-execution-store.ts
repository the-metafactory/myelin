/* eslint-disable @typescript-eslint/require-await --
 *
 * In-memory adapter implementing the async `WorkflowExecutionStore`
 * contract. Every method must be async to satisfy the interface, but
 * the memory-backed body has no I/O to await. The KV-backed
 * implementation (deferred) will await its way through every method.
 */
import type {
  WorkflowExecutionEvent,
  WorkflowExecutionStore,
  WorkflowExecutionWatchOptions,
} from "./execution-store";
import type { WorkflowExecution } from "./types";

/**
 * F-16 T-5.2: in-memory implementation of `WorkflowExecutionStore`.
 *
 * Backs tests + single-process orchestrators. Production usage goes
 * through the (deferred) NATS KV store.
 *
 * Why a closure factory rather than a class (as in
 * `src/discovery/memory-store.ts`)? F-5 modules (createKVPolicyStore,
 * createAuditLog, createSovereigntyEngine, createSovereignTransport)
 * all adopt the closure-factory shape. This file aligns with the F-5
 * convention rather than the F-11 class shape. The semantic surface
 * (revisionCounter, per-watcher wakers queue, async-iterable) is
 * equivalent — only the assembly differs.
 *
 * Cloning:
 *   - `put` / initial seed deep-clone the input via `structuredClone`
 *     so caller mutations after the call don't corrupt the store.
 *   - `get` / `listRunning` / `snapshot` clone the result so caller
 *     mutations of the returned value don't bleed back into the
 *     store.
 *   - `fanout` clones the event PER watcher so one watcher mutating
 *     its received event cannot bleed into a sibling watcher.
 *   - Matches the serialise-on-write / deserialise-on-read semantics
 *     a future NATS KV impl will give.
 *
 * Watcher implementation:
 *   - Each watcher owns its own queue + wakers array. The wakers
 *     array supports the (unusual) case of concurrent `next()` calls
 *     on the same iterator; the FIFO drain handles backpressure.
 *   - `watch({ startRevision })` filters out events with
 *     `revision < startRevision`. The in-memory impl has no
 *     disconnect to resume from, but the filter still works
 *     deterministically so tests can lock cursor behavior.
 *   - `maxQueueSize` (default unbounded for tests, set explicitly in
 *     production embeddings) drops the oldest queued event when the
 *     queue would exceed the cap and increments `dropCount`. A
 *     `__droppedCount(watcher)` is not exposed publicly — production
 *     should swap to the NATS KV impl which buffers in JetStream.
 *   - On `close()`, every pending watcher resolves its `next()` to
 *     `{ value: undefined, done: true }` so consumers exit cleanly.
 *   - `iterator.return()` (the path the runtime takes when a `for
 *     await` consumer breaks early) silently drops queued events
 *     because by definition the consumer has signalled it does not
 *     want them. `recover()` callers should re-read `listRunning()`
 *     instead of relying on never-missed events from `watch()`.
 *
 * Forward-looking: PR-3 will add a third async-iterable watcher
 * (NATSKVWorkflowExecutionStore). At that point the watcher
 * machinery should be extracted into a shared
 * `createAsyncIterableWatcher<T>()` helper — not yet, to keep this
 * PR scoped to T-5.x.
 */

export interface InMemoryWorkflowExecutionStoreOptions {
  /** Pre-populated executions, keyed by `execution_id`. Defaults to empty. */
  initial?: WorkflowExecution[];
  /**
   * Cap on per-watcher buffered events. Default `Infinity` (unbounded)
   * is appropriate for tests; production embeddings should set this
   * explicitly. On overflow the oldest queued event is dropped.
   */
  maxQueueSize?: number;
}

export interface InMemoryWorkflowExecutionStore extends WorkflowExecutionStore {
  /** Snapshot of every execution currently in the store (cloned). */
  snapshot(): WorkflowExecution[];
  /** Current revision counter — increments on every put/delete. */
  currentRevision(): number;
}

interface Watcher {
  queue: WorkflowExecutionEvent[];
  wakers: ((value: IteratorResult<WorkflowExecutionEvent>) => void)[];
  closed: boolean;
  startRevision: number;
  droppedCount: number;
}

export function createInMemoryWorkflowExecutionStore(
  options: InMemoryWorkflowExecutionStoreOptions = {},
): InMemoryWorkflowExecutionStore {
  const records = new Map<string, WorkflowExecution>();
  const watchers = new Set<Watcher>();
  const maxQueueSize = options.maxQueueSize ?? Number.POSITIVE_INFINITY;
  let revisionCounter = 0;
  let closed = false;

  for (const initial of options.initial ?? []) {
    records.set(initial.execution_id, structuredClone(initial));
  }

  function emit(operation: "put" | "delete", execution: WorkflowExecution): void {
    revisionCounter += 1;
    const revision = revisionCounter;
    for (const watcher of watchers) {
      if (watcher.closed) continue;
      if (revision < watcher.startRevision) continue;
      const evt: WorkflowExecutionEvent = {
        operation,
        revision,
        execution: structuredClone(execution),
      };
      const waker = watcher.wakers.shift();
      if (waker) {
        waker({ value: evt, done: false });
        continue;
      }
      if (watcher.queue.length >= maxQueueSize) {
        watcher.queue.shift();
        watcher.droppedCount += 1;
      }
      watcher.queue.push(evt);
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
      emit("put", cloned);
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
      emit("delete", existing);
    },

    watch(opts?: WorkflowExecutionWatchOptions) {
      const watcher: Watcher = {
        queue: [],
        wakers: [],
        closed: false,
        startRevision: opts?.startRevision ?? 0,
        droppedCount: 0,
      };
      watchers.add(watcher);

      const iterator: AsyncIterator<WorkflowExecutionEvent> = {
        async next() {
          if (watcher.queue.length > 0) {
            // Length guard above guarantees non-empty queue.
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            return { value: watcher.queue.shift()!, done: false };
          }
          if (watcher.closed || closed) {
            return { value: undefined, done: true };
          }
          return new Promise<IteratorResult<WorkflowExecutionEvent>>((resolve) => {
            watcher.wakers.push(resolve);
          });
        },
        async return() {
          // Consumer break — drop any queued events (consumer has
          // signalled it does not want them) and release the
          // watcher slot.
          watcher.closed = true;
          watchers.delete(watcher);
          watcher.queue.length = 0;
          for (const waker of watcher.wakers) {
            waker({ value: undefined, done: true });
          }
          watcher.wakers.length = 0;
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
        for (const waker of watcher.wakers) {
          waker({ value: undefined, done: true });
        }
        watcher.wakers.length = 0;
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

    currentRevision() {
      return revisionCounter;
    },
  };
}
