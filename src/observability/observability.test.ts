import { describe, it, expect } from "bun:test";
import { ObservableTransport, createObservableTransport } from "./transport";
import { SampleHistogram } from "./histogram";
import type { TransportMetricsEvent, SovereigntyViolationEvent } from "./types";
import type { TransportPublisher, TransportSubscriber } from "../transport/types";
import type { MyelinEnvelope } from "../types";

function envelope(overrides: Partial<MyelinEnvelope> = {}): MyelinEnvelope {
  return {
    id: crypto.randomUUID(),
    source: "metafactory.cortex.dispatch",
    type: "task.code-review",
    timestamp: "2026-05-10T10:00:00Z",
    sovereignty: { classification: "local", data_residency: "CH", max_hop: 0, frontier_ok: false, model_class: "any" },
    payload: {},
    ...overrides,
  };
}

function fakeTransport(opts: { onPublish?: (s: string, e: MyelinEnvelope) => Promise<void> } = {}) {
  const published: { subject: string; envelope: MyelinEnvelope }[] = [];
  let handler: ((env: MyelinEnvelope) => Promise<void>) | null = null;
  const pub: TransportPublisher = {
    async publish(subject, env) {
      if (opts.onPublish) await opts.onPublish(subject, env);
      published.push({ subject, envelope: env });
    },
    async request(): Promise<MyelinEnvelope> { throw new Error("not implemented"); },
    async close() {},
  };
  const sub: TransportSubscriber = {
    async subscribe(_subject, h) {
      handler = h;
      return { async unsubscribe() { handler = null; } };
    },
    async subscribeBestEffort(_subject, h) {
      handler = h;
      return { async unsubscribe() { handler = null; } };
    },
    async close() {},
  };
  return {
    pub,
    sub,
    published,
    deliver: async (env: MyelinEnvelope) => {
      if (!handler) throw new Error("no handler");
      await handler(env);
    },
  };
}

