import { describe, it, expect } from "bun:test";
import { utils, getPublicKeyAsync } from "@noble/ed25519";
import {
  createBiddingAgent,
  type BidEvaluator,
  type AgentObservation,
  type AgentTransportPublish,
  type AgentTransportSubscribe,
} from "./agent";
import { createBidRequest } from "./request";
import { createInMemoryRegistry } from "../identity/registry";
import { verifyBidResponse } from "./response";
import { createEnvelope } from "../envelope";
import { bytesToBase64 } from "../base64";
import type { MyelinEnvelope, Sovereignty } from "../types";
import type { SigningIdentity } from "../identity/types";
import type { Subscription } from "../transport/types";

const sovereignty: Sovereignty = {
  classification: "local",
  data_residency: "CH",
  max_hop: 0,
  frontier_ok: false,
  model_class: "any",
};

async function makeIdentity(did: string): Promise<{
  did: string;
  identity: SigningIdentity;
  publicKey: string;
}> {
  const priv = utils.randomSecretKey();
  const pub = await getPublicKeyAsync(priv);
  return {
    did,
    identity: { did, privateKey: bytesToBase64(priv) },
    publicKey: bytesToBase64(pub),
  };
}

/**
 * Minimal in-memory transport stand-in for the agent. Captures
 * publish calls, lets tests fire envelopes into the subscribe handler
 * to simulate a bid-request arriving on the wire.
 */
function makeFakeTransport(): {
  subscribe: AgentTransportSubscribe;
  publish: AgentTransportPublish;
  published: { subject: string; envelope: MyelinEnvelope }[];
  fire: (subject: string, envelope: MyelinEnvelope) => Promise<void>;
  subscriptions: { subject: string; closed: boolean }[];
} {
  const handlers = new Map<string, (env: MyelinEnvelope) => Promise<void>>();
  const subscriptions: { subject: string; closed: boolean }[] = [];
  const published: { subject: string; envelope: MyelinEnvelope }[] = [];

  const subscribe: AgentTransportSubscribe = async (subject, handler) => {
    handlers.set(subject, handler);
    const sub: { subject: string; closed: boolean } = { subject, closed: false };
    subscriptions.push(sub);
    const result: Subscription = {
      async unsubscribe() {
        sub.closed = true;
        handlers.delete(subject);
      },
    };
    return result;
  };

  const publish: AgentTransportPublish = async (subject, envelope) => {
    published.push({ subject, envelope });
  };

  return {
    subscribe,
    publish,
    published,
    subscriptions,
    async fire(subject, envelope) {
      const h = handlers.get(subject);
      if (!h) throw new Error(`no handler for ${subject}`);
      await h(envelope);
    },
  };
}

function makeEvaluator(overrides: Partial<BidEvaluator> = {}): BidEvaluator {
  return {
    getLoad: () => 0.3,
    evaluateMatch: () => 0.85,
    shouldBid: () => true,
    ...overrides,
  };
}

