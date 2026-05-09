import type { MyelinEnvelope } from "../types";
import type { EnvelopePublisher } from "./types";

// F-022: Structured nak reasons for capability-routed task work.
// See docs/design-agent-task-routing.md §Nak with structured reasons.
//
// Wire format: NATS message headers carry the reason code + optional
// description. Consumers (F-4 dead-letter handler, threshold-review) read
// the headers to decide routing without re-parsing the payload.

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

// Module-level backoff state keyed by stream sequence. Cleared once a
// sequence reaches max delay (further `not-now` re-naks stay at max).
const backoffState = new Map<string, number>();

function backoffKey(msg: NakableMessage): string {
  const seq = msg.info?.streamSequence;
  if (seq === undefined) return "anon";
  return typeof seq === "bigint" ? seq.toString() : String(seq);
}

function nextBackoffMs(key: string): number {
  const prev = backoffState.get(key);
  if (prev === undefined) {
    backoffState.set(key, NAK_BACKOFF.initialDelayMs);
    return NAK_BACKOFF.initialDelayMs;
  }
  const next = Math.min(prev * NAK_BACKOFF.multiplier, NAK_BACKOFF.maxDelayMs);
  // Stay at max; further re-naks for the same sequence keep returning the
  // ceiling (don't reset to initial — the producer/operator should investigate
  // the genuinely-stuck task rather than have the bus quietly restart backoff).
  backoffState.set(key, next);
  return next;
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
    const delayMs = nextBackoffMs(backoffKey(msg));
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
    try {
      await ctx.publisher.publish(
        {
          source: `${ctx.org}.dispatch.${ctx.agentPrincipal.replace(/[:.]/g, "-")}`,
          type: "dispatch.task.rejected",
          correlation_id: event.correlation_id,
          payload: event as unknown as Record<string, unknown>,
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

/** Test-only: reset module-level backoff state between tests. */
export function _resetNakBackoffState(): void {
  backoffState.clear();
}
