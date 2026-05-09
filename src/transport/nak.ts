import type { MyelinEnvelope } from "../types";
import type { EnvelopePublisher } from "./types";

// F-022: Structured nak reasons for capability-routed task work.
// See docs/design-agent-task-routing.md §Nak with structured reasons.
//
// Two channels carry the reason code:
//
// 1. **Local headers (in-process hint).** `applyHeaders` writes
//    `Myelin-Nak-Reason` and optional `Myelin-Nak-Description` onto the
//    delivered message. NATS does NOT propagate consumer-appended headers
//    across nak-redelivery, so this signal is only visible to in-process
//    observers (e.g. an agent's own logging/metrics middleware) before the
//    nak fires. F-4 and threshold-review CANNOT rely on these headers.
//
// 2. **Durable lifecycle event (cross-process truth).** `nakWithReason`
//    publishes `dispatch.task.rejected` on `local.{org}.dispatch.task.rejected`
//    when given a publisher + org + envelope + agentPrincipal. THIS is the
//    durable channel F-4 / threshold-review subscribe to. Sync callers
//    (e.g. NATSTransport's handler-error path) miss this — they signal
//    locally only and rely on operator log inspection.
//
// Backoff for `not-now` is derived deterministically from
// `msg.info.deliveryCount` (provided by JetStream on every redelivery)
// instead of a process-local map. No state to leak.

export type NakReason = "cant-do" | "wont-do" | "not-now" | "compliance-block";

export interface NakOptions {
  reason: NakReason;
  description?: string;
}

export interface NakContext {
  msg: NakableMessage;
  envelope?: MyelinEnvelope;
  agentPrincipal?: string;
  publisher?: EnvelopePublisher;
  org?: string;
}

export interface TaskRejectedEvent {
  task_id: string;
  correlation_id: string;
  agent_principal: string;
  reason: NakReason;
  description?: string;
  timestamp: string;
  delivery_count: number;
}

// Minimal subset of @nats-io/jetstream JsMsg used by nak helpers.
// Avoids tight coupling to the NATS SDK and keeps the helpers testable.
export interface NakableMessage {
  nak(delayNs?: number): void;
  headers?: { append?(key: string, value: string): void } | null;
  info?: { streamSequence: number | bigint; deliveryCount?: number };
}

export const NAK_REASON_HEADER = "Myelin-Nak-Reason";
export const NAK_DESCRIPTION_HEADER = "Myelin-Nak-Description";

export const NAK_BACKOFF = {
  initialDelayMs: 1000,
  multiplier: 2,
  maxDelayMs: 60_000,
} as const;

const NS_PER_MS = 1_000_000n;

/**
 * Compute the `not-now` redeliver delay for the given delivery count.
 *
 * Deterministic — `deliveryCount` is provided by JetStream on every
 * redelivery, so we don't need any process-local state (which would leak
 * memory across the lifetime of the process and not survive consumer
 * restarts anyway).
 *
 * Curve: 1s, 2s, 4s, 8s, 16s, 32s, 60s (cap, applied on every subsequent
 * delivery). delivery=1 is the first nak attempt; clamped to ≥1 so callers
 * passing 0 still see the initial delay rather than overflowing.
 */
function backoffMsForDelivery(delivery: number): number {
  const n = Math.max(1, delivery);
  // 2^(n-1) * initialDelayMs, capped at maxDelayMs
  const exp = Math.min(n - 1, 30); // 2^30 already overflows our cap
  const candidate = NAK_BACKOFF.initialDelayMs * Math.pow(NAK_BACKOFF.multiplier, exp);
  return Math.min(candidate, NAK_BACKOFF.maxDelayMs);
}

function applyHeaders(msg: NakableMessage, options: NakOptions): void {
  if (!msg.headers || typeof msg.headers.append !== "function") return;
  msg.headers.append(NAK_REASON_HEADER, options.reason);
  if (options.description) {
    msg.headers.append(NAK_DESCRIPTION_HEADER, options.description);
  }
}

/**
 * Synchronous nak with structured reason. Use from handler error paths
 * where we don't want async overhead and don't need lifecycle emission.
 *
 * - `cant-do | wont-do | compliance-block`: immediate redeliver
 *   (consumer-side routing decides retry vs dead-letter — F-4)
 * - `not-now`: exponential-backoff redeliver, capped at 60s
 */
export function nakWithReasonSync(msg: NakableMessage, options: NakOptions): void {
  applyHeaders(msg, options);
  if (options.reason === "not-now") {
    const delivery = msg.info?.deliveryCount ?? 1;
    const delayMs = backoffMsForDelivery(delivery);
    msg.nak(Number(BigInt(delayMs) * NS_PER_MS));
    return;
  }
  msg.nak();
}

/**
 * Async nak with lifecycle event emission. Used by capability-aware
 * agents that need to emit `dispatch.task.rejected` for threshold-review
 * and audit. Falls through to nakWithReasonSync if publisher absent.
 */
export async function nakWithReason(ctx: NakContext, options: NakOptions): Promise<void> {
  if (ctx.publisher && ctx.org && ctx.envelope && ctx.agentPrincipal) {
    const event: TaskRejectedEvent = {
      task_id: ctx.envelope.id,
      correlation_id: ctx.envelope.correlation_id ?? ctx.envelope.id,
      agent_principal: ctx.agentPrincipal,
      reason: options.reason,
      ...(options.description ? { description: options.description } : {}),
      timestamp: new Date().toISOString(),
      delivery_count: ctx.msg.info?.deliveryCount ?? 1,
    };
    const eventPayload: Record<string, unknown> = {
      task_id: event.task_id,
      correlation_id: event.correlation_id,
      agent_principal: event.agent_principal,
      reason: event.reason,
      timestamp: event.timestamp,
      delivery_count: event.delivery_count,
      ...(event.description ? { description: event.description } : {}),
    };
    try {
      await ctx.publisher.publish(
        {
          source: `${ctx.org}.dispatch.${ctx.agentPrincipal.replace(/[:.]/g, "-")}`,
          type: "dispatch.task.rejected",
          correlation_id: event.correlation_id,
          payload: eventPayload,
          sovereignty: { classification: ctx.envelope.sovereignty.classification },
        },
        `local.${ctx.org}.dispatch.task.rejected`,
      );
    } catch {
      // Best-effort lifecycle emission — never block the nak path on it.
    }
  }
  nakWithReasonSync(ctx.msg, options);
}

// (No state to reset — backoff is now stateless, derived per-delivery
// from JetStream's `deliveryCount`. Earlier versions exported
// `_resetNakBackoffState` for test isolation; that function is no longer
// needed and has been removed.)
