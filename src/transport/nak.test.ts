import { describe, it, expect } from "bun:test";
import {
  nakWithReason,
  nakWithReasonSync,
  NAK_BACKOFF,
  NAK_REASON_HEADER,
  NAK_DESCRIPTION_HEADER,
  type NakableMessage,
  type TaskRejectedEvent,
} from "./nak";
import type { EnvelopePublisher, EnvelopePublishInput } from "./types";
import type { MyelinEnvelope } from "../types";

interface FakeHeaders {
  appended: [string, string][];
  append(key: string, value: string): void;
}

function createFakeHeaders(): FakeHeaders {
  const h = {
    appended: [] as [string, string][],
    append(key: string, value: string) {
      h.appended.push([key, value]);
    },
  };
  return h;
}

function createFakeMsg(streamSequence: number | bigint, deliveryCount = 1): { msg: NakableMessage; nakCalls: (number | undefined)[]; headers: FakeHeaders } {
  const headers = createFakeHeaders();
  const nakCalls: (number | undefined)[] = [];
  const msg: NakableMessage = {
    nak(delayNs?: number) {
      nakCalls.push(delayNs);
    },
    headers,
    info: { streamSequence, deliveryCount },
  };
  return { msg, nakCalls, headers };
}

function createFakeMsgNoHeaders(deliveryCount = 1): { msg: NakableMessage; nakCalls: (number | undefined)[] } {
  const nakCalls: (number | undefined)[] = [];
  const msg: NakableMessage = {
    nak(delayNs?: number) {
      nakCalls.push(delayNs);
    },
    headers: null,
    info: { streamSequence: 999, deliveryCount },
  };
  return { msg, nakCalls };
}

function ns(ms: number): number {
  return Number(BigInt(ms) * 1_000_000n);
}

describe("nakWithReasonSync — reason header + delay behavior", () => {
  it("cant-do calls nak() with no delay", () => {
    const { msg, nakCalls, headers } = createFakeMsg(1);
    nakWithReasonSync(msg, { reason: "cant-do" });
    expect(nakCalls).toEqual([undefined]);
    expect(headers.appended).toContainEqual([NAK_REASON_HEADER, "cant-do"]);
  });

  it("wont-do calls nak() with no delay", () => {
    const { msg, nakCalls } = createFakeMsg(2);
    nakWithReasonSync(msg, { reason: "wont-do" });
    expect(nakCalls).toEqual([undefined]);
  });

  it("compliance-block calls nak() with no delay", () => {
    const { msg, nakCalls } = createFakeMsg(3);
    nakWithReasonSync(msg, { reason: "compliance-block" });
    expect(nakCalls).toEqual([undefined]);
  });

  it("not-now first delivery uses initial delay (1s)", () => {
    const { msg, nakCalls } = createFakeMsg(4, 1);
    nakWithReasonSync(msg, { reason: "not-now" });
    expect(nakCalls).toEqual([ns(1000)]);
  });

  it("not-now exponential backoff derived from deliveryCount: 1s, 2s, 4s, 8s, 16s, 32s, 60s (cap)", () => {
    const cases: [number, number][] = [
      [1, 1000], [2, 2000], [3, 4000], [4, 8000], [5, 16000], [6, 32000], [7, 60000], [10, 60000],
    ];
    for (const [delivery, expectMs] of cases) {
      const { msg, nakCalls } = createFakeMsg(5, delivery);
      nakWithReasonSync(msg, { reason: "not-now" });
      expect(nakCalls[0]).toBe(ns(expectMs));
    }
  });

  it("not-now caps at 60s for arbitrarily large deliveryCount (no overflow)", () => {
    const { msg, nakCalls } = createFakeMsg(6, 1_000_000);
    nakWithReasonSync(msg, { reason: "not-now" });
    expect(nakCalls[0]).toBe(ns(NAK_BACKOFF.maxDelayMs));
  });

  it("not-now treats deliveryCount=0 as initial delay (boundary guard)", () => {
    const { msg, nakCalls } = createFakeMsg(99, 0);
    nakWithReasonSync(msg, { reason: "not-now" });
    expect(nakCalls[0]).toBe(ns(1000));
  });

  it("not-now defaults deliveryCount=1 when info absent (initial delay)", () => {
    const nakCalls: (number | undefined)[] = [];
    const msg: NakableMessage = {
      nak(d?: number) { nakCalls.push(d); },
      headers: createFakeHeaders(),
    };
    nakWithReasonSync(msg, { reason: "not-now" });
    expect(nakCalls[0]).toBe(ns(1000));
  });

  it("backoff is stateless — different sequences with same deliveryCount get same delay", () => {
    const a = createFakeMsg(100, 3);
    const b = createFakeMsg(200, 3);
    nakWithReasonSync(a.msg, { reason: "not-now" });
    nakWithReasonSync(b.msg, { reason: "not-now" });
    expect(a.nakCalls[0]).toBe(ns(4000));
    expect(b.nakCalls[0]).toBe(ns(4000));
  });

  it("works with BigInt streamSequence (JetStream provides BigInt for large streams)", () => {
    const { msg, nakCalls } = createFakeMsg(BigInt("12345678901234567890"), 2);
    nakWithReasonSync(msg, { reason: "not-now" });
    expect(nakCalls[0]).toBe(ns(2000));
  });

  it("works when headers are null (no header-write attempted)", () => {
    const { msg, nakCalls } = createFakeMsgNoHeaders(2);
    nakWithReasonSync(msg, { reason: "not-now", description: "ignored" });
    expect(nakCalls[0]).toBe(ns(2000));
  });

  it("works when headers are undefined", () => {
    const nakCalls: (number | undefined)[] = [];
    const msg: NakableMessage = {
      nak(d?: number) { nakCalls.push(d); },
      info: { streamSequence: 999, deliveryCount: 1 },
    };
    nakWithReasonSync(msg, { reason: "cant-do" });
    expect(nakCalls).toEqual([undefined]);
  });

  it("includes description header when provided", () => {
    const { msg, headers } = createFakeMsg(7);
    nakWithReasonSync(msg, { reason: "compliance-block", description: "tool not on Approved Register" });
    expect(headers.appended).toContainEqual([NAK_DESCRIPTION_HEADER, "tool not on Approved Register"]);
  });

  it("omits description header when absent", () => {
    const { msg, headers } = createFakeMsg(8);
    nakWithReasonSync(msg, { reason: "cant-do" });
    expect(headers.appended.find(([k]) => k === NAK_DESCRIPTION_HEADER)).toBeUndefined();
  });
});

