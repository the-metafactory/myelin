import { describe, it, expect, beforeEach } from "bun:test";
import {
  nakWithReason,
  nakWithReasonSync,
  NAK_BACKOFF,
  NAK_REASON_HEADER,
  NAK_DESCRIPTION_HEADER,
  _resetNakBackoffState,
  type NakableMessage,
  type TaskRejectedEvent,
} from "./nak";
import type { EnvelopePublisher, EnvelopePublishInput } from "./types";
import type { MyelinEnvelope } from "../types";

interface FakeHeaders {
  appended: Array<[string, string]>;
  append(key: string, value: string): void;
}

function createFakeHeaders(): FakeHeaders {
  const h = {
    appended: [] as Array<[string, string]>,
    append(key: string, value: string) {
      h.appended.push([key, value]);
    },
  };
  return h;
}

function createFakeMsg(streamSequence: number, deliveryCount = 1): { msg: NakableMessage; nakCalls: Array<number | undefined>; headers: FakeHeaders } {
  const headers = createFakeHeaders();
  const nakCalls: Array<number | undefined> = [];
  const msg: NakableMessage = {
    nak(delayNs?: number) {
      nakCalls.push(delayNs);
    },
    headers,
    info: { streamSequence, deliveryCount },
  };
  return { msg, nakCalls, headers };
}

function ns(ms: number): number {
  return Number(BigInt(ms) * 1_000_000n);
}

describe("nakWithReasonSync — reason header + delay behavior", () => {
  beforeEach(() => _resetNakBackoffState());

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
    const { msg, nakCalls } = createFakeMsg(4);
    nakWithReasonSync(msg, { reason: "not-now" });
    expect(nakCalls).toEqual([ns(1000)]);
  });

  it("not-now exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s, 60s (cap)", () => {
    const sequenceId = 5;
    const expectedDelaysMs = [1000, 2000, 4000, 8000, 16000, 32000, 60000];
    const observed: number[] = [];
    for (let i = 0; i < expectedDelaysMs.length; i++) {
      const { msg, nakCalls } = createFakeMsg(sequenceId);
      nakWithReasonSync(msg, { reason: "not-now" });
      observed.push(nakCalls[0]!);
    }
    expect(observed).toEqual(expectedDelaysMs.map(ns));
  });

  it("not-now caps at 60s no matter how many re-naks", () => {
    const sequenceId = 6;
    // burn through the doubling chain
    for (let i = 0; i < 10; i++) {
      const { msg } = createFakeMsg(sequenceId);
      nakWithReasonSync(msg, { reason: "not-now" });
    }
    const { msg, nakCalls } = createFakeMsg(sequenceId);
    nakWithReasonSync(msg, { reason: "not-now" });
    expect(nakCalls[0]).toBe(ns(NAK_BACKOFF.maxDelayMs));
  });

  it("different sequences maintain independent backoff state", () => {
    const a = createFakeMsg(100);
    const b = createFakeMsg(200);
    nakWithReasonSync(a.msg, { reason: "not-now" });
    nakWithReasonSync(b.msg, { reason: "not-now" });
    expect(a.nakCalls[0]).toBe(ns(1000));
    expect(b.nakCalls[0]).toBe(ns(1000));
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
  beforeEach(() => _resetNakBackoffState());

  function fakePublisher(): { publisher: EnvelopePublisher; published: Array<{ input: EnvelopePublishInput; subject?: string }> } {
    const published: Array<{ input: EnvelopePublishInput; subject?: string }> = [];
    return {
      published,
      publisher: {
        async publish(input: EnvelopePublishInput, subject?: string) {
          published.push({ input, subject });
        },
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
    expect(published[0]!.subject).toBe("local.metafactory.dispatch.task.rejected");
    const event = published[0]!.input.payload as unknown as TaskRejectedEvent;
    expect(event.reason).toBe("compliance-block");
    expect(event.description).toBe("egress denied");
    expect(event.correlation_id).toBe("770e8400-e29b-41d4-a716-446655440009");
    expect(event.agent_principal).toBe("did:mf:luna");
  });

  it("uses envelope.id as correlation_id when correlation_id absent", async () => {
    const { publisher, published } = fakePublisher();
    const { msg } = createFakeMsg(11);
    const noCorr: MyelinEnvelope = { ...sampleEnvelope, correlation_id: undefined };
    await nakWithReason(
      { msg, envelope: noCorr, agentPrincipal: "did:mf:fern", publisher, org: "metafactory" },
      { reason: "wont-do" },
    );
    const event = published[0]!.input.payload as unknown as TaskRejectedEvent;
    expect(event.correlation_id).toBe(noCorr.id);
  });

  it("still naks even if publish fails", async () => {
    const failing: EnvelopePublisher = {
      async publish() {
        throw new Error("publisher offline");
      },
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
});
