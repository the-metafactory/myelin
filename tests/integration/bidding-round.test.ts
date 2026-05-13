/**
 * F-10 T-6.1: bidding round integration test against live NATS.
 *
 * Wires the F-10 publisher + collector + agent through a JetStream-
 * backed NATSTransport and exercises three of the four scenarios from
 * the F-10 spec:
 *
 *   - Scenario 1: 3 agents with different loads bid; lowest-load wins.
 *   - Scenario 2: no agents online; round times out, winner=null.
 *   - Scenario 4: single bidder wins by default.
 *
 * Scenario 3 (winner naks → next-best selected) is deferred until the
 * RetryContext-to-publisher wiring lands — currently the publisher's
 * single-round slice does not consume nak signals.
 *
 * Skips when NATS_URL is unset (matches the rest of tests/integration/).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { utils, getPublicKeyAsync } from "@noble/ed25519";
import { defaultSovereignty, hasNats, provisionNatsStream, testPrefix, waitFor } from "./setup";
import { bytesToBase64 } from "../../src/base64";
import { createInMemoryRegistry } from "../../src/identity/registry";
import type { NATSTransport } from "../../src/transport/nats";
import type { MyelinEnvelope } from "../../src/types";
import type { Subscription } from "../../src/transport/types";
import type { SigningIdentity } from "../../src/identity/types";
import {
  createBidRequest,
  createBiddingAgent,
  createBiddingPublisher,
  type BidEvaluator,
  type BiddingAgent,
  type BidResponse,
  type BidSource,
} from "../../src/bidding";

const ORG = "testbid10";
const SUITE = testPrefix("bid10");
const STREAM = SUITE;
const SOURCE = "metafactory.test.bidding";

(hasNats ? describe : describe.skip)("F-10 bidding round (live NATS required)", () => {
  let transport: NATSTransport;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const provisioned = await provisionNatsStream({
      streamName: STREAM,
      // One stream wildcards every F-10 subject family for this org.
      // Bid-request, bid lifecycle, direct-address assignments, and
      // per-task reply inboxes all live under the same prefix.
      subjects: [`local.${ORG}.>`],
    });
    transport = provisioned.transport;
    cleanup = provisioned.cleanup;
  });

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  // Fresh registry per test so DIDs don't leak between scenarios.
  let registry: ReturnType<typeof createInMemoryRegistry>;
  let liveAgents: BiddingAgent[];
  let liveSubs: Subscription[];

  beforeEach(() => {
    registry = createInMemoryRegistry();
    liveAgents = [];
    liveSubs = [];
  });

  // Per-test cleanup: each scenario's agents and Core NATS subscriptions
  // must tear down BEFORE the next `beforeEach` resets `liveAgents` /
  // `liveSubs` to fresh empty arrays. Running cleanup in `afterAll`
  // instead would lose the references for every test but the last —
  // earlier tests' subscriptions would stay alive on the broker until
  // the transport closed, and a future scenario reusing a capability
  // would receive bids from leaked agents.
  afterEach(async () => {
    for (const a of liveAgents) await a.stop().catch(() => {});
    for (const s of liveSubs) await s.unsubscribe().catch(() => {});
  });

  async function makeIdentity(did: string): Promise<{ identity: SigningIdentity; publicKey: string }> {
    const priv = utils.randomSecretKey();
    const pub = await getPublicKeyAsync(priv);
    return { identity: { did, privateKey: bytesToBase64(priv) }, publicKey: bytesToBase64(pub) };
  }

  async function spawnAgent(
    did: string,
    evaluator: BidEvaluator,
    capability: string,
  ): Promise<{ identity: SigningIdentity; publicKey: string }> {
    const ident = await makeIdentity(did);
    registry.add({
      id: did,
      operator: "metafactory",
      public_key: ident.publicKey,
      type: "agent",
      created_at: "2026-05-11T00:00:00Z",
    });
    const agent = createBiddingAgent({
      org: ORG,
      source: `${SOURCE}.${did.replace(/:/g, "-")}`,
      sovereignty: defaultSovereignty,
      identity: ident.identity,
      evaluator,
      capabilities: [capability],
      subscribe: (subject, handler) => transport.subscribeBestEffort(subject, handler),
      publish: (subject, env) => transport.publish(subject, env),
    });
    await agent.start();
    liveAgents.push(agent);
    return ident;
  }

  /**
   * Build a transport-backed BidSource for the per-task reply inbox.
   *
   * Now that the publisher subscribes-then-publishes (the `onSubscribed`
   * hook on `collectBids`), there is no race between bid-request
   * broadcast and inbox subscription — the prior "eager-inbox + buffer"
   * helper that worked around the race is no longer needed.
   */
  function natsBidSource(replySubject: string): BidSource {
    return async (handler) => {
      const sub = await transport.subscribeBestEffort(replySubject, async (env) => {
        await handler(env.payload as BidResponse);
      });
      return {
        unsubscribe: () => sub.unsubscribe(),
      };
    };
  }

  function makeEvaluator(load: number, match = 0.9): BidEvaluator {
    return {
      getLoad: () => load,
      evaluateMatch: () => match,
      shouldBid: () => true,
    };
  }

  it("scenario 1: 3 agents bid, lowest-load wins, full lifecycle emitted", async () => {
    const capability = "code-review";
    const taskId = `task-${SUITE.toLowerCase()}-multi`;
    const replySubject = `local.${ORG}.bidding-reply.${taskId}`;

    await spawnAgent("did:mf:luna", makeEvaluator(0.7), capability);
    await spawnAgent("did:mf:fern", makeEvaluator(0.2), capability);
    await spawnAgent("did:mf:gale", makeEvaluator(0.5), capability);

    const bidSource = natsBidSource(replySubject);
    const request = createBidRequest({
      task_id: taskId,
      requirements: [capability],
      bid_timeout_ms: 600,
      selection_strategy: "lowest-load",
      reply_to: replySubject,
    });

    // Subscribe to dispatch.bid.> via Core NATS so we can verify the
    // full lifecycle ordering of the round end-to-end.
    const lifecycleEnvelopes: MyelinEnvelope[] = [];
    const lifecycleSub = await transport.subscribeBestEffort(
      `local.${ORG}.dispatch.bid.>`,
      async (env) => {
        lifecycleEnvelopes.push(env);
      },
    );
    liveSubs.push(lifecycleSub);

    const publisher = createBiddingPublisher({
      org: ORG,
      source: SOURCE,
      sovereignty: defaultSovereignty,
      publish: (subject, env) => transport.publish(subject, env),
      registry,
    });

    const result = await publisher.runRound({
      capability,
      request,
      bidSource,
      payload: { work: "review PR" },
    });

    expect(result.winner?.bidder).toBe("did:mf:fern");
    expect(result.bids).toHaveLength(3);
    expect(result.drops).toHaveLength(0);
    expect(result.participants).toBe(3);
    expect(result.selectionReason).toMatch(/lowest-load/);

    // Lifecycle envelopes propagate through NATS — wait until all five
    // expected types have landed in the Core subscriber.
    await waitFor(
      () => {
        const types = new Set(lifecycleEnvelopes.map((e) => e.type));
        return (
          types.has("dispatch.bid.bid-opened") &&
          types.has("dispatch.bid.bid-received") &&
          types.has("dispatch.bid.bid-closed") &&
          types.has("dispatch.bid.bid-assigned")
        );
      },
      { timeoutMs: 3000, message: "lifecycle envelopes did not all arrive" },
    );

    const byType = (t: string): MyelinEnvelope[] => lifecycleEnvelopes.filter((e) => e.type === t);
    expect(byType("dispatch.bid.bid-opened")).toHaveLength(1);
    expect(byType("dispatch.bid.bid-received").length).toBeGreaterThanOrEqual(3);
    expect(byType("dispatch.bid.bid-closed")).toHaveLength(1);
    expect(byType("dispatch.bid.bid-assigned")).toHaveLength(1);
    expect(byType("dispatch.bid.bid-assigned")[0].payload.winner).toBe("did:mf:fern");

    // The publisher recorded an assignment publish to the direct-
    // address subject for the winner.
    const assignment = result.events.find((e) => e.kind === "assignment");
    expect(assignment).toBeDefined();
    expect(assignment!.subject).toBe(`local.${ORG}.tasks.@did-mf-fern.code-review`);

  });

  it("scenario 2: no agents online, round times out, winner=null", async () => {
    const capability = "release";
    const taskId = `task-${SUITE.toLowerCase()}-empty`;
    const replySubject = `local.${ORG}.bidding-reply.${taskId}`;

    const bidSource = natsBidSource(replySubject);
    const request = createBidRequest({
      task_id: taskId,
      requirements: [capability],
      bid_timeout_ms: 250,
      selection_strategy: "lowest-load",
      reply_to: replySubject,
    });

    const publisher = createBiddingPublisher({
      org: ORG,
      source: SOURCE,
      sovereignty: defaultSovereignty,
      publish: (subject, env) => transport.publish(subject, env),
      registry,
    });

    const result = await publisher.runRound({
      capability,
      request,
      bidSource,
      payload: {},
    });

    expect(result.winner).toBeNull();
    expect(result.bids).toHaveLength(0);
    expect(result.participants).toBe(0);
    expect(result.selectionReason).toBeNull();

    const kinds = result.events.map((e) => e.kind);
    expect(kinds).toEqual(["bid-request", "bid-opened", "bid-closed"]);
  });

  it("scenario 4: single bidder wins by default after timeout", async () => {
    const capability = "deploy";
    const taskId = `task-${SUITE.toLowerCase()}-solo`;
    const replySubject = `local.${ORG}.bidding-reply.${taskId}`;

    await spawnAgent("did:mf:solo", makeEvaluator(0.4, 0.6), capability);

    const bidSource = natsBidSource(replySubject);
    const request = createBidRequest({
      task_id: taskId,
      requirements: [capability],
      bid_timeout_ms: 500,
      selection_strategy: "highest-match",
      reply_to: replySubject,
    });

    const publisher = createBiddingPublisher({
      org: ORG,
      source: SOURCE,
      sovereignty: defaultSovereignty,
      publish: (subject, env) => transport.publish(subject, env),
      registry,
    });

    const result = await publisher.runRound({
      capability,
      request,
      bidSource,
      payload: { release: "v9.9.9" },
    });

    expect(result.winner?.bidder).toBe("did:mf:solo");
    expect(result.bids).toHaveLength(1);
    expect(result.participants).toBe(1);
    expect(result.selectionReason).toMatch(/highest-match/);

  });
});
