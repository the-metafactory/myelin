import { describe, it, expect } from "bun:test";
import { MiddlewareTransport, createMiddlewareTransport } from "./transport";
import { loggingMiddleware, metricsMiddleware } from "./builtins";
import type { MiddlewareLogger, MiddlewareMetrics, MiddlewareCounter } from "./builtins";
import type { PublishMiddleware, SubscribeMiddleware, MiddlewareContext } from "./types";
import type { TransportPublisher, TransportSubscriber, Subscription } from "../types";
import type { MyelinEnvelope } from "../../types";

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

function fakeTransport() {
  const published: Array<{ subject: string; envelope: MyelinEnvelope }> = [];
  let handler: ((env: MyelinEnvelope) => Promise<void>) | null = null;
  const pub: TransportPublisher = {
    async publish(subject, env) {
      published.push({ subject, envelope: env });
    },
    async close() {},
  };
  const sub: TransportSubscriber = {
    async subscribe(_subject, h, _options) {
      handler = h;
      const subscription: Subscription = {
        async unsubscribe() {
          handler = null;
        },
      };
      return subscription;
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
      if (!handler) throw new Error("no handler subscribed");
      await handler(env);
    },
  };
}

describe("MiddlewareTransport — empty chain (pass-through)", () => {
  it("publishes through to underlying transport", async () => {
    const t = fakeTransport();
    const mw = createMiddlewareTransport({ publisher: t.pub, subscriber: t.sub });
    const env = envelope();
    await mw.publish("local.metafactory.task", env);
    expect(t.published).toHaveLength(1);
    expect(t.published[0]!.envelope).toBe(env);
  });

  it("subscribe handler receives envelope unchanged", async () => {
    const t = fakeTransport();
    const mw = createMiddlewareTransport({ publisher: t.pub, subscriber: t.sub });
    const seen: MyelinEnvelope[] = [];
    await mw.subscribe("local.metafactory.>", async (e) => { seen.push(e); });
    const env = envelope();
    await t.deliver(env);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(env);
  });
});

describe("MiddlewareTransport — publish chain", () => {
  it("runs middleware in registration order", async () => {
    const t = fakeTransport();
    const order: string[] = [];
    const a: PublishMiddleware = (e) => { order.push("a"); return e; };
    const b: PublishMiddleware = (e) => { order.push("b"); return e; };
    const c: PublishMiddleware = (e) => { order.push("c"); return e; };
    const mw = createMiddlewareTransport({ publisher: t.pub, subscriber: t.sub, publishMiddleware: [a, b, c] });
    await mw.publish("subj", envelope());
    expect(order).toEqual(["a", "b", "c"]);
  });

  it("passes transformed envelope down the chain", async () => {
    const t = fakeTransport();
    const enrich: PublishMiddleware = (e) => ({ ...e, extensions: { ...(e.extensions ?? {}), trace_id: "t-1" } });
    const verify: PublishMiddleware = (e) => {
      expect(e.extensions?.trace_id).toBe("t-1");
      return e;
    };
    const mw = createMiddlewareTransport({ publisher: t.pub, subscriber: t.sub, publishMiddleware: [enrich, verify] });
    await mw.publish("subj", envelope());
    expect(t.published[0]!.envelope.extensions?.trace_id).toBe("t-1");
  });

  it("filters when middleware returns null — wire publish skipped", async () => {
    const t = fakeTransport();
    const filter: PublishMiddleware = (e) => (e.sovereignty.classification === "public" ? null : e);
    const mw = createMiddlewareTransport({ publisher: t.pub, subscriber: t.sub, publishMiddleware: [filter] });
    await mw.publish("subj", envelope({ sovereignty: { classification: "public", data_residency: "CH", max_hop: 0, frontier_ok: false, model_class: "any" } }));
    expect(t.published).toHaveLength(0);
  });

  it("propagates middleware errors — subsequent middleware skipped", async () => {
    const t = fakeTransport();
    let bRan = false;
    const a: PublishMiddleware = () => { throw new Error("boom"); };
    const b: PublishMiddleware = (e) => { bRan = true; return e; };
    const mw = createMiddlewareTransport({ publisher: t.pub, subscriber: t.sub, publishMiddleware: [a, b] });
    await expect(mw.publish("subj", envelope())).rejects.toThrow(/boom/);
    expect(bRan).toBe(false);
    expect(t.published).toHaveLength(0);
  });

  it("supports async middleware", async () => {
    const t = fakeTransport();
    const asyncMw: PublishMiddleware = async (e) => {
      await new Promise((r) => setTimeout(r, 1));
      return { ...e, extensions: { async: true } };
    };
    const mw = createMiddlewareTransport({ publisher: t.pub, subscriber: t.sub, publishMiddleware: [asyncMw] });
    await mw.publish("subj", envelope());
    expect(t.published[0]!.envelope.extensions?.async).toBe(true);
  });

  it("provides MiddlewareContext with subject, direction, timestamp", async () => {
    const t = fakeTransport();
    let captured: MiddlewareContext | null = null;
    const probe: PublishMiddleware = (e, ctx) => { captured = ctx; return e; };
    const mw = createMiddlewareTransport({ publisher: t.pub, subscriber: t.sub, publishMiddleware: [probe] });
    const before = Date.now();
    await mw.publish("local.metafactory.task", envelope());
    const after = Date.now();
    expect(captured).not.toBeNull();
    expect(captured!.subject).toBe("local.metafactory.task");
    expect(captured!.direction).toBe("publish");
    expect(captured!.timestamp.getTime()).toBeGreaterThanOrEqual(before);
    expect(captured!.timestamp.getTime()).toBeLessThanOrEqual(after);
  });

  it("defensive copy — mutating options.publishMiddleware after construction does not change live chain", async () => {
    const t = fakeTransport();
    const order: string[] = [];
    const a: PublishMiddleware = (e) => { order.push("a"); return e; };
    const b: PublishMiddleware = (e) => { order.push("b"); return e; };
    const chain = [a];
    const mw = createMiddlewareTransport({ publisher: t.pub, subscriber: t.sub, publishMiddleware: chain });
    chain.push(b);
    await mw.publish("subj", envelope());
    expect(order).toEqual(["a"]);
  });
});

