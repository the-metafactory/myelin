import { describe, it, expect } from "bun:test";
import { utils, getPublicKeyAsync } from "@noble/ed25519";
import {
  createBiddingPublisher,
  type PublishFn,
  type PublishedEvent,
} from "./publisher";
import { signBidResponse } from "./response";
import { createBidRequest } from "./request";
import type { BidResponse } from "./types";
import type { BidSource } from "./collector";
import { createInMemoryRegistry } from "../identity/registry";
import type { SigningIdentity } from "../identity/types";
import type { Sovereignty } from "../types";

const sovereignty: Sovereignty = {
  classification: "local",
  data_residency: "CH",
  max_hop: 0,
  frontier_ok: false,
  model_class: "any",
};

function bytesToBase64(b: Uint8Array): string {
  return Buffer.from(b).toString("base64");
}

interface TestPrincipal {
  did: string;
  identity: SigningIdentity;
  publicKey: string;
}

async function makeIdentity(did: string): Promise<TestPrincipal> {
  const priv = utils.randomSecretKey();
  const pub = await getPublicKeyAsync(priv);
  return { did, identity: { did, privateKey: bytesToBase64(priv) }, publicKey: bytesToBase64(pub) };
}

function registerPrincipals(...ps: TestPrincipal[]): ReturnType<typeof createInMemoryRegistry> {
  const registry = createInMemoryRegistry();
  for (const p of ps) {
    registry.add({
      id: p.did,
      operator: "metafactory",
      public_key: p.publicKey,
      type: "agent",
      created_at: "2026-05-11T00:00:00Z",
    });
  }
  return registry;
}

function makeScheduledSource(bids: BidResponse[], schedule: number[]): BidSource {
  return async (handler) => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 0; i < bids.length; i++) {
      const idx = i;
      timers.push(setTimeout(() => void Promise.resolve(handler(bids[idx]!)), schedule[idx]!));
    }
    return {
      async unsubscribe() {
        for (const t of timers) clearTimeout(t);
      },
    };
  };
}

function makeRecordingPublish(): {
  publish: PublishFn;
  calls: { subject: string; envelopeType: string; envelopeId: string }[];
} {
  const calls: { subject: string; envelopeType: string; envelopeId: string }[] = [];
  const publish: PublishFn = async (subject, envelope) => {
    calls.push({ subject, envelopeType: envelope.type, envelopeId: envelope.id });
  };
  return { publish, calls };
}

