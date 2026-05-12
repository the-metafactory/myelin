/**
 * F-16: composition orchestrator vocabulary.
 *
 * Thin slice: types + definition-load-time validation + lifecycle event
 * names. The runtime executor (which routes envelopes through the
 * workflow steps via JetStream + capability registry) is deferred to
 * a follow-up that can build on F-11 + F-13.
 */

export type FailureStrategy = "abort" | "skip-step" | "continue";

/**
 * Schema descriptor — opaque to the orchestrator. Consumers attach
 * whatever schema language they want (JSON Schema, Zod, custom).
 * Compatibility checking is structural via `compatibility_key`:
 * adjacent steps are compatible if the upstream output's
 * compatibility_key matches the downstream input's compatibility_key.
 *
 * Strict semantic compatibility requires real schema evaluation, which
 * lives outside the orchestrator. The compatibility_key is the
 * coarsest mechanical check that catches most accidental mismatches
 * at definition load time.
 */
export interface InterfaceSchema {
  /** Cross-step compatibility tag (e.g., "review.result.v1"). */
  compatibility_key: string;
  /** Optional human-readable description. */
  description?: string;
}

export type StepKind = "sequential" | "fan-out" | "fan-in";

export interface WorkflowStep {
  /** Unique step identifier within the workflow. */
  id: string;
  /** Capability tag this step requires (matches F-11 vocabulary). */
  capability: string;
  /** Step kind. Sequential is the default; fan-out/fan-in describe topology. */
  kind?: StepKind;
  /** Input interface contract. */
  input: InterfaceSchema;
  /** Output interface contract. */
  output: InterfaceSchema;
  /** Per-step timeout. Falls back to workflow-level timeout when absent. */
  timeout_ms?: number;
  /** Step-specific failure override. Falls back to workflow on_failure. */
  on_failure?: FailureStrategy;
  /** IDs of parent steps (for fan-in) or children (for fan-out). */
  next?: string[];
}

export interface WorkflowDefinition {
  /** Unique workflow identifier (UUID, ULID, or stable slug). */
  id: string;
  name: string;
  /** Semver for schema evolution. */
  version: string;
  description?: string;
  steps: WorkflowStep[];
  /** Default failure strategy when a step doesn't override. */
  on_failure?: FailureStrategy;
  /** Workflow-level timeout. Default 30 min when not set. */
  timeout_ms?: number;
}

export type WorkflowLifecycleEventType =
  | "workflow.started"
  | "workflow.step.started"
  | "workflow.step.completed"
  | "workflow.step.failed"
  | "workflow.completed"
  | "workflow.failed";

export interface WorkflowLifecyclePayload {
  workflow_id: string;
  /** Run-scoped correlation_id; all events for one execution share this. */
  correlation_id: string;
  /** Step id when the event is step-scoped. */
  step_id?: string;
  /** Capability when the event is step-scoped. */
  capability?: string;
  /** Failure detail when type is *.failed. */
  reason?: string;
  /** Why a step was skipped, if applicable. */
  skipped_reason?: string;
}

/**
 * F-16 T-5.x execution state types.
 *
 * `WorkflowExecution` is the runtime record an orchestrator owns
 * while a workflow is in flight. It carries the IDs needed for
 * cross-envelope correlation, the live step status map, and enough
 * metadata for an orchestrator to pick up after restart (see
 * `last_checkpoint_at` + `retry_count`).
 *
 * `StepError.code` is a closed enum that bridges F-16's failure
 * vocabulary to F-22's structured nak reasons:
 * - `"timeout"`, `"schema-mismatch"`, `"agent-error"`, `"no-agent"`,
 *   `"validation-failed"` — orchestrator-side error classes.
 * - `"nak-cant-do"`, `"nak-wont-do"`, `"nak-not-now"`,
 *   `"dead-letter"` — derived from F-22 nak reason codes when an
 *   agent rejects the dispatch.
 */

export type ExecutionStatus = "running" | "completed" | "failed" | "aborted";

export type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export type StepErrorCode =
  | "timeout"
  | "schema-mismatch"
  | "agent-error"
  | "no-agent"
  | "validation-failed"
  | "nak-cant-do"
  | "nak-wont-do"
  | "nak-not-now"
  | "dead-letter";

export interface StepError {
  code: StepErrorCode;
  message: string;
  details?: unknown;
}

export interface StepResult {
  step_id: string;
  status: StepStatus;
  /** Present on `status === "completed"`. */
  output?: unknown;
  /** Present on `status === "failed"`. */
  error?: StepError;
  /** Principal that executed the step. */
  agent_principal?: string;
  /** ISO-8601 timestamps. */
  started_at?: string;
  completed_at?: string;
  duration_ms?: number;
}

export interface WorkflowExecution {
  execution_id: string;
  workflow_id: string;
  /** Pinned at execution start so a redefined workflow can't shift mid-run. */
  workflow_version: string;
  /** Shared across every envelope produced by this execution. */
  correlation_id: string;

  status: ExecutionStatus;
  /** Step IDs currently in flight. Multiple during fan-out. */
  current_steps: string[];
  /** Completed step record, keyed by step_id. */
  completed_steps: Record<string, StepResult>;
  /**
   * Fan-in coordination map. Key = fan-in step ID. Value = list of
   * upstream step IDs that have completed so far. Orchestrator
   * fires the fan-in step once value length matches the fan-in's
   * `parents.length` from `StepGraph`.
   */
  pending_fan_in: Record<string, string[]>;

  /** Original workflow input. */
  input: unknown;
  /** Final result, present on `status === "completed"`. */
  output?: unknown;
  /** Final error, present on `status === "failed"` or `"aborted"`. */
  error?: StepError;

  started_at: string;
  completed_at?: string;

  /** ISO-8601 timestamp of the last store write. */
  last_checkpoint_at: string;
  /** Increments each time an orchestrator restart resumes this execution. */
  retry_count: number;
}
