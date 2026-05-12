import { describe, it, expect } from "bun:test";
import {
  createDeadLetterEnvelope,
  deriveDeadLetterSubject,
  isDeadLetterEnvelope,
  republishDeadLetter,
  NakChainTracker,
  DeadLetterHandler,
  type DeadLetterEnvelope,
} from "./dead-letter";
import type { EnvelopePublisher, EnvelopePublishInput, Subscription } from "./types";
import type { MyelinEnvelope } from "../types";

const sampleEnvelope: MyelinEnvelope = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  source: "metafactory.cortex.dispatch",
  type: "tasks.code-review",
  timestamp: "2026-05-09T20:00:00Z",
  correlation_id: "770e8400-e29b-41d4-a716-446655440009",
  sovereignty: { classification: "local", data_residency: "CH", max_hop: 0, frontier_ok: false, model_class: "any" },
  payload: { pr_url: "https://github.com/x/y/pull/1" },
};

function fakePublisher() {
  const published: Array<{ input: EnvelopePublishInput; subject?: string }> = [];
  const publisher: EnvelopePublisher = {
    async publish(input: EnvelopePublishInput, subject?: string) {
      published.push({ input, subject });
    },
    async request(): Promise<MyelinEnvelope> { throw new Error("not implemented"); },
    async close() {},
  };
  return { publisher, published };
}

describe("deriveDeadLetterSubject", () => {
  it("derives from local task subject", () => {
    expect(deriveDeadLetterSubject("local.acme.tasks.code-review.typescript"))
      .toBe("local.acme.tasks.dead-letter.code-review");
  });

  it("derives from federated task subject", () => {
    expect(deriveDeadLetterSubject("federated.acme.tasks.security-scan.dependency"))
      .toBe("federated.acme.tasks.dead-letter.security-scan");
  });

  it("idempotent — already a dead-letter subject returns as-is", () => {
    expect(deriveDeadLetterSubject("local.acme.tasks.dead-letter.code-review"))
      .toBe("local.acme.tasks.dead-letter.code-review");
  });

  it("rejects malformed subject (no `tasks` segment)", () => {
    expect(() => deriveDeadLetterSubject("local.acme.signal.metrics.cpu")).toThrow(/unexpected subject shape/);
  });

  it("rejects subject with too few segments", () => {
    expect(() => deriveDeadLetterSubject("local.acme.tasks")).toThrow(/unexpected subject shape/);
  });

  it("supports direct-address task subjects (capability segment after @principal)", () => {
    // local.{org}.tasks.@{principal}.{capability} — capability is at parts[3]
    // when the @-segment is treated as the capability slot for routing.
    // Per spec parts[3] is the segment immediately after `tasks` and that
    // is what the dead-letter capability becomes; for direct-address that
    // segment is the @principal token. Operators monitoring per-capability
    // dead-letter would not subscribe to @principal directly — but the
    // mechanism stays consistent.
    expect(deriveDeadLetterSubject("local.metafactory.tasks.@did-mf-forge.release"))
      .toBe("local.metafactory.tasks.dead-letter.@did-mf-forge");
  });
});

