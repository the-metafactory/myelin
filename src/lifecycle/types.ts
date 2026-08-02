import type {
  DistributionMode,
  MyelinEnvelope,
} from "../types";
import type { NakReason } from "../wire/generated/r/transport";

/**
 * The NAK reason set, RE-EXPORTED from the shared `./wire` library rather than
 * restated here (myelin#235 seam sweep; `./wire` itself was built in #238).
 *
 * This was a hand-written union until now. The duplicate is what let the emitter
 * sit on the kebab spelling while `./wire`'s generated terminals already said
 * snake — the divergence myelin#233 had to close by hand across 33 files.
 * `./wire`'s own contract is explicit: grammar terminals are "consumed from the
 * abnf-gen output under `./generated/r` — never re-hand-written", and
 * `src/wire/transport.ts` already consumes them that way. This module now does
 * too.
 *
 * Provenance: `specs/grammar/transport.abnf` → `tools/abnf-gen` →
 * `src/wire/generated/r/transport.ts`. `abnf-gen --check` proves the generated
 * terminal matches the ABNF — not that the ABNF matches RFC-0007 §3.1, which no
 * gate compares.
 *
 * Imported above (this module's payload types reference it) and re-exported so
 * existing `import type { NakReason } from ".../lifecycle/types"` call sites are
 * untouched. Guards for the member set and for re-duplication, and which gate
 * catches which, live in `./nak-reason-surface.test.ts`.
 */
export type { NakReason };

export type ProgressSeverity = "info" | "warn" | "escalate";

export type AbortReason = "operator-interrupt" | "timeout" | "dependency-failed";

export interface BaseLifecyclePayload {
  task_id: string;
  correlation_id: string;
  distribution_mode: DistributionMode;
  timestamp: string;
}

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

export type TimestampOptional<T> = T extends { timestamp: string }
  ? Omit<T, "timestamp"> & { timestamp?: string }
  : T;

export interface ReceivedPayload extends BaseLifecyclePayload {
  requirements: string[];
  /** R13 (vocabulary migration 2026-05, breaking cut) — renamed from `target_principal`. */
  target_assistant?: string;
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
    sub_correlation_id?: string;
  };

export type CompletedPayload = BaseLifecyclePayload &
  RequiredIdentityKey & {
    result?: Record<string, unknown>;
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

export type DeadLetterFailedPayload = TimestampOptional<FailedPayload> &
  {
    final_reason: NakReason;
    nak_chain: NakReason[];
    delivery_count: number;
    dead_letter_subject: string;
    originating_consumer: string;
    route_trigger: "exhaustion" | "compliance_block";
  };

export type AbortedPayload = BaseLifecyclePayload &
  OptionalIdentityKey & {
    reason: AbortReason;
    aborted_by?: string;
  };

export type RejectedPayload = BaseLifecyclePayload &
  RequiredIdentityKey & {
    reason: NakReason;
    description?: string;
    delivery_count: number;
    originating_consumer?: string;
    original_subject?: string;
    original_envelope?: MyelinEnvelope;
  };

export interface LifecyclePayloadByState {
  received: ReceivedPayload;
  assigned: AssignedPayload;
  started: StartedPayload;
  progress: ProgressPayload;
  completed: CompletedPayload;
  failed: FailedPayload | DeadLetterFailedPayload;
  aborted: AbortedPayload;
  rejected: RejectedPayload;
}

export type LifecyclePayload = LifecyclePayloadByState[keyof LifecyclePayloadByState];
