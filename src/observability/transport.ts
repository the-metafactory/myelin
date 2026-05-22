import type { Classification, MyelinEnvelope } from "../types";
import type {
  TransportPublisher,
  TransportSubscriber,
  SubscribeOptions,
  Subscription,
  EnvelopePublisher,
  RequestOptions,
} from "../transport/types";
import type {
  ConsumerHealthProvider,
  ConsumerHealthSnapshot,
  SovereigntyViolationEvent,
  SovereigntyViolationListener,
  TransportMetricsEvent,
  TransportObservabilityListener,
  TransportPublishMetrics,
  TransportRequestMetrics,
  TransportSovereigntyMetrics,
  TransportSubscribeMetrics,
} from "./types";
import { SampleHistogram } from "./histogram";
import { transportMetricsSubject } from "../subjects";

export interface ObservableTransportOptions {
  publisher: TransportPublisher;
  subscriber: TransportSubscriber;
  /** Window between metric emissions in ms. Default 10_000 (10s). */
  windowMs?: number;
  /** Histogram sample cap. Default 4096. */
  histogramCap?: number;
  /**
   * Optional fixed time source. Pure tests inject this; production
   * uses the default Date.now() / setInterval pair. The combination
   * lets tests step time deterministically.
   */
  now?: () => number;
  /**
   * Auto-start the periodic emit. Default true. Set false in tests
   * to control timing manually via flush().
   */
  autoStart?: boolean;
  /**
   * Optional metrics auto-emit. When set, each flush() also publishes
   * the TransportMetricsEvent as a MyelinEnvelope onto the reserved
   * subject `local.{org}[.{stack}]._metrics.transport.{source}` so external
   * observers can subscribe to a single stream and react to every
   * transport in the deployment without per-transport wiring.
   *
   * Emission failures (publisher closed, NATS unreachable) are
   * swallowed and logged to stderr — metrics must never crash the
   * window timer.
   */
  metricsAutoEmit?: {
    /** EnvelopePublisher used to publish the envelope. */
    publisher: EnvelopePublisher;
    /** Organization slug; populates the subject namespace. */
    org: string;
    /** Optional stack slug; when set, emits stack-aware metrics subjects. */
    stack?: string;
    /**
     * Source identity to put on the emitted envelope (e.g. the
     * orchestrator id). The subject's trailing token is derived from
     * this — non-DNS-safe characters are replaced with `-` so the
     * subject stays valid.
     */
    source: string;
  };
  /**
   * Optional consumer-health sampler. When set, ObservableTransport
   * caches the latest `ConsumerHealthSnapshot[]` and includes it in
   * every `snapshot()` / `flush()` under `subscribe.consumers`.
   *
   * The provider is invoked on every `flush()` and its result becomes
   * the cache for the NEXT snapshot (fire-and-forget — flush() never
   * awaits I/O). Operators wanting a synchronous read of fresh data
   * can `await observable.refreshConsumerHealth()` before `flush()`.
   *
   * Provider rejections are logged to stderr; the cache holds whatever
   * was there before the failed call.
   */
  consumerHealthProvider?: ConsumerHealthProvider;
}

const SOVEREIGNTY_PREFIX = "compliance-block:";

function extractReasonCode(message: string): string | undefined {
  const idx = message.indexOf(SOVEREIGNTY_PREFIX);
  if (idx === -1) return undefined;
  const tail = message.slice(idx);
  const match = /^compliance-block:[a-z][a-z-]*[a-z]/i.exec(tail);
  return match?.[0];
}

/**
 * F-17: ObservableTransport wraps a TransportPublisher + Subscriber
 * pair, tracking publish/subscribe counts, latency, errors, and
 * sovereignty violations. Emits typed TransportMetricsEvent on a
 * periodic window. Consumers register listeners via on('metrics')
 * style API — no metrics-library dep.
 *
 * Sovereignty violations are detected by inspecting thrown errors for
 * the `compliance-block:*` prefix (matches F-5 SovereigntyValidationResult
 * codes; the wrapper does not depend on F-5 directly).
 */