describe("createDeadLetterEnvelope", () => {
  it("wraps original under extensions.dead_letter", () => {
    const dl = createDeadLetterEnvelope(sampleEnvelope, {
      original_subject: "local.metafactory.tasks.code-review.typescript",
      originating_consumer: "code-review-workers",
      delivery_count: 3,
      nak_chain: ["cant-do", "cant-do", "wont-do"],
      final_nak_reason: "wont-do",
    });
    expect(dl.extensions.dead_letter.delivery_count).toBe(3);
    expect(dl.extensions.dead_letter.final_nak_reason).toBe("wont-do");
    expect(dl.extensions.dead_letter.nak_chain).toEqual(["cant-do", "cant-do", "wont-do"]);
    expect(dl.extensions.dead_letter.dead_lettered_at).toBeDefined();
  });

  it("preserves correlation_id", () => {
    const dl = createDeadLetterEnvelope(sampleEnvelope, {
      original_subject: "local.metafactory.tasks.code-review.typescript",
      originating_consumer: "x",
      delivery_count: 3,
      nak_chain: [],
      final_nak_reason: "compliance-block",
    });
    expect(dl.correlation_id).toBe(sampleEnvelope.correlation_id);
  });

  it("falls back to original.id when correlation_id absent", () => {
    const noCorr: MyelinEnvelope = { ...sampleEnvelope, correlation_id: undefined };
    const dl = createDeadLetterEnvelope(noCorr, {
      original_subject: "local.x.tasks.y.z",
      originating_consumer: "c",
      delivery_count: 1,
      nak_chain: [],
      final_nak_reason: "compliance-block",
    });
    expect(dl.correlation_id).toBe(noCorr.id);
  });

  it("mints fresh id and timestamp", () => {
    const dl = createDeadLetterEnvelope(sampleEnvelope, {
      original_subject: "local.x.tasks.y.z",
      originating_consumer: "c",
      delivery_count: 1,
      nak_chain: [],
      final_nak_reason: "compliance-block",
    });
    expect(dl.id).not.toBe(sampleEnvelope.id);
    expect(dl.timestamp).not.toBe(sampleEnvelope.timestamp);
  });

  it("preserves pre-existing extensions", () => {
    const env: MyelinEnvelope = { ...sampleEnvelope, extensions: { trace_id: "abc" } };
    const dl = createDeadLetterEnvelope(env, {
      original_subject: "local.x.tasks.y.z",
      originating_consumer: "c",
      delivery_count: 1,
      nak_chain: [],
      final_nak_reason: "compliance-block",
    });
    expect(dl.extensions.trace_id).toBe("abc");
    expect(dl.extensions.dead_letter).toBeDefined();
  });
});

describe("isDeadLetterEnvelope", () => {
  it("true for dead-letter envelope", () => {
    const dl = createDeadLetterEnvelope(sampleEnvelope, {
      original_subject: "local.x.tasks.y.z",
      originating_consumer: "c",
      delivery_count: 1,
      nak_chain: [],
      final_nak_reason: "compliance-block",
    });
    expect(isDeadLetterEnvelope(dl)).toBe(true);
  });

  it("false for plain envelope", () => {
    expect(isDeadLetterEnvelope(sampleEnvelope)).toBe(false);
  });

  it("false for envelope with other extensions", () => {
    const env: MyelinEnvelope = { ...sampleEnvelope, extensions: { trace_id: "abc" } };
    expect(isDeadLetterEnvelope(env)).toBe(false);
  });
});

describe("republishDeadLetter", () => {
  it("strips dead_letter extension and publishes to original subject", async () => {
    const dl = createDeadLetterEnvelope(sampleEnvelope, {
      original_subject: "local.metafactory.tasks.code-review.typescript",
      originating_consumer: "code-review-workers",
      delivery_count: 3,
      nak_chain: ["cant-do"],
      final_nak_reason: "cant-do",
    });
    const { publisher, published } = fakePublisher();
    await republishDeadLetter(dl, publisher);
    expect(published).toHaveLength(1);
    expect(published[0]!.subject).toBe("local.metafactory.tasks.code-review.typescript");
    expect(published[0]!.input.extensions).toBeUndefined();
  });

  it("preserves correlation_id by default", async () => {
    const dl = createDeadLetterEnvelope(sampleEnvelope, {
      original_subject: "local.metafactory.tasks.code-review.typescript",
      originating_consumer: "x",
      delivery_count: 3,
      nak_chain: [],
      final_nak_reason: "cant-do",
    });
    const { publisher, published } = fakePublisher();
    await republishDeadLetter(dl, publisher);
    expect(published[0]!.input.correlation_id).toBe(sampleEnvelope.correlation_id);
  });

  it("subjectOverride routes elsewhere", async () => {
    const dl = createDeadLetterEnvelope(sampleEnvelope, {
      original_subject: "local.metafactory.tasks.code-review.typescript",
      originating_consumer: "x",
      delivery_count: 3,
      nak_chain: [],
      final_nak_reason: "cant-do",
    });
    const { publisher, published } = fakePublisher();
    await republishDeadLetter(dl, publisher, { subjectOverride: "local.metafactory.tasks.code-review.python" });
    expect(published[0]!.subject).toBe("local.metafactory.tasks.code-review.python");
  });

  it("preserves non-dead_letter extensions across republish", async () => {
    const env: MyelinEnvelope = { ...sampleEnvelope, extensions: { trace_id: "abc" } };
    const dl = createDeadLetterEnvelope(env, {
      original_subject: "local.metafactory.tasks.code-review.typescript",
      originating_consumer: "x",
      delivery_count: 3,
      nak_chain: [],
      final_nak_reason: "cant-do",
    });
    const { publisher, published } = fakePublisher();
    await republishDeadLetter(dl, publisher);
    expect(published[0]!.input.extensions).toEqual({ trace_id: "abc" });
  });

  it("throws on non-dead-letter envelope", async () => {
    const { publisher } = fakePublisher();
    await expect(republishDeadLetter(sampleEnvelope, publisher)).rejects.toThrow(/no extensions.dead_letter/);
  });
});

