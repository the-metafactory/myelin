/**
 * ./wire — transport / reliability codec (RFC-0007).
 *
 * The receive-side transport primitives the flag-day-R cut consumes: the NAK
 * reason normalize-then-coerce mapper (§3.4), the layered failure carve that
 * routes disposition off the 0007 token while letting a 0010 refusal object's
 * `retry_after_ms` override the backoff curve (§3/§4.1), the dead-letter route
 * classifier (§5.1), the deterministic `not_now` backoff curve (§4.1), and the
 * request-reply `reply_to` injection guard (§7.1).
 *
 * The closed snake_case reason set + its kebab receive-aliases are CONSUMED from
 * `generated/r/transport` (#237/#280) — never re-hand-written. The dead-letter
 * SUBJECT derivation lives in the subject codec (`./subjects`,
 * `taskDeadLetterSubject`) because it is subject-plane grammar (RFC-0002).
 *
 * Windowed, not flag-day: this is the RECEIVE half. Kebab aliases are accepted
 * on read and normalized to snake here (§3.4 dual-accept window); the EMITTER
 * flip (myelin's kebab `NakReason` union → snake) rides the two-party cut and is
 * NOT performed by this module. At flag-day R the alias table below retires and
 * a kebab token coerces like any other unknown value.
 *
 * Fail loud: validators return a discriminated {@link TransportResult} carrying a
 * stable RFC-0007 reason token, never a bare boolean.
 */

import {
  NAK_REASON_VALUES,
  NAK_REASON_ALIAS_VALUES,
  type NakReason,
} from "./generated/r/transport";

export type TransportResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

const SNAKE = new Set<string>(NAK_REASON_VALUES);

/**
 * Kebab receive-alias → snake canonical. The two generated arrays are
 * index-aligned (`cant-do`→`cant_do`, …), so the map is built positionally over
 * the generated source of truth rather than re-typing the pairs.
 */
const ALIAS_TO_SNAKE = new Map<string, NakReason>();
NAK_REASON_ALIAS_VALUES.forEach((alias, i) => {
  const canonical = NAK_REASON_VALUES[i];
  if (canonical !== undefined) ALIAS_TO_SNAKE.set(alias, canonical);
});

/** The §3.4 coerce fallback — the least-surprising disposition for an unknown or
 * missing reason (it neither escalates like `compliance_block` nor exempts from
 * exhaustion like `not_now`). */
const COERCE_TO: NakReason = "cant_do";

/**
 * The §3.4 receive algorithm, as a pure token→token map. Normalize a known kebab
 * alias to its snake canonical FIRST, then coerce anything still outside the
 * closed set (including empty/missing) to `cant_do`. The order is load-bearing:
 * a blanket coerce applied before normalization would misroute every live
 * kebab-spelled token mid-window (grill D5).
 */
function coerceNakReason(input: unknown): NakReason {
  const raw = typeof input === "string" ? input : "";
  const normalized = ALIAS_TO_SNAKE.get(raw) ?? raw;
  return SNAKE.has(normalized) ? (normalized as NakReason) : COERCE_TO;
}

/**
 * `resolveNakReason` (RFC-0007 §3.4) — normalize-then-coerce a received NAK
 * reason value to a canonical snake_case token. Kebab aliases normalize; unknown
 * or missing values coerce to `cant_do`. Always succeeds (closed-for-emit,
 * tolerant-for-receive).
 */
export function resolveNakReason(input: unknown): TransportResult<{ reason: NakReason }> {
  return { ok: true, value: { reason: coerceNakReason(input) } };
}

/**
 * The deterministic `not_now` backoff curve (RFC-0007 §4.1):
 * `min(1000 * 2^(clamp(delivery_count,1,31)-1), 60000)` ms. A pure function of
 * `delivery_count` — no process-local state, so it survives consumer restarts.
 * `delivery_count` clamps to ≥1 (a caller passing 0 sees the 1s initial delay).
 */
export function notNowBackoffMs(deliveryCount: number): number {
  const n = Math.max(1, Math.min(deliveryCount, 31));
  return Math.min(1000 * 2 ** (n - 1), 60_000);
}

interface RefusalObjectShape {
  retry_after_ms?: unknown;
}

