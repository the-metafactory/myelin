import type { MyelinEnvelope, DistributionMode } from "../types";
import type { NakReason } from "../transport/nak";

// F-020: Dispatch lifecycle envelopes.
// See docs/design-agent-task-routing.md §Event-driven lifecycle.
//
// Every routed task emits a stream of envelopes describing its
// progression. Subject scheme:
//
//     local.{principal}.dispatch.task.{state}
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

/**
 * R2 transition payload-DID shape (vocabulary migration 2026-05, PR-7) —
 * the actor-DID key on the lifecycle payloads renamed `principal` →
 * `identity`. Exactly one of the canonical `identity` key or the
 * deprecated `principal` key may be present; a payload carrying BOTH is a
 * `dual_field_conflict` (see `./payload-identity`).
 *
 * The dispatch lifecycle payloads ride inside the SIGNABLE envelope
 * `payload` field, so this rename has the same wire-safety profile as
 * PR-6's envelope-level R2: this is the transition release, readers
 * accept either key, canonicalization uses the bytes as received, and
 * myelin emits only `identity`. Modelled exactly like PR-6's
 * `OriginatorDidKey` exclusive union so the type system refuses a payload
 * declaring both keys.
 */
type RequiredIdentityKey =
  | {
      /** DID of the assistant the dispatch event concerns. */
      identity: string;
      principal?: never;
    }
  | {
      /**
       * @deprecated Renamed to `identity` (vocabulary migration 2026-05,
       * R2). Pre-migration dispatch payloads carry this key; accepted on
       * read through the transition window. Removed in the breaking major.
       */
      principal: string;
      identity?: never;
    };

/**
 * R2 transition payload-DID shape for the lifecycle payloads whose actor
 * DID is OPTIONAL (`FailedPayload`, `AbortedPayload`). Either key may be
 * absent; at most one may be present. A payload carrying BOTH is a
 * `dual_field_conflict`.
 */
type OptionalIdentityKey =
  | { identity?: string; principal?: never }
  | {
      /**
       * @deprecated Renamed to `identity` (vocabulary migration 2026-05,
       * R2). Accepted on read through the transition window.
       */
      principal?: string;
      identity?: never;
    };

export interface ReceivedPayload extends BaseLifecyclePayload {
  requirements: string[];
  /** R13 (vocabulary migration 2026-05) — renamed from `target_principal`. */
  target_assistant?: string;
  /**
   * @deprecated Renamed to `target_assistant` (vocabulary migration
   * 2026-05, R13). Pre-migration dispatch payloads carry this key;
   * accepted on read through the transition window. Removed in the
   * breaking major.
   */
  target_principal?: string;
  deadline?: string;
}

export type AssignedPayload = BaseLifecyclePayload &
  RequiredIdentityKey & {
    claimed_at: string;
  };

export type StartedPayload = BaseLifecyclePayload & RequiredIdentityKey;

export type ProgressPayload = BaseLifecyclePayload &
  RequiredIdentityKey & {
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
  };

export type CompletedPayload = BaseLifecyclePayload &
  RequiredIdentityKey & {
    result?: Record<string, unknown>;
    // Optional economics — Decision Q4 lightweight instrumentation.
    // Agents without token counting omit; future cost-based routing
    // reads when present.
    input_tokens?: number;
    output_tokens?: number;
    duration_ms?: number;
  };

export type FailedPayload = BaseLifecyclePayload &
  OptionalIdentityKey & {
    nak_reason?: NakReason;
    error?: string;
    error_code?: string;
    retries_exhausted?: boolean;
  };

export type AbortedPayload = BaseLifecyclePayload &
  OptionalIdentityKey & {
    reason: AbortReason;
    aborted_by?: string;
  };

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