describe("MiddlewareTransport — subscribe chain", () => {
  it("filters envelopes — handler not called", async () => {
    const t = fakeTransport();
    const filter: SubscribeMiddleware = (e) => (e.source.startsWith("test.") ? null : e);
    const mw = createMiddlewareTransport({ publisher: t.pub, subscriber: t.sub, subscribeMiddleware: [filter] });
    const seen: string[] = [];
    await mw.subscribe("subj", async (e) => { seen.push(e.id); });
    await t.deliver(envelope({ source: "test.fake.agent" }));
    await t.deliver(envelope({ source: "metafactory.cortex.dispatch" }));
    expect(seen).toHaveLength(1);
  });

  it("transforms envelope before handler", async () => {
    const t = fakeTransport();
    const tag: SubscribeMiddleware = (e) => ({ ...e, extensions: { ...(e.extensions ?? {}), seen_at: "x" } });
    const mw = createMiddlewareTransport({ publisher: t.pub, subscriber: t.sub, subscribeMiddleware: [tag] });
    let captured: MyelinEnvelope | null = null;
    await mw.subscribe("subj", async (e) => { captured = e; });
    await t.deliver(envelope());
    expect(captured!.extensions?.seen_at).toBe("x");
  });

  it("error in subscribe middleware propagates and skips handler", async () => {
    const t = fakeTransport();
    const bad: SubscribeMiddleware = () => { throw new Error("subscribe boom"); };
    const mw = createMiddlewareTransport({ publisher: t.pub, subscriber: t.sub, subscribeMiddleware: [bad] });
    let handlerRan = false;
    await mw.subscribe("subj", async () => { handlerRan = true; });
    await expect(t.deliver(envelope())).rejects.toThrow(/subscribe boom/);
    expect(handlerRan).toBe(false);
  });

  it("subscribeBestEffort uses the same chain", async () => {
    const t = fakeTransport();
    const calls: string[] = [];
    const tap: SubscribeMiddleware = (e) => { calls.push(e.id); return e; };
    const mw = createMiddlewareTransport({ publisher: t.pub, subscriber: t.sub, subscribeMiddleware: [tap] });
    let received = 0;
    await mw.subscribeBestEffort("subj", async () => { received++; });
    await t.deliver(envelope({ id: "550e8400-e29b-41d4-a716-446655440001" }));
    expect(calls).toHaveLength(1);
    expect(received).toBe(1);
  });

  it("MiddlewareContext.direction === 'subscribe'", async () => {
    const t = fakeTransport();
    const captured: { dir?: string } = {};
    const probe: SubscribeMiddleware = (e, ctx) => { captured.dir = ctx.direction; return e; };
    const mw = createMiddlewareTransport({ publisher: t.pub, subscriber: t.sub, subscribeMiddleware: [probe] });
    await mw.subscribe("subj", async () => {});
    await t.deliver(envelope());
    expect(captured.dir).toBe("subscribe");
  });
});

