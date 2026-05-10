import type { MyelinEnvelope } from "../../types";
import type { MiddlewareContext, PublishMiddleware, SubscribeMiddleware } from "./types";

/**
 * Minimal logger surface so consumers can plug structured loggers (pino,
 * winston, console) without us depending on any of them.
 */
export interface MiddlewareLogger {
  info(payload: Record<string, unknown>): void;
}

/**
 * F-2 built-in: log envelope metadata (id, type, source, correlation_id,
 * classification, subject, direction, timestamp). Returns the envelope
 * unchanged — pass-through; never filters.
 */
export function loggingMiddleware(logger: MiddlewareLogger): PublishMiddleware & SubscribeMiddleware {
  return (envelope: MyelinEnvelope, context: MiddlewareContext) => {
    logger.info({
      direction: context.direction,
      subject: context.subject,
      id: envelope.id,
      type: envelope.type,
      source: envelope.source,
      correlation_id: envelope.correlation_id,
      classification: envelope.sovereignty.classification,
      timestamp: context.timestamp.toISOString(),
    });
    return envelope;
  };
}

/**
 * Minimal counter interface. Consumers wire to whatever metrics system
 * they have (prom-client, metrics, OpenTelemetry, etc.) by providing
 * implementations. No runtime dep.
 *
 * NOTE on latency: middleware in this pipeline runs sequentially with
 * no `next()` callback, so a single middleware cannot wrap downstream
 * execution to measure end-to-end publish duration. Latency
 * measurement therefore lives in F-17 ObservableTransport (which
 * wraps the underlying TransportPublisher.publish() call directly).
 * metricsMiddleware here is counters-only by design.
 */
export interface MiddlewareCounter {
  inc(labels?: Record<string, string>, value?: number): void;
}

export interface MiddlewareMetrics {
  publishedTotal: MiddlewareCounter;
  receivedTotal: MiddlewareCounter;
}

/**
 * F-2 built-in: metrics middleware — counters only. Increments
 * publishedTotal on publish and receivedTotal on subscribe with
 * `{type, classification}` labels. Pass-through; never filters.
 *
 * For publish latency histograms, use F-17 ObservableTransport which
 * wraps the publish call site directly. The two are complementary:
 * this middleware tracks per-envelope semantics; ObservableTransport
 * tracks transport timing.
 */
export function metricsMiddleware(metrics: MiddlewareMetrics): {
  publish: PublishMiddleware;
  subscribe: SubscribeMiddleware;
} {
  return {
    publish: (envelope) => {
      metrics.publishedTotal.inc({
        type: envelope.type,
        classification: envelope.sovereignty.classification,
      });
      return envelope;
    },
    subscribe: (envelope) => {
      metrics.receivedTotal.inc({
        type: envelope.type,
        classification: envelope.sovereignty.classification,
      });
      return envelope;
    },
  };
}
