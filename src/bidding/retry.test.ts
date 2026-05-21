import { describe, it, expect } from "bun:test";
import { RetryContext } from "./retry";
import type { BidResponse } from "./types";

function bid(bidder: string, load: number): BidResponse {
  return {
    task_id: "t1",
    bidder,
    load,
    capability_match: 0.5,
    signed_by: { method: "ed25519", identity: bidder, signature: "x", at: "2026-05-10T00:00:00Z" },
  };
}

describe("RetryContext", () => {
  it("selects initial winner", () => {
    const ctx = new RetryContext({
      bids: [bid("did:mf:a", 0.5), bid("did:mf:b", 0.1)],
      strategy: "lowest-load",
    });
    expect(ctx.selectInitial()?.winner.bidder).toBe("did:mf:b");
    expect(ctx.attemptCount()).toBe(0);
  });

  it("retryAfterNak picks next-best, increments attempts", () => {
    const ctx = new RetryContext({
      bids: [bid("did:mf:a", 0.5), bid("did:mf:b", 0.1), bid("did:mf:c", 0.3)],
      strategy: "lowest-load",
    });
    expect(ctx.selectInitial()?.winner.bidder).toBe("did:mf:b");
    const next = ctx.retryAfterNak("did:mf:b");
    expect(next?.winner.bidder).toBe("did:mf:c");
    expect(ctx.attemptCount()).toBe(1);
  });

  it("returns null after maxRetries exhausted", () => {
    const ctx = new RetryContext({
      bids: [bid("did:mf:a", 0.5), bid("did:mf:b", 0.1), bid("did:mf:c", 0.3)],
      strategy: "lowest-load",
      maxRetries: 2,
    });
    expect(ctx.retryAfterNak("did:mf:b")?.winner.bidder).toBe("did:mf:c");
    expect(ctx.retryAfterNak("did:mf:c")?.winner.bidder).toBe("did:mf:a");
    expect(ctx.retryAfterNak("did:mf:a")).toBeNull();
    expect(ctx.attemptCount()).toBe(2);
  });

  it("returns null when bid pool exhausted", () => {
    const ctx = new RetryContext({
      bids: [bid("did:mf:a", 0.1)],
      strategy: "lowest-load",
    });
    ctx.selectInitial();
    expect(ctx.retryAfterNak("did:mf:a")).toBeNull();
  });

  it("excludedPrincipals tracks naks", () => {
    const ctx = new RetryContext({
      bids: [bid("did:mf:a", 0.1), bid("did:mf:b", 0.2)],
      strategy: "lowest-load",
    });
    ctx.retryAfterNak("did:mf:a");
    expect(ctx.excludedPrincipals()).toEqual(["did:mf:a"]);
  });
});
