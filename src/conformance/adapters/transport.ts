import { isValidCorrelationId } from "../../correlation";
import { nakWithReasonSync, type NakableMessage } from "../../transport/nak";
import { transport as wireTransport, subjects as wireSubjects } from "../../wire";
import { type Adapter, type VectorResult } from "../types";

/**
 * Transport / refusal-disposition adapters (RFC-0007, specs/vectors/transport).
 *
 * Runner-first (design-rfc-alignment.md D3). Every kind now binds a REAL impl:
 * the correlation-id validator and the `not_now` backoff curve exercise today's
 * engine primitives; the receive-side transport codec (RFC-0007 §3.4/§3/§5.1/
 * §7.1) is the `./wire` transport module authored at #233. The runner changes no
 * core code — it drives the ratified grammar through the shared library.
 *
 * Engine-backed (reached through today's PUBLIC exports):
 *  - `parseCorrelationId` → `isValidCorrelationId` (correlation.ts) — the
 *    shared UUID_RE (case-insensitive, version/variant-unconstrained). Every
 *    accept vector (canonical, uppercase-masking, nil) and the malformed reject
 *    pass; the reject's `malformed-uuid` token is the runner's, mapped from the
 *    boolean the validator returns.
 *  - `notNowBackoffMs` → the real §4.1 curve, driven through the public
 *    `nakWithReasonSync` (transport/nak.ts) by capturing the delay it hands to
 *    `msg.nak()`. `backoffMsForDelivery` itself is module-private; rather than
 *    re-implement the curve in the harness (which would test the harness, not
 *    myelin) we exercise it end-to-end. 1s/2s/4s doubling, ≥1 clamp, 60s cap.
 *
 * `./wire`-backed (RFC-0007 receive half, myelin#233 — "resolveNakReason +
 * WINDOWED receive-alias side"). These drive the ratified grammar through the
 * shared library; they change NO deployed-engine file — the emitter flip
 * (myelin's kebab `NakReason` union → snake) rides the two-party flag-day cut:
 *  - `resolveNakReason` → `wire.transport.resolveNakReason` — normalize-then-
 *    coerce over the generated snake canonicals + kebab receive-aliases (§3.4).
 *  - `resolveFailureReason` → `wire.transport.resolveFailureReason` — the §3
 *    layered carve (0007 token routes disposition; a 0010 refusal object's
 *    `retry_after_ms` overrides the §4.1 backoff curve raw).
 *  - `deadLetterRouteTrigger` → `wire.transport.deadLetterRouteTrigger` — the
 *    §5.1 route classifier (compliance fast-path / exhaustion-at-threshold /
 *    not_now-excluded) over the snake tokens.
 *  - `validateReplyTo` → `wire.transport.validateReplyTo` — the §7.1 S1 reply
 *    injection guard, distinct `wildcard-in-reply-to` / `empty-inbox-id` /
 *    `not-an-inbox` tokens.
 *  - `renderDeadLetterSubject` → `wire.subjects.taskDeadLetterSubject` — the
 *    §5.2 subject derivation (subject-plane grammar, RFC-0002). Bad shape yields
 *    the `unexpected-subject-shape` token instead of a free-text throw.
 */

/** Drive the real §4.1 backoff curve via the public sync-nak helper. */
function notNowDelayMs(delivery: number): number {
  let captured = 0;
  const msg: NakableMessage = {
    nak: (delayNs?: number): void => {
      captured = delayNs ?? 0;
    },
    info: { streamSequence: 0, deliveryCount: delivery },
  };
  nakWithReasonSync(msg, { reason: "not-now" });
  return captured / 1_000_000; // ns → ms
}

export const transportAdapters: Record<string, Adapter> = {
  parseCorrelationId: (input): VectorResult => {
    const id = input as string;
    return isValidCorrelationId(id)
      ? { ok: true, value: { uuid: id } }
      : { ok: false, reason: "malformed-uuid" };
  },

  notNowBackoffMs: (input): VectorResult => {
    return { ok: true, value: notNowDelayMs(input as number) };
  },

  renderDeadLetterSubject: (input): VectorResult =>
    wireSubjects.taskDeadLetterSubject(input as string),

  resolveNakReason: (input): VectorResult => wireTransport.resolveNakReason(input),

  resolveFailureReason: (input): VectorResult => wireTransport.resolveFailureReason(input),

  deadLetterRouteTrigger: (input): VectorResult => wireTransport.deadLetterRouteTrigger(input),

  validateReplyTo: (input): VectorResult => wireTransport.validateReplyTo(input),
};
