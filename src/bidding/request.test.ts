import { describe, it, expect } from "bun:test";
import { createBidRequest } from "./request";
import { DEFAULT_BID_TIMEOUT_MS } from "./types";

describe("createBidRequest", () => {
  it("populates defaults", () => {
    const req = createBidRequest({ requirements: ["code-review"], reply_to: "_INBOX.x" });
    expect(req.bid_timeout_ms).toBe(DEFAULT_BID_TIMEOUT_MS);
    expect(req.selection_strategy).toBe("lowest-load");
    expect(req.priority).toBe(5);
    expect(req.task_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it("preserves provided task_id", () => {
    const req = createBidRequest({ task_id: "550e8400-e29b-41d4-a716-446655440000", requirements: ["x"], reply_to: "y" });
    expect(req.task_id).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("includes task_summary when provided", () => {
    const req = createBidRequest({ requirements: ["x"], reply_to: "y", task_summary: "review PR #42" });
    expect(req.task_summary).toBe("review PR #42");
  });

  it("rejects empty requirements", () => {
    expect(() => createBidRequest({ requirements: [], reply_to: "y" })).toThrow(/requirements/);
  });

  it("rejects missing reply_to", () => {
    expect(() => createBidRequest({ requirements: ["x"], reply_to: "" })).toThrow(/reply_to/);
  });

  it("rejects non-positive timeout", () => {
    expect(() => createBidRequest({ requirements: ["x"], reply_to: "y", bid_timeout_ms: 0 })).toThrow(/bid_timeout_ms/);
    expect(() => createBidRequest({ requirements: ["x"], reply_to: "y", bid_timeout_ms: -1 })).toThrow(/bid_timeout_ms/);
  });

  it("rejects bad priority", () => {
    expect(() => createBidRequest({ requirements: ["x"], reply_to: "y", priority: -1 })).toThrow(/priority/);
    expect(() => createBidRequest({ requirements: ["x"], reply_to: "y", priority: 1.5 })).toThrow(/priority/);
  });

  it("copies requirements array (no aliasing)", () => {
    const reqs = ["a", "b"];
    const req = createBidRequest({ requirements: reqs, reply_to: "y" });
    reqs.push("c");
    expect(req.requirements).toEqual(["a", "b"]);
  });
});
