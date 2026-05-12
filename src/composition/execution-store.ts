import type { WorkflowExecution } from "./types";

/**
 * F-16 T-5.1: persistence contract for in-flight workflow
 * executions. Two implementations land alongside this interface:
 *
 *   - `InMemoryWorkflowExecutionStore` (T-5.2, this PR) — backs
 *     tests and single-process orchestrators.
 *   - `NATSKVWorkflowExecutionStore` (deferred) — backs production
 *     orchestrators that must survive process restart, hot reload,
 *     and cross-instance failover. The KV bucket convention mirrors
 *     `AGENT_CAPABILITIES` from F-11.
 *
 * Contract notes:
 *   - `put` is upsert. Callers pass a complete `WorkflowExecution`
 *     and the store replaces the prior record atomically (single
 *     setKey for in-memory; KV `update`/`create` for the NATS impl).
 *   - `get` returns `null` for an unknown ID rather than throwing,
 *     so the orchestrator can branch cleanly on first-call vs
 *     recovery without try/catch.
 *   - `listRunning` filters by `status === "running"`. The
 *     orchestrator calls this on boot to rehydrate state via
 *     `recover()` (T-8.1).
 *   - `delete` is a cleanup hook for completed executions. Production
 *     deployments typically run a retention sweep rather than
 *     deleting per-execution from the orchestrator hot path.
 *   - `watch` is async-iterable and produces `WorkflowExecutionEvent`
 *     records. External observers (Cortex UI, audit aggregators)
 *     consume this; the orchestrator itself does not.
 *   - `close` is idempotent — repeated calls must not throw. The
 *     in-memory impl additionally guarantees that pending `watch`
 *     iterators terminate cleanly on close.
 */

export type WorkflowExecutionEventKind = "put" | "delete";

export interface WorkflowExecutionEvent {
  operation: WorkflowExecutionEventKind;
  /** Monotonically-increasing revision assigned at write time. */
  revision: number;
  execution: WorkflowExecution;
}

/**
 * Per-watcher options. `startRevision` mirrors the sibling
 * `CapabilityStore.watch({ startRevision })` from F-11; the NATS KV
 * impl will use it to resume after disconnect. The in-memory impl
 * accepts the parameter for shape parity and emits a deterministic
 * filter so tests can pin-point cursor behavior even though
 * in-memory has no disconnect to resume from.
 */
export interface WorkflowExecutionWatchOptions {
  /** When set, only events with `revision >= startRevision` are emitted. */
  startRevision?: number;
}

export interface WorkflowExecutionStore {
  /** Insert or replace an execution by `execution_id`. */
  put(execution: WorkflowExecution): Promise<void>;

  /** Fetch an execution by ID, or `null` when unknown. */
  get(execution_id: string): Promise<WorkflowExecution | null>;

  /** All executions whose `status` is currently `"running"`. */
  listRunning(): Promise<WorkflowExecution[]>;

  /** Remove an execution. Idempotent — no-op when ID is unknown. */
  delete(execution_id: string): Promise<void>;

  /**
   * Async-iterable change feed. Each `put` or `delete` produces one
   * event. The iterator terminates when `close()` is invoked or the
   * consumer breaks out of the `for await` early.
   *
   * Buffered events are dropped on consumer-initiated early break;
   * the orchestrator's `recover()` should re-read `listRunning()`
   * rather than rely on missed events.
   */
  watch(options?: WorkflowExecutionWatchOptions): AsyncIterable<WorkflowExecutionEvent>;

  /** Release resources. Subsequent operations should reject or no-op. */
  close(): Promise<void>;
}
