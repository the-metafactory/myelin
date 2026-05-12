import type { MyelinEnvelope } from "../types";

/**
 * Default request timeout when the caller does not pass `options.timeoutMs`.
 * Matches NATS' historical core-request default. Concrete transports
 * (`InMemoryTransport`, `NATSTransport`) both fall back to this value when
 * invoking `executeRequestReply`. Override per-call via `RequestOptions`.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 5000;

/**
 * Minimal subscribe/publish surface that `executeRequestReply` needs from a
 * transport. Each concrete transport adapts its own subscribe/publish
 * machinery into this shape (see `InMemoryTransport.request` and
 * `NATSTransport.request`).
 *
 * - `subscribe` MUST attach the inbox handler and return a synchronous
 *   `unsubscribe` so the request can tear down the inbox immediately on
 *   timeout, settle, or error.
 * - `publish` is fire-and-forget — see the type-level note on its signature
 *   below. Implementations may complete synchronously (NATS core publish)
 *   or return a `Promise<void>` (in-memory). `executeRequestReply` handles
 *   both synchronous throws and async rejections by settling the outer
 *   request promise.
 */
export interface RequestReplyPrimitives {
  subscribe(
    inboxSubject: string,
    onMessage: (envelope: MyelinEnvelope) => void,
  ): Promise<{ unsubscribe(): void }>;
  /**
   * Publish the prepared request envelope directly to `subject`, bypassing
   * any higher-level inbox/route machinery. The reply path is established
   * via the inbox subscription above — request/reply intentionally
   * publish-without-routing-through-the-inbox so the reply round-trip can
   * be measured against the same subject the responder is subscribed to.
   *
   * Return type is `void | Promise<void>`: synchronous transports (NATS
   * core publish) return `void`; transports whose publish is async (e.g.
   * `InMemoryTransport`) return the publish promise so
   * `executeRequestReply` can settle the outer request on a publish-time
   * rejection (e.g. "Transport closed" between subscribe and publish)
   * instead of dropping it as an unhandled rejection.
   */
  publish(subject: string, requestEnvelope: MyelinEnvelope): void | Promise<void>;
}

/**
 * Run a single request/reply round-trip against an arbitrary transport.
 *
 * Contract:
 * - Generates `correlation_id` if the caller didn't supply one, and
 *   stamps `extensions.reply_to` with a fresh `_INBOX.{uuid}` (or the
 *   caller-supplied one — validated to be a concrete `_INBOX.*` subject
 *   without wildcards).
 * - Subscribes to the inbox FIRST, then publishes the request. The inbox
 *   handler filters incoming envelopes by `correlation_id`; mismatched
 *   responses are silently dropped, matching responses settle the promise.
 * - Resolves with the response envelope, or rejects with a timeout error
 *   tagged with the request `subject` after `timeoutMs` elapses.
 * - Cleans up the inbox subscription on settle, timeout, OR publish
 *   failure. Subscribe errors that arrive after a timeout settle the
 *   promise no-op (already-settled guard).
 *
 * Failure modes:
 * - Invalid caller-supplied `reply_to` → throws synchronously before any
 *   subscribe (subject-injection guard).
 * - `primitives.subscribe` rejection → rejects with the same error.
 * - `primitives.publish` throw → rejects with the same error (synchronous
 *   `try/catch` around the publish call).
 * - No response within `timeoutMs` → rejects with `Request timed out
 *   after {timeoutMs}ms on {subject}`.
 *
 * Observability: `ObservableTransport` wraps this at the `request()` layer
 * and records latency/error counters on each call. The counters live on
 * `TransportRequestMetrics` (see `src/observability/types.ts`), which
 * carries `{ total, errors, latencyMs: LatencyHistogram }` per emit window.
 */
export function executeRequestReply(
  subject: string,
  envelope: MyelinEnvelope,
  timeoutMs: number,
  primitives: RequestReplyPrimitives,
): Promise<MyelinEnvelope> {
  const correlationId = envelope.correlation_id ?? crypto.randomUUID();
  // `envelope.extensions` is already typed `Record<string, unknown> |
  // undefined` on `MyelinEnvelope`, but the cast pins that contract at
  // this trust boundary — callers may pass envelopes that crossed the wire
  // or were assembled by code that widened the type. Narrow + tolerate
  // non-string `reply_to` (we silently fall back to a fresh inbox).
  const extensions = envelope.extensions as Record<string, unknown> | undefined;
  const rawReplyTo = extensions?.reply_to;
  const callerReplyTo = typeof rawReplyTo === "string" ? rawReplyTo : undefined;
  if (callerReplyTo !== undefined) {
    if (
      !callerReplyTo.startsWith("_INBOX.") ||
      callerReplyTo.includes("*") ||
      callerReplyTo.includes(">") ||
      callerReplyTo === "_INBOX."
    ) {
      throw new Error(
        `Invalid reply_to subject '${callerReplyTo}' — must be a concrete _INBOX.{id} subject (no wildcards)`,
      );
    }
  }
  const inboxSubject = callerReplyTo ?? `_INBOX.${crypto.randomUUID()}`;

  // Spread `extensions` (already narrowed above) so the new envelope's
  // `extensions` is provably `Record<string, unknown>` and not `unknown`
  // — protects against widening if `MyelinEnvelope` ever loosens.
  const requestEnvelope: MyelinEnvelope = {
    ...envelope,
    correlation_id: correlationId,
    extensions: { ...(extensions ?? {}), reply_to: inboxSubject },
  };

  return new Promise<MyelinEnvelope>((resolve, reject) => {
    let settled = false;
    let unsub: (() => void) | null = null;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      unsub?.();
      reject(new Error(`Request timed out after ${timeoutMs}ms on ${subject}`));
    }, timeoutMs);

    const settle = (result: MyelinEnvelope | Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsub?.();
      if (result instanceof Error) reject(result);
      else resolve(result);
    };

    primitives
      .subscribe(inboxSubject, (response) => {
        if (settled) return;
        if (response.correlation_id !== correlationId) return;
        settle(response);
      })
      .then((sub) => {
        unsub = () => sub.unsubscribe();
        if (settled) {
          sub.unsubscribe();
          return;
        }
        // `primitives.publish` may be sync (NATS) or async (in-memory).
        // Surface both synchronous throws and async rejections through
        // `settle` so a publish-time failure (e.g. transport closed
        // between subscribe and publish) rejects the request promise
        // instead of leaking as an unhandled rejection.
        try {
          const result = primitives.publish(subject, requestEnvelope);
          if (result && typeof (result as Promise<void>).then === "function") {
            (result as Promise<void>).catch((err) => {
              settle(err instanceof Error ? err : new Error(String(err)));
            });
          }
        } catch (err) {
          settle(err instanceof Error ? err : new Error(String(err)));
        }
      })
      .catch((err) => {
        settle(err instanceof Error ? err : new Error(String(err)));
      });
  });
}
