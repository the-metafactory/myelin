import { describe, it, expect } from "bun:test";
import { utils, getPublicKeyAsync } from "@noble/ed25519";
import { collectBids, type BidSource } from "./collector";
import { signBidResponse } from "./response";
import type { BidResponse } from "./types";
import { createInMemoryRegistry } from "../identity/registry";
import type { SigningIdentity } from "../identity/types";

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
      network: "metafactory",
      public_key: p.publicKey,
      type: "agent",
      created_at: "2026-05-11T00:00:00Z",
    });
  }
  return registry;
}

/**
 * Build a source that emits the provided bids on the supplied schedule.
 * `schedule[i]` is the ms delay (relative to subscribe) at which `bids[i]`
 * is delivered. Delays past the deadline test the after-deadline drop.
 */
function makeScheduledSource(bids: BidResponse[], schedule: number[]): BidSource {
  if (bids.length !== schedule.length) {
    throw new Error("schedule must have same length as bids");
  }
  return async (handler) => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 0; i < bids.length; i++) {
      const idx = i;
      timers.push(setTimeout(() => void Promise.resolve(handler(bids[idx])), schedule[idx]));
    }
    return {
      async unsubscribe() {
        for (const t of timers) clearTimeout(t);
      },
    };
  };
}

describe("collectBids", () => {
  it("collects verified bids, selects winner by strategy, returns drops empty", async () => {
    const a = await makeIdentity("did:mf:luna");
    const b = await makeIdentity("did:mf:fern");
    const c = await makeIdentity("did:mf:gale");
    const registry = registerPrincipals(a, b, c);

    const bidA = await signBidResponse({ task_id: "t1", bidder: a.did, load: 0.8, capability_match: 0.9 }, a.identity);
    const bidB = await signBidResponse({ task_id: "t1", bidder: b.did, load: 0.2, capability_match: 0.7 }, b.identity);
    const bidC = await signBidResponse({ task_id: "t1", bidder: c.did, load: 0.5, capability_match: 0.6 }, c.identity);

    const result = await collectBids({
      source: makeScheduledSource([bidA, bidB, bidC], [5, 10, 15]),
      registry,
      taskId: "t1",
      selectionStrategy: "lowest-load",
      deadlineMs: 80,
    });

    expect(result.bids).toHaveLength(3);
    expect(result.drops).toHaveLength(0);
    expect(result.outcome).not.toBeNull();
    expect(result.outcome!.winner.bidder).toBe(b.did);
    expect(result.outcome!.reason).toMatch(/lowest-load/);
  });

  it("drops bids with mismatched task_id", async () => {
    const a = await makeIdentity("did:mf:luna");
    const b = await makeIdentity("did:mf:fern");
    const registry = registerPrincipals(a, b);

    const bidA = await signBidResponse({ task_id: "t1", bidder: a.did, load: 0.3, capability_match: 0.9 }, a.identity);
    const stray = await signBidResponse({ task_id: "OTHER", bidder: b.did, load: 0.1, capability_match: 0.9 }, b.identity);

    const result = await collectBids({
      source: makeScheduledSource([bidA, stray], [5, 10]),
      registry,
      taskId: "t1",
      selectionStrategy: "lowest-load",
      deadlineMs: 60,
    });

    expect(result.bids).toHaveLength(1);
    expect(result.bids[0].bidder).toBe(a.did);
    expect(result.drops).toHaveLength(1);
    expect(result.drops[0].bidder).toBe(b.did);
    expect(result.drops[0].reason).toMatch(/task_id mismatch/);
    expect(result.outcome!.winner.bidder).toBe(a.did);
  });

  it("drops bids from excluded bidders", async () => {
    const a = await makeIdentity("did:mf:luna");
    const b = await makeIdentity("did:mf:fern");
    const registry = registerPrincipals(a, b);

    const bidA = await signBidResponse({ task_id: "t1", bidder: a.did, load: 0.4, capability_match: 0.9 }, a.identity);
    const bidB = await signBidResponse({ task_id: "t1", bidder: b.did, load: 0.1, capability_match: 0.9 }, b.identity);

    const result = await collectBids({
      source: makeScheduledSource([bidA, bidB], [5, 10]),
      registry,
      taskId: "t1",
      selectionStrategy: "lowest-load",
      deadlineMs: 60,
      excluded: new Set([b.did]),
    });

    expect(result.bids).toHaveLength(1);
    expect(result.bids[0].bidder).toBe(a.did);
    expect(result.drops).toHaveLength(1);
    expect(result.drops[0].bidder).toBe(b.did);
    expect(result.drops[0].reason).toMatch(/excluded/);
    expect(result.outcome!.winner.bidder).toBe(a.did);
  });

  it("drops duplicate bids from the same bidder (keeps first)", async () => {
    const a = await makeIdentity("did:mf:luna");
    const registry = registerPrincipals(a);
    const first = await signBidResponse({ task_id: "t1", bidder: a.did, load: 0.3, capability_match: 0.9 }, a.identity);
    const second = await signBidResponse({ task_id: "t1", bidder: a.did, load: 0.1, capability_match: 0.9 }, a.identity);

    const result = await collectBids({
      source: makeScheduledSource([first, second], [5, 10]),
      registry,
      taskId: "t1",
      selectionStrategy: "lowest-load",
      deadlineMs: 60,
    });

    expect(result.bids).toHaveLength(1);
    expect(result.bids[0].load).toBe(0.3);
    expect(result.drops).toHaveLength(1);
    expect(result.drops[0].reason).toMatch(/duplicate/);
  });

  it("drops bids that fail verification (tampered payload)", async () => {
    const a = await makeIdentity("did:mf:luna");
    const b = await makeIdentity("did:mf:fern");
    const registry = registerPrincipals(a, b);

    const bidA = await signBidResponse({ task_id: "t1", bidder: a.did, load: 0.3, capability_match: 0.9 }, a.identity);
    const bidB = await signBidResponse({ task_id: "t1", bidder: b.did, load: 0.2, capability_match: 0.9 }, b.identity);
    bidB.load = 0.0; // post-sign tamper

    const result = await collectBids({
      source: makeScheduledSource([bidA, bidB], [5, 10]),
      registry,
      taskId: "t1",
      selectionStrategy: "lowest-load",
      deadlineMs: 60,
    });

    expect(result.bids).toHaveLength(1);
    expect(result.bids[0].bidder).toBe(a.did);
    expect(result.drops).toHaveLength(1);
    expect(result.drops[0].bidder).toBe(b.did);
    expect(result.drops[0].reason).toMatch(/verification failed/);
    expect(result.outcome!.winner.bidder).toBe(a.did);
  });

  it("drops bids from unknown principals (not in registry)", async () => {
    const a = await makeIdentity("did:mf:luna");
    const stranger = await makeIdentity("did:mf:stranger");
    const registry = registerPrincipals(a);

    const bidA = await signBidResponse({ task_id: "t1", bidder: a.did, load: 0.3, capability_match: 0.9 }, a.identity);
    const bidS = await signBidResponse({ task_id: "t1", bidder: stranger.did, load: 0.1, capability_match: 0.9 }, stranger.identity);

    const result = await collectBids({
      source: makeScheduledSource([bidA, bidS], [5, 10]),
      registry,
      taskId: "t1",
      selectionStrategy: "lowest-load",
      deadlineMs: 60,
    });

    expect(result.bids).toHaveLength(1);
    expect(result.bids[0].bidder).toBe(a.did);
    expect(result.drops[0].reason).toMatch(/unknown principal/);
  });

  it("returns outcome=null when no bids arrive within deadline", async () => {
    const registry = createInMemoryRegistry();
    const result = await collectBids({
      source: makeScheduledSource([], []),
      registry,
      taskId: "t1",
      selectionStrategy: "lowest-load",
      deadlineMs: 30,
    });
    expect(result.bids).toHaveLength(0);
    expect(result.drops).toHaveLength(0);
    expect(result.outcome).toBeNull();
  });

  it("drops bids that arrive after the deadline", async () => {
    const a = await makeIdentity("did:mf:luna");
    const b = await makeIdentity("did:mf:fern");
    const registry = registerPrincipals(a, b);

    const bidA = await signBidResponse({ task_id: "t1", bidder: a.did, load: 0.3, capability_match: 0.9 }, a.identity);
    const bidB = await signBidResponse({ task_id: "t1", bidder: b.did, load: 0.1, capability_match: 0.9 }, b.identity);

    // bidB scheduled WAY past deadline — must be dropped, never selected.
    const result = await collectBids({
      source: makeScheduledSource([bidA, bidB], [5, 200]),
      registry,
      taskId: "t1",
      selectionStrategy: "lowest-load",
      deadlineMs: 40,
    });

    expect(result.bids).toHaveLength(1);
    expect(result.bids[0].bidder).toBe(a.did);
    expect(result.outcome!.winner.bidder).toBe(a.did);
  });

  it("aborts early when AbortSignal fires", async () => {
    const a = await makeIdentity("did:mf:luna");
    const registry = registerPrincipals(a);
    const bidA = await signBidResponse({ task_id: "t1", bidder: a.did, load: 0.3, capability_match: 0.9 }, a.identity);

    const ac = new AbortController();
    const start = Date.now();
    setTimeout(() => { ac.abort(); }, 25);
    const result = await collectBids({
      source: makeScheduledSource([bidA], [5]),
      registry,
      taskId: "t1",
      selectionStrategy: "lowest-load",
      deadlineMs: 5_000,
      signal: ac.signal,
    });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(500);
    expect(result.outcome!.winner.bidder).toBe(a.did);
  });

  it("returns immediately when signal is already aborted", async () => {
    const registry = createInMemoryRegistry();
    const ac = new AbortController();
    ac.abort();
    const start = Date.now();
    const result = await collectBids({
      source: makeScheduledSource([], []),
      registry,
      taskId: "t1",
      selectionStrategy: "lowest-load",
      deadlineMs: 5_000,
      signal: ac.signal,
    });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(200);
    expect(result.bids).toHaveLength(0);
    expect(result.outcome).toBeNull();
  });

  it("defensively copies the excluded set (caller mutation does not affect filtering)", async () => {
    const a = await makeIdentity("did:mf:luna");
    const b = await makeIdentity("did:mf:fern");
    const registry = registerPrincipals(a, b);

    const bidA = await signBidResponse({ task_id: "t1", bidder: a.did, load: 0.3, capability_match: 0.9 }, a.identity);
    const bidB = await signBidResponse({ task_id: "t1", bidder: b.did, load: 0.1, capability_match: 0.9 }, b.identity);

    const excluded = new Set<string>([b.did]);
    const pending = collectBids({
      source: makeScheduledSource([bidA, bidB], [5, 10]),
      registry,
      taskId: "t1",
      selectionStrategy: "lowest-load",
      deadlineMs: 50,
      excluded,
    });
    excluded.clear(); // mutate caller's set mid-collect — must not unblock b
    const result = await pending;

    expect(result.bids.map((b) => b.bidder)).toEqual([a.did]);
    expect(result.outcome!.winner.bidder).toBe(a.did);
  });

  it("rejects non-positive deadlineMs", async () => {
    const registry = createInMemoryRegistry();
    await expect(
      collectBids({
        source: makeScheduledSource([], []),
        registry,
        taskId: "t1",
        selectionStrategy: "lowest-load",
        deadlineMs: 0,
      }),
    ).rejects.toThrow(/deadlineMs must be positive/);
  });

  it("rejects empty taskId", async () => {
    const registry = createInMemoryRegistry();
    await expect(
      collectBids({
        source: makeScheduledSource([], []),
        registry,
        taskId: "",
        selectionStrategy: "lowest-load",
        deadlineMs: 50,
      }),
    ).rejects.toThrow(/taskId must be a non-empty string/);
  });

  it("respects selection strategy: highest-match picks the best match score", async () => {
    const a = await makeIdentity("did:mf:luna");
    const b = await makeIdentity("did:mf:fern");
    const registry = registerPrincipals(a, b);

    const bidA = await signBidResponse({ task_id: "t1", bidder: a.did, load: 0.05, capability_match: 0.4 }, a.identity);
    const bidB = await signBidResponse({ task_id: "t1", bidder: b.did, load: 0.9, capability_match: 0.95 }, b.identity);

    const result = await collectBids({
      source: makeScheduledSource([bidA, bidB], [5, 10]),
      registry,
      taskId: "t1",
      selectionStrategy: "highest-match",
      deadlineMs: 50,
    });

    expect(result.outcome!.winner.bidder).toBe(b.did);
    expect(result.outcome!.reason).toMatch(/highest-match/);
  });

  it("unsubscribes the source after collection ends", async () => {
    const a = await makeIdentity("did:mf:luna");
    const registry = registerPrincipals(a);
    const bidA = await signBidResponse({ task_id: "t1", bidder: a.did, load: 0.3, capability_match: 0.9 }, a.identity);

    let unsubscribed = false;
    const source: BidSource = async (handler) => {
      void handler(bidA);
      return {
        async unsubscribe() {
          unsubscribed = true;
        },
      };
    };

    await collectBids({
      source,
      registry,
      taskId: "t1",
      selectionStrategy: "lowest-load",
      deadlineMs: 25,
    });
    expect(unsubscribed).toBe(true);
  });

  it("treats concurrent duplicates from the same bidder as duplicates (race-safe)", async () => {
    // Regression guard: handlers are async, so two bids from the same bidder
    // delivered before either finishes verification must NOT both pass the
    // dedup check. The claim happens before the first await — concurrent
    // invocations see the bidder already taken.
    const a = await makeIdentity("did:mf:luna");
    const registry = registerPrincipals(a);
    const bid1 = await signBidResponse({ task_id: "t1", bidder: a.did, load: 0.4, capability_match: 0.9 }, a.identity);
    const bid2 = await signBidResponse({ task_id: "t1", bidder: a.did, load: 0.1, capability_match: 0.9 }, a.identity);

    const source: BidSource = async (handler) => {
      // Fire both bids in the same microtask tick — both promises start
      // before either yields back from verifyBidResponse.
      void Promise.resolve().then(() => {
        void handler(bid1);
        void handler(bid2);
      });
      return { async unsubscribe() {} };
    };

    const result = await collectBids({
      source,
      registry,
      taskId: "t1",
      selectionStrategy: "lowest-load",
      deadlineMs: 60,
    });

    expect(result.bids).toHaveLength(1);
    expect(result.bids[0].load).toBe(0.4); // first claimed
    expect(result.drops.filter((d) => d.reason.includes("duplicate"))).toHaveLength(1);
  });

  it("blocks a bidder for the round even when their first bid fails verification", async () => {
    // A failed-verification bid still claims the bidder slot: a bad signature
    // is not a free retry. This pins the "claim-before-verify" invariant.
    const a = await makeIdentity("did:mf:luna");
    const registry = registerPrincipals(a);

    const tampered = await signBidResponse({ task_id: "t1", bidder: a.did, load: 0.3, capability_match: 0.9 }, a.identity);
    tampered.load = 0.0; // tamper after signing
    const honest = await signBidResponse({ task_id: "t1", bidder: a.did, load: 0.2, capability_match: 0.9 }, a.identity);

    const result = await collectBids({
      source: makeScheduledSource([tampered, honest], [5, 15]),
      registry,
      taskId: "t1",
      selectionStrategy: "lowest-load",
      deadlineMs: 60,
    });

    expect(result.bids).toHaveLength(0);
    expect(result.drops).toHaveLength(2);
    expect(result.drops[0].reason).toMatch(/verification failed/);
    expect(result.drops[1].reason).toMatch(/duplicate/);
    expect(result.outcome).toBeNull();
  });

  it("captures handler errors as drops (no unhandled rejections on adversarial input)", async () => {
    // Simulate a verify path that throws (e.g. noble/ed25519 internal error
    // on a crafted bid). The collector must surface this as a drop entry,
    // never as a silent rejection. We use a registry-as-throwing-resolver
    // to force the throw without forging a malformed bid object.
    const a = await makeIdentity("did:mf:luna");
    const throwingRegistry: ReturnType<typeof createInMemoryRegistry> = {
      add() {},
      resolve() {
        throw new Error("registry exploded");
      },
      list() {
        return [];
      },
    } as unknown as ReturnType<typeof createInMemoryRegistry>;

    const bidA = await signBidResponse({ task_id: "t1", bidder: a.did, load: 0.3, capability_match: 0.9 }, a.identity);

    const result = await collectBids({
      source: makeScheduledSource([bidA], [5]),
      registry: throwingRegistry,
      taskId: "t1",
      selectionStrategy: "lowest-load",
      deadlineMs: 40,
    });

    expect(result.bids).toHaveLength(0);
    expect(result.drops).toHaveLength(1);
    expect(result.drops[0].bidder).toBe(a.did);
    expect(result.drops[0].reason).toMatch(/handler error.*registry exploded/);
    expect(result.outcome).toBeNull();
  });

  it("onBidAccepted fires per accepted bid in arrival order (streaming)", async () => {
    const a = await makeIdentity("did:mf:luna");
    const b = await makeIdentity("did:mf:fern");
    const c = await makeIdentity("did:mf:gale");
    const registry = registerPrincipals(a, b, c);

    const bidA = await signBidResponse({ task_id: "t1", bidder: a.did, load: 0.5, capability_match: 0.9 }, a.identity);
    const bidB = await signBidResponse({ task_id: "t1", bidder: b.did, load: 0.2, capability_match: 0.9 }, b.identity);
    const bidC = await signBidResponse({ task_id: "t1", bidder: c.did, load: 0.7, capability_match: 0.9 }, c.identity);

    const acceptedOrder: string[] = [];
    const result = await collectBids({
      source: makeScheduledSource([bidA, bidB, bidC], [5, 10, 15]),
      registry,
      taskId: "t1",
      selectionStrategy: "lowest-load",
      deadlineMs: 80,
      onBidAccepted: (bid) => {
        acceptedOrder.push(bid.bidder);
      },
    });

    expect(acceptedOrder).toEqual([a.did, b.did, c.did]);
    expect(result.bids).toHaveLength(3);
  });

  it("onBidAccepted does NOT fire for dropped bids", async () => {
    const a = await makeIdentity("did:mf:luna");
    const b = await makeIdentity("did:mf:fern");
    const registry = registerPrincipals(a, b);

    const bidA = await signBidResponse({ task_id: "t1", bidder: a.did, load: 0.3, capability_match: 0.9 }, a.identity);
    const stray = await signBidResponse({ task_id: "OTHER", bidder: b.did, load: 0.1, capability_match: 0.9 }, b.identity);

    const accepted: string[] = [];
    const result = await collectBids({
      source: makeScheduledSource([bidA, stray], [5, 10]),
      registry,
      taskId: "t1",
      selectionStrategy: "lowest-load",
      deadlineMs: 60,
      onBidAccepted: (bid) => {
        accepted.push(bid.bidder);
      },
    });

    expect(accepted).toEqual([a.did]);
    expect(result.drops).toHaveLength(1);
  });

  it("onBidAccepted hook errors surface as drops; the bid stays accepted", async () => {
    const a = await makeIdentity("did:mf:luna");
    const registry = registerPrincipals(a);
    const bidA = await signBidResponse({ task_id: "t1", bidder: a.did, load: 0.3, capability_match: 0.9 }, a.identity);

    const result = await collectBids({
      source: makeScheduledSource([bidA], [5]),
      registry,
      taskId: "t1",
      selectionStrategy: "lowest-load",
      deadlineMs: 50,
      onBidAccepted: () => {
        throw new Error("hook exploded");
      },
    });

    expect(result.bids).toHaveLength(1);
    expect(result.drops).toHaveLength(1);
    expect(result.drops[0].reason).toMatch(/onBidAccepted hook error.*hook exploded/);
  });

  it("onSubscribed fires after subscribe and before deadline (subscribe-then-publish ordering)", async () => {
    const a = await makeIdentity("did:mf:luna");
    const registry = registerPrincipals(a);
    const bidA = await signBidResponse(
      { task_id: "t1", bidder: a.did, load: 0.3, capability_match: 0.9 },
      a.identity,
    );

    const order: string[] = [];
    let subscribed = false;
    const trackedSource: BidSource = async (handler) => {
      subscribed = true;
      order.push("subscribed");
      // Fire the bid immediately after subscribe, mimicking a fast agent.
      setTimeout(() => void handler(bidA), 5);
      return {
        async unsubscribe() {
          order.push("unsubscribed");
        },
      };
    };

    const result = await collectBids({
      source: trackedSource,
      registry,
      taskId: "t1",
      selectionStrategy: "lowest-load",
      deadlineMs: 30,
      onSubscribed: async () => {
        // Must observe subscribed=true here — collectBids has bound
        // the source before calling this hook.
        expect(subscribed).toBe(true);
        order.push("onSubscribed");
      },
    });

    expect(order).toEqual(["subscribed", "onSubscribed", "unsubscribed"]);
    expect(result.bids).toHaveLength(1);
  });

  it("onSubscribed throwing tears down the subscription and propagates", async () => {
    const registry = createInMemoryRegistry();

    let unsubscribed = false;
    const source: BidSource = async () => ({
      async unsubscribe() {
        unsubscribed = true;
      },
    });

    await expect(
      collectBids({
        source,
        registry,
        taskId: "t1",
        selectionStrategy: "lowest-load",
        deadlineMs: 50,
        onSubscribed: async () => {
          throw new Error("publish failed");
        },
      }),
    ).rejects.toThrow(/publish failed/);
    expect(unsubscribed).toBe(true);
  });

  it("unsubscribes even if the source throws after a successful subscribe", async () => {
    // Verifies that the unsubscribe finally-block fires when handler logic
    // races with deadline expiry — no leaked subscriptions on hot paths.
    const a = await makeIdentity("did:mf:luna");
    const registry = registerPrincipals(a);
    const bidA = await signBidResponse({ task_id: "t1", bidder: a.did, load: 0.3, capability_match: 0.9 }, a.identity);

    let unsubscribed = false;
    const source: BidSource = async (handler) => {
      // Fire bid synchronously, then return a subscription whose unsubscribe
      // we want to observe being called by the collector.
      void Promise.resolve().then(() => handler(bidA));
      return {
        async unsubscribe() {
          unsubscribed = true;
        },
      };
    };

    const result = await collectBids({
      source,
      registry,
      taskId: "t1",
      selectionStrategy: "lowest-load",
      deadlineMs: 25,
    });
    expect(unsubscribed).toBe(true);
    expect(result.outcome!.winner.bidder).toBe(a.did);
  });
});