describe("nakWithReason — async with lifecycle event", () => {
  function fakePublisher(): { publisher: EnvelopePublisher; published: { input: EnvelopePublishInput; subject?: string }[] } {
    const published: { input: EnvelopePublishInput; subject?: string }[] = [];
    return {
      published,
      publisher: {
        async publish(input: EnvelopePublishInput, subject?: string) {
          published.push({ input, subject });
        },
        async request(): Promise<MyelinEnvelope> { throw new Error("not implemented"); },
        async close() {},
      },
    };
  }

  const sampleEnvelope: MyelinEnvelope = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    source: "metafactory.cortex.dispatch",
    type: "tasks.code-review",
    timestamp: "2026-05-09T20:00:00Z",
    correlation_id: "770e8400-e29b-41d4-a716-446655440009",
    sovereignty: { classification: "local", data_residency: "CH", max_hop: 0, frontier_ok: false, model_class: "any" },
    payload: {},
  };

  it("publishes lifecycle event when publisher provided", async () => {
    const { publisher, published } = fakePublisher();
    const { msg } = createFakeMsg(10);
    await nakWithReason(
      { msg, envelope: sampleEnvelope, agentPrincipal: "did:mf:luna", publisher, org: "metafactory" },
      { reason: "compliance-block", description: "egress denied" },
    );
    expect(published).toHaveLength(1);
    expect(published[0].subject).toBe("local.metafactory.dispatch.task.rejected");
    const event = published[0].input.payload as unknown as TaskRejectedEvent;
    expect(event.reason).toBe("compliance-block");
    expect(event.description).toBe("egress denied");
    expect(event.correlation_id).toBe("770e8400-e29b-41d4-a716-446655440009");
    expect(event.identity).toBe("did:mf:luna");
  });

  it("uses envelope.id as correlation_id when correlation_id absent", async () => {
    const { publisher, published } = fakePublisher();
    const { msg } = createFakeMsg(11);
    const noCorr: MyelinEnvelope = { ...sampleEnvelope, correlation_id: undefined };
    await nakWithReason(
      { msg, envelope: noCorr, agentPrincipal: "did:mf:fern", publisher, org: "metafactory" },
      { reason: "wont-do" },
    );
    const event = published[0].input.payload as unknown as TaskRejectedEvent;
    expect(event.correlation_id).toBe(noCorr.id);
  });

  it("still naks even if publish fails", async () => {
    const failing: EnvelopePublisher = {
      async publish() {
        throw new Error("publisher offline");
      },
      async request(): Promise<MyelinEnvelope> { throw new Error("not implemented"); },
      async close() {},
    };
    const { msg, nakCalls } = createFakeMsg(12);
    await nakWithReason(
      { msg, envelope: sampleEnvelope, agentPrincipal: "did:mf:luna", publisher: failing, org: "metafactory" },
      { reason: "cant-do" },
    );
    expect(nakCalls).toEqual([undefined]);
  });

  it("works without publisher (degrades to sync)", async () => {
    const { msg, nakCalls } = createFakeMsg(13);
    await nakWithReason({ msg }, { reason: "not-now" });
    expect(nakCalls).toEqual([ns(1000)]);
  });

  it("naks even when publisher hangs (timeout race protects nak path)", async () => {
    const hanging: EnvelopePublisher = {
      publish() {
        // Never resolves, never rejects.
        return new Promise<void>(() => {});
      },
      async request(): Promise<MyelinEnvelope> { throw new Error("not implemented"); },
      async close() {},
    };
    const { msg, nakCalls } = createFakeMsg(14, 1);
    const start = Date.now();
    await nakWithReason(
      { msg, envelope: sampleEnvelope, agentPrincipal: "did:mf:luna", publisher: hanging, org: "metafactory" },
      { reason: "cant-do" },
    );
    const elapsed = Date.now() - start;
    // Timeout is 2s; allow CI headroom but cap well below ∞ —
    // the point is the nak doesn't hang on a stalled publisher.
    expect(elapsed).toBeLessThan(5000);
    expect(nakCalls).toEqual([undefined]);
  }, 10_000);
});