describe("NakChainTracker", () => {
  it("records and returns chain per (correlation_id, consumer)", () => {
    const t = new NakChainTracker();
    t.record("c1", "consumer-a", "cant-do");
    t.record("c1", "consumer-a", "wont-do");
    expect(t.get("c1", "consumer-a")).toEqual(["cant-do", "wont-do"]);
  });

  it("isolates chains across consumers", () => {
    const t = new NakChainTracker();
    t.record("c1", "consumer-a", "cant-do");
    t.record("c1", "consumer-b", "wont-do");
    expect(t.get("c1", "consumer-a")).toEqual(["cant-do"]);
    expect(t.get("c1", "consumer-b")).toEqual(["wont-do"]);
  });

  it("evict drops chain", () => {
    const t = new NakChainTracker();
    t.record("c1", "consumer-a", "cant-do");
    t.evict("c1", "consumer-a");
    expect(t.get("c1", "consumer-a")).toEqual([]);
    expect(t.size()).toBe(0);
  });

  it("returns defensive copy from get (caller can't mutate state)", () => {
    const t = new NakChainTracker();
    t.record("c1", "x", "cant-do");
    const got = t.get("c1", "x");
    got.push("wont-do");
    expect(t.get("c1", "x")).toEqual(["cant-do"]);
  });

  it("TTL sweep evicts entries older than ttlMs (no orphan leak)", async () => {
    const t = new NakChainTracker({ ttlMs: 50 });
    t.record("orphan", "x", "cant-do");
    expect(t.size()).toBe(1);
    // Wait past TTL, then trigger sweep via record() on a different key.
    await new Promise(r => setTimeout(r, 80));
    t.record("fresh", "x", "cant-do");
    expect(t.size()).toBe(1); // orphan reaped, fresh remains
    expect(t.get("orphan", "x")).toEqual([]);
    expect(t.get("fresh", "x")).toEqual(["cant-do"]);
  });

  it("record() on existing key refreshes lastTouchedAt (kept across sweep)", async () => {
    const t = new NakChainTracker({ ttlMs: 50 });
    t.record("c1", "x", "cant-do");
    await new Promise(r => setTimeout(r, 30));
    t.record("c1", "x", "wont-do"); // refresh
    await new Promise(r => setTimeout(r, 30));
    // Total elapsed since first record: ~60ms (>TTL), but the refresh at
    // 30ms reset the clock — entry should still be present.
    t._sweepForTest();
    expect(t.get("c1", "x")).toEqual(["cant-do", "wont-do"]);
  });
});

