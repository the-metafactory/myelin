import { describe, it, expect } from "bun:test";
import { selectWinner } from "./selection";
import type { BidResponse } from "./types";

function bid(bidder: string, load: number, capability_match = 0.5, cost?: number): BidResponse {
  return {
    task_id: "t1",
    bidder,
    load,
    capability_match,
    ...(cost !== undefined ? { cost } : {}),
    signed_by: { method: "ed25519", identity: bidder, signature: "x", at: "2026-05-10T00:00:00Z" },
  };
}

describe("selectWinner — lowest-load", () => {
  it("picks min load", () => {
    const result = selectWinner([bid("did:mf:a", 0.5), bid("did:mf:b", 0.1), bid("did:mf:c", 0.3)], "lowest-load");
    expect(result?.winner.bidder).toBe("did:mf:b");
    expect(result?.reason).toContain("lowest-load");
  });

  it("first-bid wins on tie (stable)", () => {
    const result = selectWinner([bid("did:mf:a", 0.2), bid("did:mf:b", 0.2)], "lowest-load");
    expect(result?.winner.bidder).toBe("did:mf:a");
  });

  it("returns null on empty pool", () => {
    expect(selectWinner([], "lowest-load")).toBeNull();
  });
});

describe("selectWinner — lowest-cost", () => {
  it("picks min cost", () => {
    const result = selectWinner(
      [bid("did:mf:a", 0.5, 0.5, 1.0), bid("did:mf:b", 0.5, 0.5, 0.3), bid("did:mf:c", 0.5, 0.5, 0.7)],
      "lowest-cost",
    );
    expect(result?.winner.bidder).toBe("did:mf:b");
  });

  it("skips bids without cost", () => {
    const result = selectWinner(
      [bid("did:mf:a", 0.5, 0.5), bid("did:mf:b", 0.5, 0.5, 0.7)],
      "lowest-cost",
    );
    expect(result?.winner.bidder).toBe("did:mf:b");
  });

  it("returns null when no bid has cost", () => {
    const result = selectWinner([bid("did:mf:a", 0.5), bid("did:mf:b", 0.5)], "lowest-cost");
    expect(result).toBeNull();
  });
});

describe("selectWinner — highest-match", () => {
  it("picks max capability_match", () => {
    const result = selectWinner(
      [bid("did:mf:a", 0.5, 0.4), bid("did:mf:b", 0.5, 0.9), bid("did:mf:c", 0.5, 0.7)],
      "highest-match",
    );
    expect(result?.winner.bidder).toBe("did:mf:b");
  });

  it("first-bid wins on tie", () => {
    const result = selectWinner([bid("did:mf:a", 0.5, 0.7), bid("did:mf:b", 0.5, 0.7)], "highest-match");
    expect(result?.winner.bidder).toBe("did:mf:a");
  });
});

describe("selectWinner — exclusion", () => {
  it("skips excluded bidders", () => {
    const result = selectWinner(
      [bid("did:mf:a", 0.1), bid("did:mf:b", 0.2), bid("did:mf:c", 0.3)],
      "lowest-load",
      new Set(["did:mf:a"]),
    );
    expect(result?.winner.bidder).toBe("did:mf:b");
  });

  it("returns null when all excluded", () => {
    const result = selectWinner([bid("did:mf:a", 0.1)], "lowest-load", new Set(["did:mf:a"]));
    expect(result).toBeNull();
  });
});