describe("loggingMiddleware", () => {
  it("logs envelope metadata on publish", async () => {
    const t = fakeTransport();
    const records: Array<Record<string, unknown>> = [];
    const logger: MiddlewareLogger = { info: (p) => { records.push(p); } };
    const mw = createMiddlewareTransport({ publisher: t.pub, subscriber: t.sub, publishMiddleware: [loggingMiddleware(logger)] });
    await mw.publish("subj", envelope({ type: "task.deploy" }));
    expect(records).toHaveLength(1);
    expect(records[0]!.direction).toBe("publish");
    expect(records[0]!.type).toBe("task.deploy");
    expect(records[0]!.classification).toBe("local");
  });

  it("does not transform envelope", async () => {
    const t = fakeTransport();
    const logger: MiddlewareLogger = { info: () => {} };
    const mw = createMiddlewareTransport({ publisher: t.pub, subscriber: t.sub, publishMiddleware: [loggingMiddleware(logger)] });
    const env = envelope();
    await mw.publish("subj", env);
    expect(t.published[0]!.envelope).toEqual(env);
  });
});

describe("metricsMiddleware", () => {
  function makeMetrics() {
    const calls: string[] = [];
    const counter = (name: string): MiddlewareCounter => ({
      inc: (labels) => { calls.push(`${name}:${JSON.stringify(labels ?? {})}`); },
    });
    const metrics: MiddlewareMetrics = {
      publishedTotal: counter("published"),
      receivedTotal: counter("received"),
    };
    return { metrics, calls };
  }

  it("increments publishedTotal on publish with type+classification labels", async () => {
    const t = fakeTransport();
    const { metrics, calls } = makeMetrics();
    const mwHelpers = metricsMiddleware(metrics);
    const mw = createMiddlewareTransport({ publisher: t.pub, subscriber: t.sub, publishMiddleware: [mwHelpers.publish] });
    await mw.publish("subj", envelope({ type: "task.review" }));
    expect(calls.some((c) => c.startsWith("published:") && c.includes("task.review"))).toBe(true);
    expect(calls.some((c) => c.includes("\"classification\":\"local\""))).toBe(true);
  });

  it("does NOT measure latency (counters only — see F-17 ObservableTransport for latency)", async () => {
    const t = fakeTransport();
    const { metrics, calls } = makeMetrics();
    const mwHelpers = metricsMiddleware(metrics);
    const mw = createMiddlewareTransport({ publisher: t.pub, subscriber: t.sub, publishMiddleware: [mwHelpers.publish] });
    await mw.publish("subj", envelope());
    expect(calls.some((c) => c.startsWith("latency:"))).toBe(false);
  });

  it("increments receivedTotal on subscribe", async () => {
    const t = fakeTransport();
    const { metrics, calls } = makeMetrics();
    const mwHelpers = metricsMiddleware(metrics);
    const mw = createMiddlewareTransport({ publisher: t.pub, subscriber: t.sub, subscribeMiddleware: [mwHelpers.subscribe] });
    await mw.subscribe("subj", async () => {});
    await t.deliver(envelope({ type: "task.received" }));
    expect(calls.some((c) => c.startsWith("received:") && c.includes("task.received"))).toBe(true);
  });
});

describe("close", () => {
  it("closes underlying publisher and subscriber", async () => {
    let pubClosed = false, subClosed = false;
    const pub: TransportPublisher = { async publish() {}, async close() { pubClosed = true; } };
    const sub: TransportSubscriber = {
      async subscribe() { return { async unsubscribe() {} }; },
      async subscribeBestEffort() { return { async unsubscribe() {} }; },
      async close() { subClosed = true; },
    };
    const mw = createMiddlewareTransport({ publisher: pub, subscriber: sub });
    await mw.close();
    expect(pubClosed).toBe(true);
    expect(subClosed).toBe(true);
  });
});

describe("MiddlewareTransport instanceof", () => {
  it("instances are MiddlewareTransport", () => {
    const t = fakeTransport();
    const mw = createMiddlewareTransport({ publisher: t.pub, subscriber: t.sub });
    expect(mw).toBeInstanceOf(MiddlewareTransport);
  });
});
