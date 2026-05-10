import type { MyelinEnvelope } from "../../types";

/**
 * F-2: middleware fires on fully-formed envelopes — after EnvelopeTransport
 * has constructed, validated, and signed them, before they hit the wire
 * (publish path) or before the user handler sees them (subscribe path).
 *
 * Implementation lives at the TransportPublisher/Subscriber layer because
 * that's where formed MyelinEnvelope objects flow through. EnvelopeTransport
 * users wrap their underlying transport in a MiddlewareTransport before
 * passing it to EnvelopeTransport — composition, not subclassing.
 */
export type MiddlewareDirection = "publish" | "subscribe";

export interface MiddlewareContext {
  subject: string;
  direction: MiddlewareDirection;
  /** Wall-clock instant the middleware ran. Stable per envelope-pass. */
  timestamp: Date;
}

/**
 * Return the envelope (possibly transformed) to pass it down the chain.
 * Return `null` to filter — chain stops, operation is a no-op.
 * Throw to abort — chain stops, operation rejects with the thrown error.
 *
 * Filtering on subscribe means "I don't want this envelope" — the
 * underlying transport's ack semantics are unaffected (the message
 * was already delivered to the wrapper; not calling the user handler
 * is equivalent to acking and dropping).
 */
export type PublishMiddleware = (
  envelope: MyelinEnvelope,
  context: MiddlewareContext,
) => Promise<MyelinEnvelope | null> | MyelinEnvelope | null;

export type SubscribeMiddleware = (
  envelope: MyelinEnvelope,
  context: MiddlewareContext,
) => Promise<MyelinEnvelope | null> | MyelinEnvelope | null;