function makeClock() {
  let t = 1_700_000_000_000;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe("SampleHistogram", () => {
  it("returns NaN snapshot when empty", () => {
    const h = new SampleHistogram(8);
    const snap = h.snapshot();
    expect(snap.count).toBe(0);
    expect(Number.isNaN(snap.p50)).toBe(true);
  });

  it("computes percentiles for 100 samples", () => {
    const h = new SampleHistogram(200);
    for (let i = 1; i <= 100; i++) h.observe(i);
    const snap = h.snapshot();
    expect(snap.count).toBe(100);
    expect(snap.min).toBe(1);
    expect(snap.max).toBe(100);
    expect(snap.p50).toBe(50);
    expect(snap.p95).toBe(95);
    expect(snap.p99).toBe(99);
  });

  it("ring-buffer eviction at cap", () => {
    const h = new SampleHistogram(4);
    h.observe(1); h.observe(2); h.observe(3); h.observe(4); h.observe(5); h.observe(6);
    expect(h.count()).toBe(4);
    const snap = h.snapshot();
    // Oldest entries (1, 2) evicted; remaining are {3,4,5,6}.
    expect(snap.min).toBe(3);
    expect(snap.max).toBe(6);
  });

  it("rejects non-finite or negative samples silently", () => {
    const h = new SampleHistogram();
    h.observe(NaN);
    h.observe(Infinity);
    h.observe(-1);
    expect(h.count()).toBe(0);
  });

  it("rejects bad cap construction", () => {
    expect(() => new SampleHistogram(0)).toThrow(/positive integer/);
    expect(() => new SampleHistogram(-1)).toThrow(/positive integer/);
    expect(() => new SampleHistogram(1.5)).toThrow(/positive integer/);
  });

  it("reset clears samples", () => {
    const h = new SampleHistogram();
    h.observe(10);
    h.reset();
    expect(h.count()).toBe(0);
  });
});

describe("ObservableTransport — publish counters", () => {
  it("counts publish total + classification", async () => {
    const t = fakeTransport();
    const clock = makeClock();
    const obs = new ObservableTransport({ publisher: t.pub, subscriber: t.sub, autoStart: false, now: clock.now });
    await obs.publish("subj", envelope());
    await obs.publish("subj", envelope({ sovereignty: { classification: "federated", data_residency: "CH", max_hop: 1, frontier_ok: false, model_class: "any" } }));
    const snap = obs.snapshot();
    expect(snap.publish.total).toBe(2);
    expect(snap.publish.byClassification.local).toBe(1);
    expect(snap.publish.byClassification.federated).toBe(1);
    await obs.close();
  });

  it("records publish latency from clock delta", async () => {
    const clock = makeClock();
    const t = fakeTransport({ onPublish: async () => { clock.advance(50); } });
    const obs = new ObservableTransport({ publisher: t.pub, subscriber: t.sub, autoStart: false, now: clock.now });
    await obs.publish("subj", envelope());
    const snap = obs.snapshot();
    expect(snap.publish.latencyMs.count).toBe(1);
    expect(snap.publish.latencyMs.p50).toBe(50);
    await obs.close();
  });

  it("counts publish errors", async () => {
    const t = fakeTransport({ onPublish: async () => { throw new Error("transport down"); } });
    const obs = new ObservableTransport({ publisher: t.pub, subscriber: t.sub, autoStart: false });
    await expect(obs.publish("subj", envelope())).rejects.toThrow(/transport down/);
    const snap = obs.snapshot();
    expect(snap.publish.errors).toBe(1);
    expect(snap.publish.total).toBe(0);
    expect(snap.sovereignty.blockedTotal).toBe(0);
    await obs.close();
  });
});

describe("ObservableTransport — sovereignty violations", () => {
  it("detects compliance-block in error message and emits violation event", async () => {
    const t = fakeTransport({ onPublish: async () => { throw new Error("compliance-block:classification-mismatch — local cannot publish to federated.*"); } });
    const obs = new ObservableTransport({ publisher: t.pub, subscriber: t.sub, autoStart: false });
    const violations: SovereigntyViolationEvent[] = [];
    obs.on("violation", (v) => violations.push(v));
    await expect(obs.publish("federated.x.tasks", envelope())).rejects.toThrow();
    const snap = obs.snapshot();
    expect(snap.sovereignty.blockedTotal).toBe(1);
    expect(snap.sovereignty.byReasonCode["compliance-block:classification-mismatch"]).toBe(1);
    expect(violations).toHaveLength(1);
    expect(violations[0].reason_code).toBe("compliance-block:classification-mismatch");
    expect(violations[0].subject).toBe("federated.x.tasks");
    await obs.close();
  });

  it("non-sovereignty errors are NOT counted as violations", async () => {
    const t = fakeTransport({ onPublish: async () => { throw new Error("network unreachable"); } });
    const obs = new ObservableTransport({ publisher: t.pub, subscriber: t.sub, autoStart: false });
    await expect(obs.publish("subj", envelope())).rejects.toThrow();
    const snap = obs.snapshot();
    expect(snap.sovereignty.blockedTotal).toBe(0);
    expect(snap.publish.errors).toBe(1);
    await obs.close();
  });

  it("violation listener errors do not affect publish path", async () => {
    const t = fakeTransport({ onPublish: async () => { throw new Error("compliance-block:scope-exceeded"); } });
    const obs = new ObservableTransport({ publisher: t.pub, subscriber: t.sub, autoStart: false });
    obs.on("violation", () => { throw new Error("listener crashed"); });
    await expect(obs.publish("subj", envelope())).rejects.toThrow(/scope-exceeded/);
    await obs.close();
  });
});

describe("ObservableTransport — subscribe counters", () => {
  it("counts active subscriptions and decrements on unsubscribe", async () => {
    const t = fakeTransport();
    const obs = new ObservableTransport({ publisher: t.pub, subscriber: t.sub, autoStart: false });
    const s1 = await obs.subscribe("a", async () => {});
    const s2 = await obs.subscribe("b", async () => {});
    expect(obs.snapshot().subscribe.activeSubscriptions).toBe(2);
    await s1.unsubscribe();
    expect(obs.snapshot().subscribe.activeSubscriptions).toBe(1);
    await s2.unsubscribe();
    expect(obs.snapshot().subscribe.activeSubscriptions).toBe(0);
    await obs.close();
  });

  it("counts messages received and handler errors", async () => {
    const t = fakeTransport();
    const obs = new ObservableTransport({ publisher: t.pub, subscriber: t.sub, autoStart: false });
    let count = 0;
    await obs.subscribe("subj", async () => {
      count++;
      if (count === 2) throw new Error("handler boom");
    });
    await t.deliver(envelope());
    await expect(t.deliver(envelope())).rejects.toThrow(/handler boom/);
    const snap = obs.snapshot();
    expect(snap.subscribe.messagesReceived).toBe(2);
    expect(snap.subscribe.handlerErrors).toBe(1);
    await obs.close();
  });

  it("idempotent unsubscribe", async () => {
    const t = fakeTransport();
    const obs = new ObservableTransport({ publisher: t.pub, subscriber: t.sub, autoStart: false });
    const s = await obs.subscribe("subj", async () => {});
    await s.unsubscribe();
    await s.unsubscribe();
    expect(obs.snapshot().subscribe.activeSubscriptions).toBe(0);
    await obs.close();
  });
});

describe("ObservableTransport — flush & listeners", () => {
  it("flush() emits metrics event and resets counters", async () => {
    const t = fakeTransport();
    const clock = makeClock();
    const obs = new ObservableTransport({ publisher: t.pub, subscriber: t.sub, autoStart: false, now: clock.now });
    const events: TransportMetricsEvent[] = [];
    obs.on("metrics", (e) => events.push(e));
    await obs.publish("subj", envelope());
    obs.flush();
    expect(events).toHaveLength(1);
    expect(events[0].publish.total).toBe(1);
    // After flush, counters reset.
    expect(obs.snapshot().publish.total).toBe(0);
    await obs.close();
  });

  it("on('metrics') returns unsubscribe function", async () => {
    const t = fakeTransport();
    const obs = new ObservableTransport({ publisher: t.pub, subscriber: t.sub, autoStart: false });
    const events: TransportMetricsEvent[] = [];
    const off = obs.on("metrics", (e) => events.push(e));
    obs.flush();
    off();
    obs.flush();
    expect(events).toHaveLength(1);
    await obs.close();
  });

  it("metrics listener errors do not crash flush() — matches emitViolation guard", async () => {
    const t = fakeTransport();
    const obs = new ObservableTransport({ publisher: t.pub, subscriber: t.sub, autoStart: false });
    let goodCalled = false;
    obs.on("metrics", () => { throw new Error("listener exploded"); });
    obs.on("metrics", () => { goodCalled = true; });
    expect(() => obs.flush()).not.toThrow();
    // Subsequent listeners still receive the event despite earlier listener throwing.
    expect(goodCalled).toBe(true);
    await obs.close();
  });
});

describe("ObservableTransport — close", () => {
  it("close stops emit timer and closes underlying transport", async () => {
    let pubClosed = false, subClosed = false;
    const pub: TransportPublisher = { async publish() {}, async request(): Promise<MyelinEnvelope> { throw new Error("not implemented"); }, async close() { pubClosed = true; } };
    const sub: TransportSubscriber = {
      async subscribe() { return { async unsubscribe() {} }; },
      async subscribeBestEffort() { return { async unsubscribe() {} }; },
      async close() { subClosed = true; },
    };
    const obs = createObservableTransport({ publisher: pub, subscriber: sub, autoStart: false });
    await obs.close();
    expect(pubClosed).toBe(true);
    expect(subClosed).toBe(true);
  });
});

describe("ObservableTransport — consumer health", () => {
  it("snapshot.subscribe.consumers is empty when no provider is configured", () => {
    const t = fakeTransport();
    const obs = new ObservableTransport({ publisher: t.pub, subscriber: t.sub, autoStart: false });
    const snap = obs.snapshot();
    expect(snap.subscribe.consumers).toEqual([]);
  });

  it("refreshConsumerHealth() populates the cache from the provider", async () => {
    const t = fakeTransport();
    const provider = async () => [
      {
        durableName: "DUR_A",
        streamName: "S",
        pending: 12,
        ackPending: 3,
        redelivered: 1,
        waiting: 0,
        deliveredConsumerSeq: 100,
        ackFloorConsumerSeq: 97,
      },
    ];
    const obs = new ObservableTransport({
      publisher: t.pub,
      subscriber: t.sub,
      autoStart: false,
      consumerHealthProvider: provider,
    });
    await obs.refreshConsumerHealth();
    const snap = obs.snapshot();
    expect(snap.subscribe.consumers).toHaveLength(1);
    expect(snap.subscribe.consumers[0]).toMatchObject({ durableName: "DUR_A", pending: 12, ackPending: 3, redelivered: 1 });
  });

  it("provider rejection is swallowed and cache retains prior value", async () => {
    const t = fakeTransport();
    let call = 0;
    const provider = async () => {
      call++;
      if (call === 1) return [{
        durableName: "DUR_B", streamName: "S",
        pending: 7, ackPending: 0, redelivered: 0, waiting: 0,
        deliveredConsumerSeq: 7, ackFloorConsumerSeq: 7,
      }];
      throw new Error("nats unreachable");
    };
    const obs = new ObservableTransport({
      publisher: t.pub,
      subscriber: t.sub,
      autoStart: false,
      consumerHealthProvider: provider,
    });
    await obs.refreshConsumerHealth();
    const result = await obs.refreshConsumerHealth();
    // The failed call returns the cached prior value, not [].
    expect(result).toHaveLength(1);
    expect(result[0].durableName).toBe("DUR_B");
    expect(obs.snapshot().subscribe.consumers[0].pending).toBe(7);
  });

  it("flush() kicks off an async refresh without awaiting it", async () => {
    const t = fakeTransport();
    let providerCalls = 0;
    let releaseProvider!: () => void;
    const blocker = new Promise<void>((resolve) => { releaseProvider = resolve; });
    const provider = async () => {
      providerCalls++;
      await blocker;
      return [{
        durableName: "DUR_C", streamName: "S",
        pending: 99, ackPending: 0, redelivered: 0, waiting: 0,
        deliveredConsumerSeq: 99, ackFloorConsumerSeq: 99,
      }];
    };
    const obs = new ObservableTransport({
      publisher: t.pub,
      subscriber: t.sub,
      autoStart: false,
      consumerHealthProvider: provider,
    });
    // flush() must return synchronously even though the provider is
    // still blocked. The first flush returns the empty initial cache;
    // the provider call kicked off here will populate the cache after
    // we release the blocker.
    const first = obs.flush();
    expect(first.subscribe.consumers).toEqual([]);
    expect(providerCalls).toBe(1);
    releaseProvider();
    // Allow the queued microtask to settle so the cache is populated.
    await new Promise((r) => setTimeout(r, 0));
    expect(obs.snapshot().subscribe.consumers[0].pending).toBe(99);
  });

  it("snapshot returns a defensive copy — mutating result does not affect cache", async () => {
    const t = fakeTransport();
    const provider = async () => [{
      durableName: "DUR_D", streamName: "S",
      pending: 1, ackPending: 0, redelivered: 0, waiting: 0,
      deliveredConsumerSeq: 1, ackFloorConsumerSeq: 1,
    }];
    const obs = new ObservableTransport({
      publisher: t.pub,
      subscriber: t.sub,
      autoStart: false,
      consumerHealthProvider: provider,
    });
    await obs.refreshConsumerHealth();
    const snap = obs.snapshot();
    snap.subscribe.consumers[0].pending = 9999;
    expect(obs.snapshot().subscribe.consumers[0].pending).toBe(1);
  });
});

describe("ObservableTransport — metrics auto-emit", () => {
  it("metricsSubject derives canonical subject with dns-unsafe chars collapsed", () => {
    expect(ObservableTransport.metricsSubject("acme", "metafactory.cortex.dispatch"))
      .toBe("local.acme._metrics.transport.metafactory-cortex-dispatch");
    expect(ObservableTransport.metricsSubject("acme", "did:mf:agent#a/b"))
      .toBe("local.acme._metrics.transport.did-mf-agent-a-b");
    expect(ObservableTransport.metricsSubject("acme", "metafactory.cortex.dispatch", "default"))
      .toBe("local.acme.default._metrics.transport.metafactory-cortex-dispatch");
  });

  it("metricsSubject rejects orgs that aren't a single NATS subject segment", () => {
    // Dots tokenize as extra segments.
    expect(() => ObservableTransport.metricsSubject("ac.me", "src")).toThrow(/invalid org/);
    // Wildcards.
    expect(() => ObservableTransport.metricsSubject("*", "src")).toThrow(/invalid org/);
    expect(() => ObservableTransport.metricsSubject("ac>", "src")).toThrow(/invalid org/);
    // Uppercase / underscore not in the grammar.
    expect(() => ObservableTransport.metricsSubject("ACME", "src")).toThrow(/invalid org/);
    expect(() => ObservableTransport.metricsSubject("ac_me", "src")).toThrow(/invalid org/);
    // Empty.
    expect(() => ObservableTransport.metricsSubject("", "src")).toThrow(/invalid org/);
  });

  it("metricsSubject rejects invalid stack segments", () => {
    expect(() => ObservableTransport.metricsSubject("acme", "src", "BadStack")).toThrow(/invalid stack/);
  });

  it("metricsSubject rejects source values with no alphanumeric content", () => {
    expect(() => ObservableTransport.metricsSubject("acme", "")).toThrow(/source is required/);
    expect(() => ObservableTransport.metricsSubject("acme", "...")).toThrow(/no alphanumeric/);
    expect(() => ObservableTransport.metricsSubject("acme", "/:#")).toThrow(/no alphanumeric/);
  });

  it("metricsSubject normalizes consecutive separators in source", () => {
    // Adjacent unsafe chars collapse to one `-`, then leading/trailing
    // hyphens are stripped — final subject stays canonical.
    expect(ObservableTransport.metricsSubject("acme", "..a..b.."))
      .toBe("local.acme._metrics.transport.a-b");
  });

  it("flush() publishes a transport.metrics.snapshot envelope when metricsAutoEmit is set", async () => {
    const t = fakeTransport();
    const emitted: { subject: string; input: { source: string; type: string; payload: Record<string, unknown>; sovereignty?: { classification?: string } } }[] = [];
    const envelopePublisher = {
      async publish(input: { source: string; type: string; payload: Record<string, unknown>; sovereignty?: { classification?: string } }, subject?: string) {
        emitted.push({ subject: subject ?? "", input });
      },
      async request(): Promise<MyelinEnvelope> { throw new Error("not implemented"); },
      async close() {},
    };
    const obs = new ObservableTransport({
      publisher: t.pub,
      subscriber: t.sub,
      autoStart: false,
        metricsAutoEmit: {
          publisher: envelopePublisher,
          org: "acme",
          stack: "default",
          source: "metafactory.cortex.dispatch",
        },
    });
    await obs.publish("local.acme.test", envelope());
    obs.flush();

    expect(emitted).toHaveLength(1);
    expect(emitted[0].subject).toBe("local.acme.default._metrics.transport.metafactory-cortex-dispatch");
    expect(emitted[0].input.source).toBe("metafactory.cortex.dispatch");
    expect(emitted[0].input.type).toBe("transport.metrics.snapshot");
    expect(emitted[0].input.sovereignty?.classification).toBe("local");
    expect(emitted[0].input.payload.publish).toBeDefined();
    expect(emitted[0].input.payload.subscribe).toBeDefined();
    expect(emitted[0].input.payload.sovereignty).toBeDefined();
    expect((emitted[0].input.payload.publish as { total: number }).total).toBe(1);
  });

  it("does NOT auto-emit when metricsAutoEmit option is absent", async () => {
    const t = fakeTransport();
    const obs = new ObservableTransport({
      publisher: t.pub,
      subscriber: t.sub,
      autoStart: false,
    });
    await obs.publish("local.acme.test", envelope());
    obs.flush();
    // Publisher under test received the user payload only, never the
    // metrics envelope. The fake publisher used here is the wrapped
    // transport, not the metrics publisher.
    expect(t.published).toHaveLength(1);
    expect(t.published[0].envelope.type).toBe("task.code-review");
  });

  it("auto-emit failures are swallowed and never crash flush()", async () => {
    const t = fakeTransport();
    const envelopePublisher = {
      async publish(): Promise<void> {
        throw new Error("metrics nats down");
      },
      async request(): Promise<MyelinEnvelope> { throw new Error("not implemented"); },
      async close() {},
    };
    const obs = new ObservableTransport({
      publisher: t.pub,
      subscriber: t.sub,
      autoStart: false,
      metricsAutoEmit: { publisher: envelopePublisher, org: "acme", source: "test.source" },
    });
    await obs.publish("local.acme.test", envelope());
    // flush() must not throw despite the publisher rejecting.
    expect(() => obs.flush()).not.toThrow();
  });
});
