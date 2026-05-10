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
