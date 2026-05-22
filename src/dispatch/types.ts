import type { MyelinEnvelope, DistributionMode } from "../types";
import type {
  DispatchLifecycleEventType,
  LifecycleState,
} from "../subject-vocabulary";
import {
  DISPATCH_TASK_STATE_TO_TYPE,
} from "../subject-vocabulary";
import type {
  LifecyclePayload,
} from "../lifecycle/types";

export type { LifecycleState } from "../subject-vocabulary";

// Re-export so consumers can import everything dispatch-related from
// one module without reaching into transport/types or lifecycle internals.
export type { DistributionMode };
export type {
  NakReason,
  ProgressSeverity,
  AbortReason,
  BaseLifecyclePayload,
  ReceivedPayload,
  AssignedPayload,
  StartedPayload,
  ProgressPayload,
  CompletedPayload,
  FailedPayload,
  DeadLetterFailedPayload,
  AbortedPayload,
  RejectedPayload,
  LifecyclePayloadByState,
  LifecyclePayload,
} from "../lifecycle/types";

// F-020: Dispatch lifecycle envelopes.
// See docs/design-agent-task-routing.md §Event-driven lifecycle.
//
// Every routed task emits a stream of envelopes describing its
// progression. Subject scheme:
//
//     local.{principal}.dispatch.task.{state}
//
// Where {state} ∈ {received, assigned, started, progress, completed,
// failed, aborted, rejected}. JetStream-backed on the EVENTS stream so observers
// can replay deterministically. All events for a task share the same
// `correlation_id`.
export interface DispatchLifecycleEnvelope extends MyelinEnvelope {
  type: DispatchLifecycleEventType;
  correlation_id: string; // required, not optional, on lifecycle envelopes
  payload: LifecyclePayload & Record<string, unknown>;
}

// Map state → type field for envelope construction.
export const STATE_TO_TYPE: Record<LifecycleState, DispatchLifecycleEnvelope["type"]> =
  DISPATCH_TASK_STATE_TO_TYPE;