export class ObservableTransport implements TransportPublisher, TransportSubscriber {
  private readonly pub: TransportPublisher;
  private readonly sub: TransportSubscriber;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly metricsListeners = new Set<TransportObservabilityListener>();
  private readonly violationListeners = new Set<SovereigntyViolationListener>();
  private readonly autoEmit: ObservableTransportOptions["metricsAutoEmit"];
  private readonly consumerHealthProvider?: ConsumerHealthProvider;
  private consumerHealthCache: ConsumerHealthSnapshot[] = [];

  private publishTotal = 0;
  private publishErrors = 0;
  private publishByClassification: Partial<Record<Classification, number>> = {};
  private latency: SampleHistogram;

  private requestTotal = 0;
  private requestErrors = 0;
  private requestLatency: SampleHistogram;

  private activeSubscriptions = 0;
  private messagesReceived = 0;
  private handlerErrors = 0;

  private sovereigntyBlocked = 0;
  private sovereigntyByReason: Record<string, number> = {};

  private windowStart: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(options: ObservableTransportOptions) {
    this.pub = options.publisher;
    this.sub = options.subscriber;
    this.windowMs = options.windowMs ?? 10_000;
    this.now = options.now ?? (() => Date.now());
    this.latency = new SampleHistogram(options.histogramCap ?? 4096);
    this.requestLatency = new SampleHistogram(options.histogramCap ?? 4096);
    this.windowStart = this.now();
    this.autoEmit = options.metricsAutoEmit;
    this.consumerHealthProvider = options.consumerHealthProvider;
    if (options.autoStart ?? true) this.start();
  }

