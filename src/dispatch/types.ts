import type { MyelinEnvelope, DistributionMode } from "../types";
import type { NakReason } from "../transport/nak";

// F-020: Dispatch lifecycle envelopes.
// See docs/design-agent-task-routing.md §Event-driven lifecycle.
//
// Every routed task emits a stream of envelopes describing its
// progression. Subject scheme:
//
//     local.{org}.dispatch.task.{state}
//
// Where {state} ∈ {received, assigned, started, progress, completed,
// failed, aborted}. JetStream-backed on the EVENTS stream so observers
// can replay deterministically. All events for a task share the same
// `correlation_id`.

export type LifecycleState =
  | "received"
  | "assigned"
  | "started"
  | "progress"
  | "completed"
  | "failed"
  | "aborted";

export type ProgressSeverity = "info" | "warn" | "escalate";

export type AbortReason = "operator-interrupt" | "timeout" | "dependency-failed";

// Re-export so consumers can import everything dispatch-related from
// one module without reaching into transport/types.
export type { DistributionMode, NakReason };

export interface BaseLifecyclePayload {
  task_id: string;
  correlation_id: string;
  distribution_mode: DistributionMode;
  timestamp: string;
}

export interface ReceivedPayload extends BaseLifecyclePayload {
  requirements: string[];
  target_principal?: string;
  deadline?: string;
}

export interface AssignedPayload extends BaseLifecyclePayload {
  principal: string;
  claimed_at: string;
}

export interface StartedPayload extends BaseLifecyclePayload {
  principal: string;
}

export interface ProgressPayload extends BaseLifecyclePayload {
  principal: string;
  message: string;
  severity: ProgressSeverity;
  step?: number;
  total_steps?: number;
  // Formal parent-child link when Delegate fans out to sub-tasks. The
  // sub-task lives on its own correlation chain; sub_correlation_id
  // makes the join explicit so observers can reconstruct the graph.
  // Both correlation_id and sub_correlation_id ride inside the signed
  // envelope so chain-of-stamps (#31) covers them.
  sub_correlation_id?: string;
}

export interface CompletedPayload extends BaseLifecyclePayload {
  principal: string;
  result?: Record<string, unknown>;
  // Optional economics — Decision Q4 lightweight instrumentation.
  // Agents without token counting omit; future cost-based routing
  // reads when present.
  input_tokens?: number;
  output_tokens?: number;
  duration_ms?: number;
}

export interface FailedPayload extends BaseLifecyclePayload {
  principal?: string;
  nak_reason?: NakReason;
  error?: string;
  error_code?: string;
  retries_exhausted?: boolean;
}

export interface AbortedPayload extends BaseLifecyclePayload {
  reason: AbortReason;
  principal?: string;
  aborted_by?: string;
}

export type LifecyclePayload =
  | ReceivedPayload
  | AssignedPayload
  | StartedPayload
  | ProgressPayload
  | CompletedPayload
  | FailedPayload
  | AbortedPayload;

export interface DispatchLifecycleEnvelope extends MyelinEnvelope {
  type:
    | "dispatch.task.received"
    | "dispatch.task.assigned"
    | "dispatch.task.started"
    | "dispatch.task.progress"
    | "dispatch.task.completed"
    | "dispatch.task.failed"
    | "dispatch.task.aborted";
  correlation_id: string; // required, not optional, on lifecycle envelopes
  payload: LifecyclePayload & Record<string, unknown>;
}

// Map state → type field for envelope construction.
export const STATE_TO_TYPE: Record<LifecycleState, DispatchLifecycleEnvelope["type"]> = {
  received: "dispatch.task.received",
  assigned: "dispatch.task.assigned",
  started: "dispatch.task.started",
  progress: "dispatch.task.progress",
  completed: "dispatch.task.completed",
  failed: "dispatch.task.failed",
  aborted: "dispatch.task.aborted",
};
