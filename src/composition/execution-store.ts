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
  execution: WorkflowExecution;
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
   * event. The iterator terminates when `close()` is invoked.
   */
  watch(): AsyncIterable<WorkflowExecutionEvent>;

  /** Release resources. Subsequent operations should reject or no-op. */
  close(): Promise<void>;
}