describe("DeadLetterHandler", () => {
  function makeHandler(extra?: { onDeadLetter?: (env: DeadLetterEnvelope) => void | Promise<void>; maxDeliver?: number }) {
    const { publisher, published } = fakePublisher();
    let onEvent: ((event: any) => Promise<void>) | null = null;
    const subscription: Subscription = { unsubscribe: async () => {} };
    const subscribeRejections = async (_subject: string, h: (event: any) => Promise<void>) => {
      onEvent = h;
      return subscription;
    };
    const handler = new DeadLetterHandler({
      org: "metafactory",
      publisher,
      subscribeRejections,
      onDeadLetter: extra?.onDeadLetter,
      maxDeliver: extra?.maxDeliver,
    });
    return { handler, published, fire: (e: any) => onEvent!(e) };
  }

  function rejectionEvent(reason: string, attempt: number): any {
    return {
      task_id: sampleEnvelope.id,
      correlation_id: sampleEnvelope.correlation_id,
      agent_principal: "did:mf:luna",
      reason,
      timestamp: new Date().toISOString(),
      delivery_count: attempt,
      originating_consumer: "code-review-workers",
      original_subject: "local.metafactory.tasks.code-review.typescript",
      original_envelope: sampleEnvelope,
    };
  }

  it("compliance-block routes immediately (fast path)", async () => {
    const { handler, published, fire } = makeHandler();
    await handler.start();
    await fire(rejectionEvent("compliance-block", 1));

    const dlPublishes = published.filter(p => p.subject?.includes("dead-letter"));
    expect(dlPublishes).toHaveLength(1);
    expect(dlPublishes[0]!.subject).toBe("local.metafactory.tasks.dead-letter.code-review");
    const ext = dlPublishes[0]!.input.extensions as any;
    expect(ext.dead_letter.route_trigger).toBe("compliance-block");
    expect(ext.dead_letter.final_nak_reason).toBe("compliance-block");
    await handler.stop();
  });

  it("exhaustion path: 3 cant-do rejections route to dead-letter", async () => {
    const { handler, published, fire } = makeHandler({ maxDeliver: 3 });
    await handler.start();
    await fire(rejectionEvent("cant-do", 1));
    await fire(rejectionEvent("cant-do", 2));
    expect(published.filter(p => p.subject?.includes("dead-letter"))).toHaveLength(0);
    await fire(rejectionEvent("cant-do", 3));

    const dlPublishes = published.filter(p => p.subject?.includes("dead-letter"));
    expect(dlPublishes).toHaveLength(1);
    const ext = dlPublishes[0]!.input.extensions as any;
    expect(ext.dead_letter.nak_chain).toEqual(["cant-do", "cant-do", "cant-do"]);
    expect(ext.dead_letter.route_trigger).toBe("exhaustion");
    await handler.stop();
  });

  it("not-now does NOT count toward exhaustion (per F-022 contract)", async () => {
    const { handler, published, fire } = makeHandler({ maxDeliver: 3 });
    await handler.start();
    for (let i = 0; i < 10; i++) await fire(rejectionEvent("not-now", i + 1));
    expect(published.filter(p => p.subject?.includes("dead-letter"))).toHaveLength(0);
    await handler.stop();
  });

  it("emits dispatch.task.failed lifecycle event on dead-letter", async () => {
    const { handler, published, fire } = makeHandler();
    await handler.start();
    await fire(rejectionEvent("compliance-block", 1));

    const failedEvents = published.filter(p => p.subject === "local.metafactory.dispatch.task.failed");
    expect(failedEvents).toHaveLength(1);
    const payload = failedEvents[0]!.input.payload as any;
    expect(payload.final_reason).toBe("compliance-block");
    expect(payload.dead_letter_subject).toBe("local.metafactory.tasks.dead-letter.code-review");
    await handler.stop();
  });

  it("invokes onDeadLetter callback after publishing", async () => {
    const seen: DeadLetterEnvelope[] = [];
    const { handler, fire } = makeHandler({
      onDeadLetter: (env) => {
        seen.push(env);
      },
    });
    await handler.start();
    await fire(rejectionEvent("compliance-block", 1));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.extensions.dead_letter.route_trigger).toBe("compliance-block");
    await handler.stop();
  });

  it("evicts chain after dead-letter (memory hygiene)", async () => {
    const { handler, fire } = makeHandler({ maxDeliver: 3 });
    await handler.start();
    await fire(rejectionEvent("cant-do", 1));
    await fire(rejectionEvent("cant-do", 2));
    await fire(rejectionEvent("cant-do", 3));
    expect(handler.trackerSize()).toBe(0);
    await handler.stop();
  });

  it("logs and skips when rejection event missing original_envelope", async () => {
    const { handler, published, fire } = makeHandler();
    await handler.start();
    const event = rejectionEvent("compliance-block", 1);
    delete event.original_envelope;
    await fire(event);
    expect(published.filter(p => p.subject?.includes("dead-letter"))).toHaveLength(0);
    await handler.stop();
  });

  it("start() throws if called twice", async () => {
    const { handler } = makeHandler();
    await handler.start();
    await expect(handler.start()).rejects.toThrow(/already started/);
    await handler.stop();
  });
});
