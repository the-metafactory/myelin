import { describe, it, expect } from "bun:test";
import type {
  SelectionStrategy,
  BidRequest,
  BidResponse,
  TaskAssignment,
  BidLifecycleEventType,
} from "./types";
import { DEFAULT_BID_TIMEOUT_MS, MAX_WINNER_RETRIES } from "./types";

describe("bidding types", () => {
  it("DEFAULT_BID_TIMEOUT_MS is 2000", () => {
    expect(DEFAULT_BID_TIMEOUT_MS).toBe(2000);
  });

  it("MAX_WINNER_RETRIES is 2", () => {
    expect(MAX_WINNER_RETRIES).toBe(2);
  });

  it("SelectionStrategy union has 3 variants", () => {
    const strategies: SelectionStrategy[] = ["lowest-load", "lowest-cost", "highest-match"];
    expect(strategies.length).toBe(3);
  });

  it("BidRequest accepts the spec shape", () => {
    const req: BidRequest = {
      task_id: "abc",
      requirements: ["code-review"],
      priority: 5,
      bid_timeout_ms: 2000,
      selection_strategy: "lowest-load",
      reply_to: "_INBOX.x",
      task_summary: "review PR",
    };
    expect(req.requirements.length).toBe(1);
  });

  it("BidResponse + TaskAssignment + BidLifecycleEventType compile", () => {
    const resp: BidResponse = {
      task_id: "abc",
      bidder: "did:mf:luna",
      load: 0.2,
      capability_match: 0.9,
      signed_by: { method: "ed25519", principal: "did:mf:luna", signature: "x", at: "2026-05-10T00:00:00Z" },
    };
    const assignment: TaskAssignment = {
      task_id: "abc",
      winner: "did:mf:luna",
      payload: {},
      bid_round: { participants: 2, selection_reason: "lowest-load: 0.20" },
    };
    const events: BidLifecycleEventType[] = ["bid-opened", "bid-received", "bid-closed", "bid-retry", "bid-assigned"];
    expect(resp.bidder).toBe("did:mf:luna");
    expect(assignment.winner).toBe("did:mf:luna");
    expect(events.length).toBe(5);
  });
});