describe("createBiddingAgent", () => {
  it("rejects construction with empty capabilities", async () => {
    const luna = await makeIdentity("did:mf:luna");
    const t = makeFakeTransport();
    expect(() =>
      createBiddingAgent({
        principal: "metafactory",
        source: "metafactory.agents.luna",
        sovereignty,
        identity: luna.identity,
        evaluator: makeEvaluator(),
        capabilities: [],
        subscribe: t.subscribe,
        publish: t.publish,
      }),
    ).toThrow(/capabilities must be a non-empty array/);
  });

  it("subscribes to one bid-request subject per capability", async () => {
    const luna = await makeIdentity("did:mf:luna");
    const t = makeFakeTransport();
    const agent = createBiddingAgent({
      principal: "metafactory",
      source: "metafactory.agents.luna",
      sovereignty,
      identity: luna.identity,
      evaluator: makeEvaluator(),
      capabilities: ["code-review", "deploy"],
      subscribe: t.subscribe,
      publish: t.publish,
    });

    await agent.start();
    expect(t.subscriptions.map((s) => s.subject).sort()).toEqual([
      "local.metafactory.tasks.bid-request.code-review",
      "local.metafactory.tasks.bid-request.deploy",
    ]);
  });

  it("on incoming request: evaluates, signs, publishes signed bid to reply_to", async () => {
    const luna = await makeIdentity("did:mf:luna");
    const t = makeFakeTransport();
    const obs: AgentObservation[] = [];

    const agent = createBiddingAgent({
      principal: "metafactory",
      source: "metafactory.agents.luna",
      sovereignty,
      identity: luna.identity,
      evaluator: makeEvaluator({ getLoad: () => 0.2, evaluateMatch: () => 0.95 }),
      capabilities: ["code-review"],
      subscribe: t.subscribe,
      publish: t.publish,
      onObservation: (o) => obs.push(o),
    });
    await agent.start();

    const request = createBidRequest({
      task_id: "task-100",
      requirements: ["code-review"],
      bid_timeout_ms: 50,
      selection_strategy: "lowest-load",
      reply_to: "_INBOX.foo.task-100",
    });
    const envelope = createEnvelope({
      source: "metafactory.cortex.dispatch",
      type: "tasks.bid-request",
      sovereignty,
      payload: { ...request },
      correlation_id: "corr-abc",
    });

    await t.fire("local.metafactory.tasks.bid-request.code-review", envelope);

    expect(t.published).toHaveLength(1);
    expect(t.published[0]!.subject).toBe("_INBOX.foo.task-100");
    expect(t.published[0]!.envelope.type).toBe("tasks.bid-response");
    expect(t.published[0]!.envelope.correlation_id).toBe("corr-abc");

    const bidPayload = t.published[0]!.envelope.payload;
    expect(bidPayload.task_id).toBe("task-100");
    expect(bidPayload.bidder).toBe(luna.did);
    expect(bidPayload.load).toBe(0.2);
    expect(bidPayload.capability_match).toBe(0.95);

    // Signature must verify against the bidder's public key.
    const registry = createInMemoryRegistry();
    registry.add({
      id: luna.did,
      network: "metafactory",
      public_key: luna.publicKey,
      type: "agent",
      created_at: "2026-05-11T00:00:00Z",
    });
    const verification = await verifyBidResponse(bidPayload as never, registry);
    expect(verification.valid).toBe(true);

    expect(obs.map((o) => o.kind)).toEqual(["received", "bid-sent"]);
  });

  it("declines when shouldBid() returns false (no publish, observed)", async () => {
    const luna = await makeIdentity("did:mf:luna");
    const t = makeFakeTransport();
    const obs: AgentObservation[] = [];

    const agent = createBiddingAgent({
      principal: "metafactory",
      source: "metafactory.agents.luna",
      sovereignty,
      identity: luna.identity,
      evaluator: makeEvaluator({ shouldBid: () => false }),
      capabilities: ["code-review"],
      subscribe: t.subscribe,
      publish: t.publish,
      onObservation: (o) => obs.push(o),
    });
    await agent.start();

    const request = createBidRequest({
      task_id: "task-declined",
      requirements: ["code-review"],
      bid_timeout_ms: 50,
      reply_to: "_INBOX.task-declined",
    });
    const envelope = createEnvelope({
      source: "metafactory.cortex.dispatch",
      type: "tasks.bid-request",
      sovereignty,
      payload: { ...request },
    });

    await t.fire("local.metafactory.tasks.bid-request.code-review", envelope);

    expect(t.published).toHaveLength(0);
    expect(obs.map((o) => o.kind)).toEqual(["received", "declined"]);
  });

  it("skips malformed bid-request envelopes (no publish, observed)", async () => {
    const luna = await makeIdentity("did:mf:luna");
    const t = makeFakeTransport();
    const obs: AgentObservation[] = [];

    const agent = createBiddingAgent({
      principal: "metafactory",
      source: "metafactory.agents.luna",
      sovereignty,
      identity: luna.identity,
      evaluator: makeEvaluator(),
      capabilities: ["code-review"],
      subscribe: t.subscribe,
      publish: t.publish,
      onObservation: (o) => obs.push(o),
    });
    await agent.start();

    // missing reply_to + requirements; payload is half a BidRequest at best
    const envelope = createEnvelope({
      source: "metafactory.cortex.dispatch",
      type: "tasks.bid-request",
      sovereignty,
      payload: { task_id: "task-x" },
    });

    await t.fire("local.metafactory.tasks.bid-request.code-review", envelope);

    expect(t.published).toHaveLength(0);
    expect(obs.map((o) => o.kind)).toEqual(["skipped-malformed"]);
  });

  it("captures evaluator errors as 'error' observations (no publish)", async () => {
    const luna = await makeIdentity("did:mf:luna");
    const t = makeFakeTransport();
    const obs: AgentObservation[] = [];

    const agent = createBiddingAgent({
      principal: "metafactory",
      source: "metafactory.agents.luna",
      sovereignty,
      identity: luna.identity,
      evaluator: makeEvaluator({
        getLoad: () => {
          throw new Error("load probe failed");
        },
      }),
      capabilities: ["code-review"],
      subscribe: t.subscribe,
      publish: t.publish,
      onObservation: (o) => obs.push(o),
    });
    await agent.start();

    const request = createBidRequest({
      task_id: "task-err",
      requirements: ["code-review"],
      bid_timeout_ms: 50,
      reply_to: "_INBOX.task-err",
    });
    const envelope = createEnvelope({
      source: "metafactory.cortex.dispatch",
      type: "tasks.bid-request",
      sovereignty,
      payload: { ...request },
    });
    await t.fire("local.metafactory.tasks.bid-request.code-review", envelope);

    expect(t.published).toHaveLength(0);
    const errObs = obs.find((o) => o.kind === "error");
    expect(errObs).toBeDefined();
    expect(errObs!.reason).toMatch(/load probe failed/);
  });

  it("attaches cost and constraints when evaluator provides them", async () => {
    const luna = await makeIdentity("did:mf:luna");
    const t = makeFakeTransport();

    const agent = createBiddingAgent({
      principal: "metafactory",
      source: "metafactory.agents.luna",
      sovereignty,
      identity: luna.identity,
      evaluator: makeEvaluator({
        getCost: () => 0.05,
        getConstraints: () => ["residency:CH"],
      }),
      capabilities: ["code-review"],
      subscribe: t.subscribe,
      publish: t.publish,
    });
    await agent.start();

    const request = createBidRequest({
      task_id: "task-cost",
      requirements: ["code-review"],
      bid_timeout_ms: 50,
      reply_to: "_INBOX.task-cost",
    });
    const envelope = createEnvelope({
      source: "metafactory.cortex.dispatch",
      type: "tasks.bid-request",
      sovereignty,
      payload: { ...request },
    });
    await t.fire("local.metafactory.tasks.bid-request.code-review", envelope);

    const payload = t.published[0]!.envelope.payload;
    expect(payload.cost).toBe(0.05);
    expect(payload.constraints).toEqual(["residency:CH"]);
  });

  it("calling start() twice throws (no double subscription)", async () => {
    const luna = await makeIdentity("did:mf:luna");
    const t = makeFakeTransport();
    const agent = createBiddingAgent({
      principal: "metafactory",
      source: "metafactory.agents.luna",
      sovereignty,
      identity: luna.identity,
      evaluator: makeEvaluator(),
      capabilities: ["code-review"],
      subscribe: t.subscribe,
      publish: t.publish,
    });
    await agent.start();
    await expect(agent.start()).rejects.toThrow(/already started/);
    expect(t.subscriptions).toHaveLength(1);
  });

  it("stop() unsubscribes every active subscription", async () => {
    const luna = await makeIdentity("did:mf:luna");
    const t = makeFakeTransport();
    const agent = createBiddingAgent({
      principal: "metafactory",
      source: "metafactory.agents.luna",
      sovereignty,
      identity: luna.identity,
      evaluator: makeEvaluator(),
      capabilities: ["code-review", "deploy"],
      subscribe: t.subscribe,
      publish: t.publish,
    });
    await agent.start();
    await agent.stop();
    for (const s of t.subscriptions) {
      expect(s.closed).toBe(true);
    }
  });

  it("after stop(), a start() can resubscribe", async () => {
    const luna = await makeIdentity("did:mf:luna");
    const t = makeFakeTransport();
    const agent = createBiddingAgent({
      principal: "metafactory",
      source: "metafactory.agents.luna",
      sovereignty,
      identity: luna.identity,
      evaluator: makeEvaluator(),
      capabilities: ["code-review"],
      subscribe: t.subscribe,
      publish: t.publish,
    });
    await agent.start();
    await agent.stop();
    await agent.start();
    expect(t.subscriptions.filter((s) => !s.closed)).toHaveLength(1);
  });

  it("rolls back partial subscriptions on subscribe error", async () => {
    const luna = await makeIdentity("did:mf:luna");
    const t = makeFakeTransport();
    let calls = 0;
    const failingSubscribe: AgentTransportSubscribe = async (subject, handler) => {
      calls += 1;
      if (calls === 2) {
        throw new Error("transport unavailable");
      }
      return t.subscribe(subject, handler);
    };

    const agent = createBiddingAgent({
      principal: "metafactory",
      source: "metafactory.agents.luna",
      sovereignty,
      identity: luna.identity,
      evaluator: makeEvaluator(),
      capabilities: ["code-review", "deploy", "release"],
      subscribe: failingSubscribe,
      publish: t.publish,
    });

    await expect(agent.start()).rejects.toThrow(/transport unavailable/);
    // The first subscription that succeeded must have been rolled back.
    expect(t.subscriptions.filter((s) => !s.closed)).toHaveLength(0);
  });

  it("observer errors do not crash the bidding loop", async () => {
    const luna = await makeIdentity("did:mf:luna");
    const t = makeFakeTransport();
    const agent = createBiddingAgent({
      principal: "metafactory",
      source: "metafactory.agents.luna",
      sovereignty,
      identity: luna.identity,
      evaluator: makeEvaluator(),
      capabilities: ["code-review"],
      subscribe: t.subscribe,
      publish: t.publish,
      onObservation: () => {
        throw new Error("observer exploded");
      },
    });
    await agent.start();

    const request = createBidRequest({
      task_id: "task-obs",
      requirements: ["code-review"],
      bid_timeout_ms: 50,
      reply_to: "_INBOX.task-obs",
    });
    const envelope = createEnvelope({
      source: "metafactory.cortex.dispatch",
      type: "tasks.bid-request",
      sovereignty,
      payload: { ...request },
    });

    // Must not throw; bid must still be published despite the
    // observer's exception.
    await t.fire("local.metafactory.tasks.bid-request.code-review", envelope);
    expect(t.published).toHaveLength(1);
  });
});
