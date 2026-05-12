import type { Classification } from "../types";

/**
 * F-17: typed metric events emitted by ObservableTransport. Consumers
 * subscribe to these and forward to whatever metrics system they have
 * (Prometheus, OpenTelemetry, custom). The wrapper does not depend on
 * any specific metrics library — it produces typed events.
 */

export interface LatencyHistogram {
  /** Number of samples recorded in the current window. */
  count: number;
  /** Minimum observed latency in milliseconds. NaN when count == 0. */
  min: number;
  /** Maximum observed latency in milliseconds. NaN when count == 0. */
  max: number;
  /** Mean latency in milliseconds. NaN when count == 0. */
  mean: number;
  /** 50th percentile (median) in milliseconds. NaN when count == 0. */
  p50: number;
  /** 95th percentile in milliseconds. NaN when count == 0. */
  p95: number;
  /** 99th percentile in milliseconds. NaN when count == 0. */
  p99: number;
}

export interface TransportPublishMetrics {
  total: number;
  errors: number;
  /** Per-classification counts (`local`, `federated`, `public`). */
  byClassification: Partial<Record<Classification, number>>;
  /** Latency histogram across all publish operations in the window. */
  latencyMs: LatencyHistogram;
}

export interface ConsumerHealthSnapshot {
  durableName: string;
  streamName: string;
  pending: number;
  ackPending: number;
  /**
   * In-flight redeliveries. JetStream's `num_redelivered` drops to 0
   * once a retried message acks. `deliveredConsumerSeq` is the
   * monotonic cumulative-delivery signal.
   */
  redelivered: number;
  waiting: number;
  deliveredConsumerSeq: number;
  ackFloorConsumerSeq: number;
}

export interface TransportRequestMetrics {
  total: number;
  errors: number;
  latencyMs: LatencyHistogram;
}

export interface TransportSubscribeMetrics {
  /** Number of subscriptions currently registered. */
  activeSubscriptions: number;
  /** Total messages delivered to user handlers in the window. */
  messagesReceived: number;
  /** Handler errors in the window (handler threw an exception). */
  handlerErrors: number;
  /**
   * Per-consumer health snapshots. Populated only when the
   * ObservableTransport was constructed with a `consumerHealthProvider`.
   * Cumulative absolute counts — sample successive windows and subtract
   * to compute redelivery throughput, lag growth, etc.
   */
  consumers: ConsumerHealthSnapshot[];
}

export type ConsumerHealthProvider = () => Promise<ConsumerHealthSnapshot[]>;

export interface TransportSovereigntyMetrics {
  /** Total publish attempts blocked in the window (caller threw `compliance-block:*`). */
  blockedTotal: number;
  /** Counts keyed by reason code (e.g., "compliance-block:classification-mismatch"). */
  byReasonCode: Record<string, number>;
}

export interface TransportMetricsEvent {
  /** ISO-8601 timestamp marking the END of this window. */
  timestamp: string;
  /** Window duration in milliseconds (inclusive of this emit). */
  windowMs: number;
  publish: TransportPublishMetrics;
  request?: TransportRequestMetrics;
  subscribe: TransportSubscribeMetrics;
  sovereignty: TransportSovereigntyMetrics;
}

export interface SovereigntyViolationEvent {
  /** ISO-8601 timestamp of the violation. */
  timestamp: string;
  /** Subject the publisher attempted. */
  subject: string;
  /** Envelope id, when known. */
  envelope_id?: string;
  /** Reason code emitted by the wrapped transport's error message. */
  reason_code?: string;
  /** Human-readable reason from the underlying error. */
  reason: string;
}

export type TransportObservabilityListener = (event: TransportMetricsEvent) => void;
export type SovereigntyViolationListener = (event: SovereigntyViolationEvent) => void;