/**
 * `resolveFailureReason` — the layered carve (RFC-0007 §3, §4.1). Disposition
 * routes off the 0007 `final_reason` token (normalized via §3.4); the delay is
 * carved by the D6 precedence rule:
 *
 *  1. a co-carried 0010 refusal object's `retry_after_ms` overrides the curve
 *     RAW — no clamp (recorded as-is; the override is unbounded, §4.1 finding);
 *  2. else a `not_now` uses the §4.1 `delivery_count` curve;
 *  3. else (`cant_do`/`wont_do`/`compliance_block`) redelivers immediately
 *     (`delay_ms: 0`).
 *
 * Object grammar and token↔object consistency are RFC-0010's to adjudicate; this
 * codec reads only `retry_after_ms` off the object and never validates it.
 */
export function resolveFailureReason(
  input: unknown,
): TransportResult<{ reason: NakReason; delay_ms: number }> {
  const o = (input ?? {}) as {
    final_reason?: unknown;
    delivery_count?: unknown;
    reason?: RefusalObjectShape;
  };
  const reason = coerceNakReason(o.final_reason);
  const override = o.reason?.retry_after_ms;

  let delay_ms: number;
  if (typeof override === "number") {
    delay_ms = override; // §4.1 raw override, no clamp
  } else if (reason === "not_now") {
    const dc = typeof o.delivery_count === "number" ? o.delivery_count : 1;
    delay_ms = notNowBackoffMs(dc);
  } else {
    delay_ms = 0; // immediate redeliver
  }
  return { ok: true, value: { reason, delay_ms } };
}

/**
 * The reference exhaustion threshold (myelin `max_deliver`, `specs/namespace.md`
 * §4.2 equality invariant). Per-consumer configurable; cortex provisions 5. The
 * conformance vectors carry the reference value.
 */
export const REFERENCE_EXHAUSTION_THRESHOLD = 3;

export type RouteTrigger = "compliance_block" | "exhaustion" | null;

/**
 * `deadLetterRouteTrigger` — the dead-letter route classifier (RFC-0007 §5.1).
 * `compliance_block` fast-paths to dead-letter at any chain length; `not_now` is
 * never appended to the chain and never routes (§4.2); `cant_do`/`wont_do` route
 * via `exhaustion` once the chain length reaches the (per-consumer configured)
 * threshold. The reason is normalized via §3.4 before classification.
 */
export function deadLetterRouteTrigger(
  input: unknown,
  exhaustionThreshold: number = REFERENCE_EXHAUSTION_THRESHOLD,
): TransportResult<RouteTrigger> {
  const o = (input ?? {}) as { reason?: unknown; chainLength?: unknown };
  const reason = coerceNakReason(o.reason);
  const chainLength = typeof o.chainLength === "number" ? o.chainLength : 0;

  if (reason === "compliance_block") return { ok: true, value: "compliance_block" };
  if (reason === "not_now") return { ok: true, value: null };
  if (chainLength >= exhaustionThreshold) return { ok: true, value: "exhaustion" };
  return { ok: true, value: null };
}

/** The reserved reply-mailbox prefix (RFC-0007 §7.4; NATS's own byte-for-byte
 * string, uppercase-exempt — RFC-0002 §9 D22). */
const INBOX_PREFIX = "_INBOX.";

/**
 * `validateReplyTo` — the S1 request-reply injection guard (RFC-0007 §7.1). A
 * caller-supplied `reply_to` MUST start with `_INBOX.`, MUST carry a non-empty
 * inbox id, and MUST NOT contain a `*` or `>` wildcard — else a reply published
 * there would fan out beyond the point-to-point mailbox. Each failure yields a
 * distinct RFC-0007 result token.
 */
export function validateReplyTo(input: unknown): TransportResult<{ inbox: string }> {
  const subject = typeof input === "string" ? input : "";
  if (!subject.startsWith(INBOX_PREFIX)) return { ok: false, reason: "not-an-inbox" };
  const inboxId = subject.slice(INBOX_PREFIX.length);
  if (inboxId.length === 0) return { ok: false, reason: "empty-inbox-id" };
  if (inboxId.includes("*") || inboxId.includes(">")) {
    return { ok: false, reason: "wildcard-in-reply-to" };
  }
  return { ok: true, value: { inbox: subject } };
}