describe("createBiddingPublisher.runRound", () => {
  it("orchestrates a successful bidding round end-to-end", async () => {
    const luna = await makeIdentity("did:mf:luna");
    const fern = await makeIdentity("did:mf:fern");
    const registry = registerPrincipals(luna, fern);

    const request = createBidRequest({
      task_id: "task-001",
      requirements: ["code-review"],
      bid_timeout_ms: 60,
      selection_strategy: "lowest-load",
      reply_to: "_INBOX.test.task-001",
    });

    const bidLuna = await signBidResponse(
      { task_id: request.task_id, bidder: luna.did, load: 0.7, capability_match: 0.8 },
      luna.identity,
    );
    const bidFern = await signBidResponse(
      { task_id: request.task_id, bidder: fern.did, load: 0.2, capability_match: 0.9 },
      fern.identity,
    );

    const { publish, calls } = makeRecordingPublish();
    const publisher = createBiddingPublisher({
      org: "metafactory",
      source: "metafactory.cortex.dispatch",
      sovereignty,
      publish,
      registry,
    });

    const result = await publisher.runRound({
      capability: "code-review",
      request,
      bidSource: makeScheduledSource([bidLuna, bidFern], [5, 10]),
      payload: { task: "do the thing" },
      correlationId: "corr-1",
    });

    expect(result.winner?.bidder).toBe(fern.did);
    expect(result.bids).toHaveLength(2);
    expect(result.drops).toHaveLength(0);
    expect(result.participants).toBe(2);
    expect(result.selectionReason).toMatch(/lowest-load/);

    // Event ordering: bid-request → bid-opened → 2× bid-received →
    // assignment → bid-closed → bid-assigned.
    const kinds = result.events.map((e) => e.kind);
    expect(kinds).toEqual([
      "bid-request",
      "bid-opened",
      "bid-received",
      "bid-received",
      "assignment",
      "bid-closed",
      "bid-assigned",
    ]);

    // Each emitted event ended up on the wire exactly once.
    expect(calls.map((c) => c.subject)).toEqual(result.events.map((e) => e.subject));
  });

  it("on a no-bids round, emits bid-opened + bid-closed only and returns winner=null", async () => {
    const registry = createInMemoryRegistry();
    const request = createBidRequest({
      task_id: "task-empty",
      requirements: ["scarce-capability"],
      bid_timeout_ms: 25,
      selection_strategy: "lowest-load",
      reply_to: "_INBOX.test.task-empty",
    });

    const { publish, calls } = makeRecordingPublish();
    const publisher = createBiddingPublisher({
      org: "metafactory",
      source: "metafactory.cortex.dispatch",
      sovereignty,
      publish,
      registry,
    });

    const result = await publisher.runRound({
      capability: "scarce-capability",
      request,
      bidSource: makeScheduledSource([], []),
      payload: {},
    });

    expect(result.winner).toBeNull();
    expect(result.bids).toHaveLength(0);
    expect(result.participants).toBe(0);
    expect(result.selectionReason).toBeNull();

    const kinds = result.events.map((e) => e.kind);
    expect(kinds).toEqual(["bid-request", "bid-opened", "bid-closed"]);
    // No assignment subject was published.
    expect(
      calls.filter((c) => c.subject.includes(".tasks.@")).length,
    ).toBe(0);
  });

  it("publishes the assignment to the winner's direct-address subject", async () => {
    const luna = await makeIdentity("did:mf:luna");
    const registry = registerPrincipals(luna);
    const request = createBidRequest({
      task_id: "task-002",
      requirements: ["release"],
      bid_timeout_ms: 40,
      selection_strategy: "lowest-load",
      reply_to: "_INBOX.test.task-002",
    });
    const bidLuna = await signBidResponse(
      { task_id: request.task_id, bidder: luna.did, load: 0.3, capability_match: 0.9 },
      luna.identity,
    );

    const { publish } = makeRecordingPublish();
    const publisher = createBiddingPublisher({
      org: "metafactory",
      source: "metafactory.cortex.dispatch",
      sovereignty,
      publish,
      registry,
    });

    const result = await publisher.runRound({
      capability: "release",
      request,
      bidSource: makeScheduledSource([bidLuna], [5]),
      payload: { release_tag: "v1.2.3" },
    });

    const assignment = result.events.find((e) => e.kind === "assignment");
    expect(assignment).toBeDefined();
    // Direct-address subject encoding: ':' → '-', '.' → '--' (from subjects.ts).
    expect(assignment!.subject).toBe("local.metafactory.tasks.@did-mf-luna.release");
    expect(assignment!.envelope.payload).toMatchObject({
      task_id: "task-002",
      winner: luna.did,
      payload: { release_tag: "v1.2.3" },
      bid_round: { participants: 1 },
    });
  });

  it("propagates correlation_id to every published envelope", async () => {
    const luna = await makeIdentity("did:mf:luna");
    const registry = registerPrincipals(luna);
    const request = createBidRequest({
      task_id: "task-003",
      requirements: ["deploy"],
      bid_timeout_ms: 40,
      selection_strategy: "lowest-load",
      reply_to: "_INBOX.test.task-003",
    });
    const bidLuna = await signBidResponse(
      { task_id: request.task_id, bidder: luna.did, load: 0.5, capability_match: 0.8 },
      luna.identity,
    );

    const { publish } = makeRecordingPublish();
    const publisher = createBiddingPublisher({
      org: "metafactory",
      source: "metafactory.cortex.dispatch",
      sovereignty,
      publish,
      registry,
    });

    const result = await publisher.runRound({
      capability: "deploy",
      request,
      bidSource: makeScheduledSource([bidLuna], [5]),
      payload: {},
      correlationId: "trace-abc-123",
    });

    for (const event of result.events) {
      expect(event.envelope.correlation_id).toBe("trace-abc-123");
    }
  });

  it("emits exactly one bid-received per accepted bid (dropped bids do not produce events)", async () => {
    const luna = await makeIdentity("did:mf:luna");
    const stranger = await makeIdentity("did:mf:stranger");
    const registry = registerPrincipals(luna); // stranger NOT registered

    const request = createBidRequest({
      task_id: "task-004",
      requirements: ["code-review"],
      bid_timeout_ms: 40,
      selection_strategy: "lowest-load",
      reply_to: "_INBOX.test.task-004",
    });

    const bidLuna = await signBidResponse(
      { task_id: request.task_id, bidder: luna.did, load: 0.3, capability_match: 0.9 },
      luna.identity,
    );
    const bidStranger = await signBidResponse(
      { task_id: request.task_id, bidder: stranger.did, load: 0.1, capability_match: 0.9 },
      stranger.identity,
    );

    const { publish } = makeRecordingPublish();
    const publisher = createBiddingPublisher({
      org: "metafactory",
      source: "metafactory.cortex.dispatch",
      sovereignty,
      publish,
      registry,
    });

    const result = await publisher.runRound({
      capability: "code-review",
      request,
      bidSource: makeScheduledSource([bidLuna, bidStranger], [5, 10]),
      payload: {},
    });

    expect(result.bids).toHaveLength(1);
    expect(result.drops).toHaveLength(1);
    expect(result.drops[0]!.bidder).toBe(stranger.did);

    const received = result.events.filter((e) => e.kind === "bid-received");
    expect(received).toHaveLength(1);
  });

  it("subjects: bid-request goes to tasks.bid-request.{capability}; lifecycle under dispatch.bid.>", async () => {
    const luna = await makeIdentity("did:mf:luna");
    const registry = registerPrincipals(luna);
    const request = createBidRequest({
      task_id: "task-005",
      requirements: ["code-review"],
      bid_timeout_ms: 30,
      reply_to: "_INBOX.test.task-005",
    });
    const bidLuna = await signBidResponse(
      { task_id: request.task_id, bidder: luna.did, load: 0.3, capability_match: 0.9 },
      luna.identity,
    );

    const { publish } = makeRecordingPublish();
    const publisher = createBiddingPublisher({
      org: "metafactory",
      source: "metafactory.cortex.dispatch",
      sovereignty,
      publish,
      registry,
    });

    const result = await publisher.runRound({
      capability: "code-review",
      request,
      bidSource: makeScheduledSource([bidLuna], [5]),
      payload: {},
    });

    const byKind = (k: PublishedEvent["kind"]): PublishedEvent | undefined =>
      result.events.find((e) => e.kind === k);
    expect(byKind("bid-request")!.subject).toBe("local.metafactory.tasks.bid-request.code-review");
    expect(byKind("bid-opened")!.subject).toBe("local.metafactory.dispatch.bid.bid-opened");
    expect(byKind("bid-received")!.subject).toBe("local.metafactory.dispatch.bid.bid-received");
    expect(byKind("bid-closed")!.subject).toBe("local.metafactory.dispatch.bid.bid-closed");
    expect(byKind("bid-assigned")!.subject).toBe("local.metafactory.dispatch.bid.bid-assigned");
  });

  it("includes selection_reason on bid-assigned payload", async () => {
    const luna = await makeIdentity("did:mf:luna");
    const registry = registerPrincipals(luna);
    const request = createBidRequest({
      task_id: "task-006",
      requirements: ["work"],
      bid_timeout_ms: 30,
      selection_strategy: "highest-match",
      reply_to: "_INBOX.test.task-006",
    });
    const bidLuna = await signBidResponse(
      { task_id: request.task_id, bidder: luna.did, load: 0.5, capability_match: 0.85 },
      luna.identity,
    );

    const { publish } = makeRecordingPublish();
    const publisher = createBiddingPublisher({
      org: "metafactory",
      source: "metafactory.cortex.dispatch",
      sovereignty,
      publish,
      registry,
    });

    const result = await publisher.runRound({
      capability: "work",
      request,
      bidSource: makeScheduledSource([bidLuna], [5]),
      payload: {},
    });

    const assigned = result.events.find((e) => e.kind === "bid-assigned")!;
    expect(assigned.envelope.payload.selection_reason).toMatch(/highest-match/);
    expect(assigned.envelope.payload.winner).toBe(luna.did);
  });

  it("aborts collection early when AbortSignal fires", async () => {
    const luna = await makeIdentity("did:mf:luna");
    const registry = registerPrincipals(luna);
    const request = createBidRequest({
      task_id: "task-abort",
      requirements: ["code-review"],
      bid_timeout_ms: 5_000, // would block 5s without abort
      reply_to: "_INBOX.test.task-abort",
    });
    const bidLuna = await signBidResponse(
      { task_id: request.task_id, bidder: luna.did, load: 0.3, capability_match: 0.9 },
      luna.identity,
    );

    const { publish } = makeRecordingPublish();
    const publisher = createBiddingPublisher({
      org: "metafactory",
      source: "metafactory.cortex.dispatch",
      sovereignty,
      publish,
      registry,
    });

    const ac = new AbortController();
    setTimeout(() => ac.abort(), 30);
    const start = Date.now();
    const result = await publisher.runRound({
      capability: "code-review",
      request,
      bidSource: makeScheduledSource([bidLuna], [5]),
      payload: {},
      signal: ac.signal,
    });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(500);
    expect(result.winner?.bidder).toBe(luna.did);
  });

  it("publish errors propagate to the caller (no swallowing of transport faults)", async () => {
    const luna = await makeIdentity("did:mf:luna");
    const registry = registerPrincipals(luna);
    const request = createBidRequest({
      task_id: "task-err",
      requirements: ["code-review"],
      bid_timeout_ms: 30,
      reply_to: "_INBOX.test.task-err",
    });

    const failingPublish: PublishFn = async () => {
      throw new Error("transport down");
    };
    const publisher = createBiddingPublisher({
      org: "metafactory",
      source: "metafactory.cortex.dispatch",
      sovereignty,
      publish: failingPublish,
      registry,
    });

    await expect(
      publisher.runRound({
        capability: "code-review",
        request,
        bidSource: makeScheduledSource([], []),
        payload: {},
      }),
    ).rejects.toThrow(/transport down/);
  });

  it("defensively copies the assignment payload (caller mutation does not leak into the wire envelope)", async () => {
    const luna = await makeIdentity("did:mf:luna");
    const registry = registerPrincipals(luna);
    const request = createBidRequest({
      task_id: "task-copy",
      requirements: ["code-review"],
      bid_timeout_ms: 30,
      reply_to: "_INBOX.test.task-copy",
    });
    const bidLuna = await signBidResponse(
      { task_id: request.task_id, bidder: luna.did, load: 0.3, capability_match: 0.9 },
      luna.identity,
    );

    const { publish } = makeRecordingPublish();
    const publisher = createBiddingPublisher({
      org: "metafactory",
      source: "metafactory.cortex.dispatch",
      sovereignty,
      publish,
      registry,
    });

    const payload: Record<string, unknown> = { value: "initial" };
    const promise = publisher.runRound({
      capability: "code-review",
      request,
      bidSource: makeScheduledSource([bidLuna], [5]),
      payload,
    });
    payload.value = "mutated-after-call";
    const result = await promise;

    const assignment = result.events.find((e) => e.kind === "assignment")!;
    expect((assignment.envelope.payload as { payload: { value: string } }).payload.value).toBe(
      "initial",
    );
  });

  it("subscribe-then-publish: bid-request emitted AFTER bidSource subscribed", async () => {
    const luna = await makeIdentity("did:mf:luna");
    const registry = registerPrincipals(luna);
    const request = createBidRequest({
      task_id: "task-order",
      requirements: ["code-review"],
      bid_timeout_ms: 30,
      reply_to: "_INBOX.test.task-order",
    });
    const bidLuna = await signBidResponse(
      { task_id: request.task_id, bidder: luna.did, load: 0.3, capability_match: 0.9 },
      luna.identity,
    );

    const order: string[] = [];
    // BidSource wrapper that records when subscribe completes, so the
    // test can assert it ordered before any publish call.
    const trackedSource: BidSource = async (handler) => {
      order.push("subscribed");
      setTimeout(() => void handler(bidLuna), 5);
      return {
        async unsubscribe() {
          order.push("unsubscribed");
        },
      };
    };

    const publish: PublishFn = async (subject) => {
      // Only record the bid-request subject; lifecycle + assignment
      // subjects are noise for this ordering assertion.
      if (subject.includes(".tasks.bid-request.")) {
        order.push("publish:bid-request");
      }
    };

    const publisher = createBiddingPublisher({
      org: "metafactory",
      source: "metafactory.cortex.dispatch",
      sovereignty,
      publish,
      registry,
    });

    await publisher.runRound({
      capability: "code-review",
      request,
      bidSource: trackedSource,
      payload: {},
    });

    const subIdx = order.indexOf("subscribed");
    const pubIdx = order.indexOf("publish:bid-request");
    expect(subIdx).toBeGreaterThanOrEqual(0);
    expect(pubIdx).toBeGreaterThanOrEqual(0);
    expect(subIdx).toBeLessThan(pubIdx);
  });

  it("when winnerAck is omitted: first winner kept (legacy behavior; retryCount=0)", async () => {
    const luna = await makeIdentity("did:mf:luna");
    const fern = await makeIdentity("did:mf:fern");
    const registry = registerPrincipals(luna, fern);

    const request = createBidRequest({
      task_id: "task-noack",
      requirements: ["code-review"],
      bid_timeout_ms: 50,
      reply_to: "_INBOX.test.task-noack",
    });
    const bidLuna = await signBidResponse(
      { task_id: request.task_id, bidder: luna.did, load: 0.5, capability_match: 0.9 },
      luna.identity,
    );
    const bidFern = await signBidResponse(
      { task_id: request.task_id, bidder: fern.did, load: 0.2, capability_match: 0.9 },
      fern.identity,
    );

    const { publish } = makeRecordingPublish();
    const publisher = createBiddingPublisher({
      org: "metafactory",
      source: "metafactory.cortex.dispatch",
      sovereignty,
      publish,
      registry,
    });
    const result = await publisher.runRound({
      capability: "code-review",
      request,
      bidSource: makeScheduledSource([bidLuna, bidFern], [5, 10]),
      payload: {},
    });

    expect(result.winner?.bidder).toBe(fern.did);
    expect(result.retryCount).toBe(0);
    expect(result.nakedWinners).toEqual([]);
    expect(result.events.some((e) => e.kind === "bid-retry")).toBe(false);
  });

  it("winnerAck returns nak once then ack: second-best wins, bid-retry emitted", async () => {
    const luna = await makeIdentity("did:mf:luna");
    const fern = await makeIdentity("did:mf:fern");
    const registry = registerPrincipals(luna, fern);

    const request = createBidRequest({
      task_id: "task-nak1",
      requirements: ["code-review"],
      bid_timeout_ms: 50,
      reply_to: "_INBOX.test.task-nak1",
    });
    const bidLuna = await signBidResponse(
      { task_id: request.task_id, bidder: luna.did, load: 0.5, capability_match: 0.9 },
      luna.identity,
    );
    const bidFern = await signBidResponse(
      { task_id: request.task_id, bidder: fern.did, load: 0.2, capability_match: 0.9 },
      fern.identity,
    );

    const { publish } = makeRecordingPublish();
    const publisher = createBiddingPublisher({
      org: "metafactory",
      source: "metafactory.cortex.dispatch",
      sovereignty,
      publish,
      registry,
    });

    const acks: ("ack" | "nak")[] = ["nak", "ack"];
    const ackedWinners: string[] = [];
    const result = await publisher.runRound({
      capability: "code-review",
      request,
      bidSource: makeScheduledSource([bidLuna, bidFern], [5, 10]),
      payload: {},
      winnerAck: (winner) => {
        ackedWinners.push(winner.bidder);
        return acks.shift()!;
      },
    });

    expect(result.winner?.bidder).toBe(luna.did); // fern naked → second-best
    expect(result.retryCount).toBe(1);
    expect(result.nakedWinners).toEqual([fern.did]);
    expect(ackedWinners).toEqual([fern.did, luna.did]);

    // Two assignment publishes; one bid-retry.
    expect(result.events.filter((e) => e.kind === "assignment")).toHaveLength(2);
    const retry = result.events.find((e) => e.kind === "bid-retry");
    expect(retry).toBeDefined();
    expect(retry!.envelope.payload).toMatchObject({
      task_id: "task-nak1",
      bidder: fern.did,
      retry_attempt: 1,
    });

    // bid-assigned fires once for the confirmed winner.
    expect(result.events.filter((e) => e.kind === "bid-assigned")).toHaveLength(1);
    const assigned = result.events.find((e) => e.kind === "bid-assigned");
    expect(assigned!.envelope.payload.winner).toBe(luna.did);
  });

  it("all candidates nak: winner=null, no bid-assigned, bid-closed still fires", async () => {
    const luna = await makeIdentity("did:mf:luna");
    const fern = await makeIdentity("did:mf:fern");
    const registry = registerPrincipals(luna, fern);

    const request = createBidRequest({
      task_id: "task-allnak",
      requirements: ["code-review"],
      bid_timeout_ms: 50,
      reply_to: "_INBOX.test.task-allnak",
    });
    const bidLuna = await signBidResponse(
      { task_id: request.task_id, bidder: luna.did, load: 0.5, capability_match: 0.9 },
      luna.identity,
    );
    const bidFern = await signBidResponse(
      { task_id: request.task_id, bidder: fern.did, load: 0.2, capability_match: 0.9 },
      fern.identity,
    );

    const { publish } = makeRecordingPublish();
    const publisher = createBiddingPublisher({
      org: "metafactory",
      source: "metafactory.cortex.dispatch",
      sovereignty,
      publish,
      registry,
    });

    const result = await publisher.runRound({
      capability: "code-review",
      request,
      bidSource: makeScheduledSource([bidLuna, bidFern], [5, 10]),
      payload: {},
      winnerAck: () => "nak",
    });

    expect(result.winner).toBeNull();
    expect(result.selectionReason).toBeNull();
    // The pool exhausts before maxRetries fires: 2 bidders, both nak,
    // first nak excludes one and re-selects, second nak excludes the
    // last → outcome=null. So nakedWinners has exactly 2 entries.
    expect(result.nakedWinners).toHaveLength(2);
    expect(result.events.some((e) => e.kind === "bid-assigned")).toBe(false);
    expect(result.events.some((e) => e.kind === "bid-closed")).toBe(true);
  });

  it("abort during retry loop halts further assignment publishes", async () => {
    const luna = await makeIdentity("did:mf:luna");
    const fern = await makeIdentity("did:mf:fern");
    const registry = registerPrincipals(luna, fern);

    const request = createBidRequest({
      task_id: "task-abort-retry",
      requirements: ["code-review"],
      bid_timeout_ms: 30,
      reply_to: "_INBOX.test.task-abort-retry",
    });
    const bidLuna = await signBidResponse(
      { task_id: request.task_id, bidder: luna.did, load: 0.5, capability_match: 0.9 },
      luna.identity,
    );
    const bidFern = await signBidResponse(
      { task_id: request.task_id, bidder: fern.did, load: 0.2, capability_match: 0.9 },
      fern.identity,
    );

    const { publish } = makeRecordingPublish();
    const publisher = createBiddingPublisher({
      org: "metafactory",
      source: "metafactory.cortex.dispatch",
      sovereignty,
      publish,
      registry,
    });

    const ac = new AbortController();
    let acks = 0;
    const result = await publisher.runRound({
      capability: "code-review",
      request,
      bidSource: makeScheduledSource([bidLuna, bidFern], [5, 10]),
      payload: {},
      signal: ac.signal,
      winnerAck: () => {
        acks += 1;
        if (acks === 1) ac.abort();
        return "nak";
      },
    });

    // First winner naked → signal aborted → loop exits before any
    // second assignment. Exactly one assignment publish; one bid-retry
    // for the nak; no bid-assigned.
    expect(acks).toBe(1);
    expect(result.events.filter((e) => e.kind === "assignment")).toHaveLength(1);
    expect(result.events.filter((e) => e.kind === "bid-retry")).toHaveLength(1);
    expect(result.events.some((e) => e.kind === "bid-assigned")).toBe(false);
    expect(result.winner).toBeNull();
  });

  it("maxRetries=0 + nak: no retry attempted, winner=null", async () => {
    const luna = await makeIdentity("did:mf:luna");
    const fern = await makeIdentity("did:mf:fern");
    const registry = registerPrincipals(luna, fern);

    const request = createBidRequest({
      task_id: "task-noretry",
      requirements: ["code-review"],
      bid_timeout_ms: 50,
      reply_to: "_INBOX.test.task-noretry",
    });
    const bidLuna = await signBidResponse(
      { task_id: request.task_id, bidder: luna.did, load: 0.5, capability_match: 0.9 },
      luna.identity,
    );
    const bidFern = await signBidResponse(
      { task_id: request.task_id, bidder: fern.did, load: 0.2, capability_match: 0.9 },
      fern.identity,
    );

    const { publish } = makeRecordingPublish();
    const publisher = createBiddingPublisher({
      org: "metafactory",
      source: "metafactory.cortex.dispatch",
      sovereignty,
      publish,
      registry,
    });

    const ackCalls: string[] = [];
    const result = await publisher.runRound({
      capability: "code-review",
      request,
      bidSource: makeScheduledSource([bidLuna, bidFern], [5, 10]),
      payload: {},
      winnerAck: (w) => {
        ackCalls.push(w.bidder);
        return "nak";
      },
      maxRetries: 0,
    });

    expect(result.winner).toBeNull();
    // The initial winner was naked once; no retry attempted because
    // maxRetries=0 caps it. winnerAck called once.
    expect(ackCalls).toHaveLength(1);
    expect(result.nakedWinners).toEqual([fern.did]);
    expect(result.retryCount).toBe(0); // RetryContext.attemptCount returns retries-performed, not naks
    expect(result.events.filter((e) => e.kind === "bid-retry")).toHaveLength(1);
    expect(result.events.filter((e) => e.kind === "assignment")).toHaveLength(1);
  });

  it("winnerAck receives the attempt counter (0-indexed)", async () => {
    const luna = await makeIdentity("did:mf:luna");
    const fern = await makeIdentity("did:mf:fern");
    const registry = registerPrincipals(luna, fern);

    const request = createBidRequest({
      task_id: "task-attempt",
      requirements: ["code-review"],
      bid_timeout_ms: 50,
      reply_to: "_INBOX.test.task-attempt",
    });
    const bidLuna = await signBidResponse(
      { task_id: request.task_id, bidder: luna.did, load: 0.5, capability_match: 0.9 },
      luna.identity,
    );
    const bidFern = await signBidResponse(
      { task_id: request.task_id, bidder: fern.did, load: 0.2, capability_match: 0.9 },
      fern.identity,
    );

    const { publish } = makeRecordingPublish();
    const publisher = createBiddingPublisher({
      org: "metafactory",
      source: "metafactory.cortex.dispatch",
      sovereignty,
      publish,
      registry,
    });

    const attempts: number[] = [];
    const acks: ("ack" | "nak")[] = ["nak", "ack"];
    await publisher.runRound({
      capability: "code-review",
      request,
      bidSource: makeScheduledSource([bidLuna, bidFern], [5, 10]),
      payload: {},
      winnerAck: (_w, attempt) => {
        attempts.push(attempt);
        return acks.shift()!;
      },
    });

    expect(attempts).toEqual([0, 1]);
  });
});
