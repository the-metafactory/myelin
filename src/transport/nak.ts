import type { MyelinEnvelope } from "../types";
import type { EnvelopePublisher } from "./types";
import {
  createLifecycleEvent,
  type LifecycleEventPayloadInput,
} from "../lifecycle/event";
import type {
  NakReason,
} from "../lifecycle/types";

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
//    publishes `dispatch.task.rejected` on `local.{principal}.dispatch.task.rejected`
//    when given a publisher + principal + envelope + agentPrincipal. THIS is the
//    durable channel F-4 / threshold-review subscribe to. Sync callers
//    (e.g. NATSTransport's handler-error path) miss this — they signal
//    locally only and rely on operator log inspection.
//
// Backoff for `not-now` is derived deterministically from
// `msg.info.deliveryCount` (provided by JetStream on every redelivery)
// instead of a process-local map. No state to leak.

export type { NakReason } from "../lifecycle/types";

export interface NakOptions {
  reason: NakReason;
  description?: string;
}

export interface NakContext {
  msg: NakableMessage;
  envelope?: MyelinEnvelope;
  agentPrincipal?: string;
  publisher?: EnvelopePublisher;
  principal?: string;
  // Optional enrichment for cross-feature consumers (F-4 dead-letter
  // handler). When present they ride on `dispatch.task.rejected`.
  originatingConsumer?: string;
  originalSubject?: string;
}

export type TaskRejectedEvent = LifecycleEventPayloadInput<"rejected">;

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

const LIFECYCLE_PUBLISH_TIMEOUT_MS = 2000;

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
  if (ctx.publisher && ctx.principal && ctx.envelope && ctx.agentPrincipal) {
    const event: TaskRejectedEvent = {
      task_id: ctx.envelope.id,
      correlation_id: ctx.envelope.correlation_id ?? ctx.envelope.id,
      distribution_mode: ctx.envelope.distribution_mode ?? "offer",
      identity: ctx.agentPrincipal,
      reason: options.reason,
      ...(options.description ? { description: options.description } : {}),
      delivery_count: ctx.msg.info?.deliveryCount ?? 1,
      ...(ctx.originatingConsumer ? { originating_consumer: ctx.originatingConsumer } : {}),
      ...(ctx.originalSubject ? { original_subject: ctx.originalSubject } : {}),
      original_envelope: ctx.envelope,
    };
    const lifecycleEvent = createLifecycleEvent({
      principal: ctx.principal,
      source: `${ctx.principal}.dispatch.${ctx.agentPrincipal.replace(/[:.]/g, "-")}`,
      sovereignty: { classification: ctx.envelope.sovereignty.classification },
      state: "rejected",
      payload: event,
    });
    const publishPromise = ctx.publisher.publish(lifecycleEvent.input, lifecycleEvent.subject);
    // Best-effort lifecycle emission — never block the nak path on it.
    // Race against a 2s timeout so a stalled publisher (never resolves,
    // never rejects) can't hang the agent. Honors the documented guarantee
    // that nak fires even when emission "fails" — including silent stalls.
    try {
      await Promise.race([
        publishPromise,
        new Promise<never>((_, reject) =>
          setTimeout(() => { reject(new Error("lifecycle publish timeout")); }, LIFECYCLE_PUBLISH_TIMEOUT_MS),
        ),
      ]);
    } catch (err) {
      // Visibility — operators tracking lifecycle-stream coverage need to
      // know when emission fails (misconfigured principal, dead NATS connection,
      // stall). Cheap signal; no behavior change. console.error (not
      // process.stderr) keeps this module on the edge-portable WS
      // transport's import graph — Workers have no `process` global.
      console.error(
        `myelin-nak: lifecycle publish failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  nakWithReasonSync(ctx.msg, options);
}
