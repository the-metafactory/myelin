import { isValidCorrelationId } from "../../correlation";
import { deriveDeadLetterSubject } from "../../transport/dead-letter";
import { nakWithReasonSync, type NakableMessage } from "../../transport/nak";
import { NotImplemented, type Adapter, type VectorResult } from "../types";

/**
 * Transport / refusal-disposition adapters (RFC-0007, specs/vectors/transport).
 *
 * Runner-first (design-rfc-alignment.md D3). Three kinds bind a REAL impl that
 * exists on main today; the rest are spec-ahead (the RFC-0007 flag-day-R flip)
 * and throw {@link NotImplemented} so the vector is accounted for in the
 * known-defects manifest rather than silently skipped.
 *
 * Impl-backed on main (all reached through today's PUBLIC exports — the runner
 * changes no core code):
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
 *  - `renderDeadLetterSubject` → `deriveDeadLetterSubject` (transport/dead-
 *    letter.ts → subjects.taskDeadLetterSubject). Legacy-5seg, stack-aware-6seg,
 *    federated mirror, and idempotent all derive correctly and pass; the bad-
 *    shape reject throws a free-text message (not the `unexpected-subject-shape`
 *    token) — that reason-token gap is the RFC-0007 result-token vocabulary,
 *    manifested → myelin#233.
 *
 * Spec-ahead-of-code (RFC-0007 flag-day-R, myelin#233 — "flip NakReason to
 * snake_case + transport conformance runner + S1 reply-binding"):
 *  - `resolveNakReason` — the normalize-then-coerce receive-alias mapper. §2
 *    debt: "resolveNakReason + Nats-Msg-Id publish MISSING in both repos." The
 *    only NakReason on main is the KEBAB union (lifecycle/types.ts); there is no
 *    function that normalizes kebab→snake and coerces the unknown/empty tail to
 *    `cant_do`. Lands with #233.
 *  - `resolveFailureReason` — the §3 layered carve (0007 token routes disposition;
 *    the 0010 refusal object's `retry_after_ms` overrides the backoff curve raw).
 *    No such combinator on main. Lands with #233.
 *  - `deadLetterRouteTrigger` — the route classifier (compliance fast-path /
 *    exhaustion-at-threshold / not_now-excluded). The logic exists as the PRIVATE
 *    `DeadLetterHandler.shouldRoute`, but it keys on the pre-R KEBAB tokens
 *    (`"compliance-block"`, `"not-now"`) and returns kebab — the snake inputs the
 *    vectors carry never match. The snake flip is #233.
 *  - `validateReplyTo` — the S1 reply-binding guard. Today's check is INLINE in
 *    `executeRequestReply` (request-reply.ts) and throws ONE free-text message;
 *    the standalone validator with the distinct `wildcard-in-reply-to` /
 *    `empty-inbox-id` / `not-an-inbox` tokens is #233 (RFC-0004 Updates:).
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

  renderDeadLetterSubject: (input): VectorResult => {
    try {
      return { ok: true, value: deriveDeadLetterSubject(input as string) };
    } catch (err) {
      // deriveDeadLetterSubject throws a free-text shape error; the vector wants
      // the `unexpected-subject-shape` token (RFC-0007 token vocabulary, #233).
      return { ok: false, reason: `threw:${(err as Error).message}` };
    }
  },

  resolveNakReason: () => {
    throw new NotImplemented("resolveNakReason", "myelin#233");
  },

  resolveFailureReason: () => {
    throw new NotImplemented("resolveFailureReason", "myelin#233");
  },

  deadLetterRouteTrigger: () => {
    throw new NotImplemented("deadLetterRouteTrigger", "myelin#233");
  },

  validateReplyTo: () => {
    throw new NotImplemented("validateReplyTo", "myelin#233");
  },
};