  /**
   * Force a refresh of the consumer-health cache. Returns the new
   * snapshot list (also written into the cache). Synchronous-style
   * callers can `await` this before `flush()` for fresh data.
   * Silently no-op when no provider is configured.
   */
  async refreshConsumerHealth(): Promise<ConsumerHealthSnapshot[]> {
    if (!this.consumerHealthProvider) return [];
    try {
      const snaps = await this.consumerHealthProvider();
      this.consumerHealthCache = snaps;
      return snaps;
    } catch (err) {
      process.stderr.write(
        `myelin-observability: consumer health provider failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      return this.consumerHealthCache;
    }
  }

  /**
   * Derive the canonical metrics subject for an `org` + `source`.
   *
   * `org` must satisfy `PRINCIPAL_RE` (single NATS subject segment — no dots,
   * no wildcards). A typo there would otherwise silently produce a
   * subject with the wrong token count, breaking
   * `local.{org}[.{stack}]._metrics.transport.>` wildcard subscriptions.
   *
   * `source` is sanitized: `[^a-zA-Z0-9-]+` is collapsed to `-` so DID
   * separators (`:`, `#`, `.`) and other punctuation stay inside a
   * single subject segment. Empty source rejected; double `--` from
   * the collapse is normalized to single `-`.
   */
  static metricsSubject(org: string, source: string, stack?: string): string {
    try {
      return transportMetricsSubject(org, source, stack);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("Invalid org segment")) {
        throw new Error(`metricsSubject: invalid org '${org}'`, { cause: err });
      }
      if (message.includes("Invalid stack segment")) {
        throw new Error(`metricsSubject: invalid stack '${stack ?? ""}'`, { cause: err });
      }
      if (message.includes("value is required")) {
        throw new Error("metricsSubject: source is required", { cause: err });
      }
      if (message.includes("no alphanumeric")) {
        throw new Error(`metricsSubject: source '${source}' has no alphanumeric characters`, { cause: err });
      }
      throw err;
    }
  }

  on(event: "metrics", listener: TransportObservabilityListener): () => void;
  on(event: "violation", listener: SovereigntyViolationListener): () => void;
  on(
    event: "metrics" | "violation",
    listener: TransportObservabilityListener | SovereigntyViolationListener,
  ): () => void {
    if (event === "metrics") {
      this.metricsListeners.add(listener as TransportObservabilityListener);
      return () => this.metricsListeners.delete(listener as TransportObservabilityListener);
    }
    this.violationListeners.add(listener as SovereigntyViolationListener);
    return () => this.violationListeners.delete(listener as SovereigntyViolationListener);
  }

  async publish(subject: string, envelope: MyelinEnvelope): Promise<void> {
    const t0 = this.now();
    try {
      await this.pub.publish(subject, envelope);
      this.publishTotal++;
      const cls = envelope.sovereignty.classification;
      this.publishByClassification[cls] = (this.publishByClassification[cls] ?? 0) + 1;
      this.latency.observe(this.now() - t0);
    } catch (err) {
      this.publishErrors++;
      const message = err instanceof Error ? err.message : String(err);
      const code = extractReasonCode(message);
      if (code !== undefined) {
        this.sovereigntyBlocked++;
        this.sovereigntyByReason[code] = (this.sovereigntyByReason[code] ?? 0) + 1;
        this.emitViolation({
          timestamp: new Date(this.now()).toISOString(),
          subject,
          envelope_id: envelope.id,
          reason_code: code,
          reason: message,
        });
      }
      throw err;
    }
  }

  async request(
    subject: string,
    envelope: MyelinEnvelope,
    options?: RequestOptions,
  ): Promise<MyelinEnvelope> {
    const t0 = this.now();
    try {
      const response = await this.pub.request(subject, envelope, options);
      this.requestTotal++;
      this.requestLatency.observe(this.now() - t0);
      return response;
    } catch (err) {
      this.requestErrors++;
      this.requestLatency.observe(this.now() - t0);
      const message = err instanceof Error ? err.message : String(err);
      const code = extractReasonCode(message);
      if (code !== undefined) {
        this.sovereigntyBlocked++;
        this.sovereigntyByReason[code] = (this.sovereigntyByReason[code] ?? 0) + 1;
        this.emitViolation({
          timestamp: new Date(this.now()).toISOString(),
          subject,
          envelope_id: envelope.id,
          reason_code: code,
          reason: message,
        });
      }
      throw err;
    }
  }

  async subscribe(
    subject: string,
    handler: (envelope: MyelinEnvelope) => Promise<void>,
    options?: SubscribeOptions,
  ): Promise<Subscription> {
    return this.wrapSubscription(this.sub.subscribe(subject, this.wrapHandler(handler), options));
  }

  async subscribeBestEffort(
    subject: string,
    handler: (envelope: MyelinEnvelope) => Promise<void>,
  ): Promise<Subscription> {
    return this.wrapSubscription(this.sub.subscribeBestEffort(subject, this.wrapHandler(handler)));
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.pub.close();
    await this.sub.close();
  }

  /** Emit metrics event for the current window and reset counters. */
  flush(): TransportMetricsEvent {
    const event = this.snapshot();
    this.resetWindow();
    for (const listener of this.metricsListeners) {
      try {
        listener(event);
      } catch {
        // Listener errors must not crash the setInterval-driven emit
        // path. Matches the violation-listener guard in emitViolation.
        // Listener authors get one shot per event; we don't retry.
      }
    }
    if (this.autoEmit) {
      this.publishMetricsEnvelope(event);
    }
    // Kick off the next consumer-health refresh after the current
    // snapshot has been observed by listeners. The new data lands in
    // the cache for the NEXT flush. Fire-and-forget so the window
    // timer never blocks on JetStream I/O.
    if (this.consumerHealthProvider) {
      void this.refreshConsumerHealth();
    }
    return event;
  }

  private publishMetricsEnvelope(event: TransportMetricsEvent): void {
    const cfg = this.autoEmit;
    if (!cfg) return;
    const subject = ObservableTransport.metricsSubject(cfg.org, cfg.source, cfg.stack);
    // Fire-and-forget: metrics emission must never block flush() or
    // crash the window timer. We swallow rejections and surface them
    // to stderr only — operators can correlate via wall-clock if the
    // metrics stream goes dark.
    cfg.publisher
      .publish(
        {
          source: cfg.source,
          type: "transport.metrics.snapshot",
          payload: event as unknown as Record<string, unknown>,
          sovereignty: { classification: "local" },
        },
        subject,
      )
      .catch((err: unknown) => {
        process.stderr.write(
          `myelin-observability: metrics auto-emit failed: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      });
  }

  /** Snapshot without resetting (testing convenience). */
  snapshot(): TransportMetricsEvent {
    const publish: TransportPublishMetrics = {
      total: this.publishTotal,
      errors: this.publishErrors,
      byClassification: { ...this.publishByClassification },
      latencyMs: this.latency.snapshot(),
    };
    const request: TransportRequestMetrics = {
      total: this.requestTotal,
      errors: this.requestErrors,
      latencyMs: this.requestLatency.snapshot(),
    };
    const subscribe: TransportSubscribeMetrics = {
      activeSubscriptions: this.activeSubscriptions,
      messagesReceived: this.messagesReceived,
      handlerErrors: this.handlerErrors,
      // Snapshot of the cached consumer-health list. Each flush() kicks
      // off a fresh async refresh — this is whatever the most-recent
      // completed refresh produced.
      consumers: this.consumerHealthCache.map((c) => ({ ...c })),
    };
    const sovereignty: TransportSovereigntyMetrics = {
      blockedTotal: this.sovereigntyBlocked,
      byReasonCode: { ...this.sovereigntyByReason },
    };
    return {
      timestamp: new Date(this.now()).toISOString(),
      windowMs: this.now() - this.windowStart,
      publish,
      request,
      subscribe,
      sovereignty,
    };
  }

  private start(): void {
    if (this.closed || this.timer) return;
    this.timer = setInterval(() => this.flush(), this.windowMs);
    if (typeof this.timer === "object" && "unref" in this.timer) {
      // Don't keep the event loop alive for the metrics interval alone.
      (this.timer as { unref?: () => void }).unref?.();
    }
  }

  private resetWindow(): void {
    this.publishTotal = 0;
    this.publishErrors = 0;
    this.publishByClassification = {};
    this.latency.reset();
    this.requestTotal = 0;
    this.requestErrors = 0;
    this.requestLatency.reset();
    this.messagesReceived = 0;
    this.handlerErrors = 0;
    this.sovereigntyBlocked = 0;
    this.sovereigntyByReason = {};
    this.windowStart = this.now();
  }

  private wrapHandler(
    handler: (envelope: MyelinEnvelope) => Promise<void>,
  ): (envelope: MyelinEnvelope) => Promise<void> {
    return async (envelope) => {
      this.messagesReceived++;
      try {
        await handler(envelope);
      } catch (err) {
        this.handlerErrors++;
        throw err;
      }
    };
  }

  private async wrapSubscription(promise: Promise<Subscription>): Promise<Subscription> {
    const sub = await promise;
    this.activeSubscriptions++;
    let unsubscribed = false;
    return {
      unsubscribe: async () => {
        if (unsubscribed) return;
        unsubscribed = true;
        this.activeSubscriptions = Math.max(0, this.activeSubscriptions - 1);
        await sub.unsubscribe();
      },
    };
  }

  private emitViolation(event: SovereigntyViolationEvent): void {
    for (const listener of this.violationListeners) {
      try {
        listener(event);
      } catch {
        // Listener errors must not affect the publish path.
      }
    }
  }
}

export function createObservableTransport(options: ObservableTransportOptions): ObservableTransport {
  return new ObservableTransport(options);
}
