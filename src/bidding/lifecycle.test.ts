import { describe, it, expect } from "bun:test";
import { createBidLifecycleEvent } from "./lifecycle";
import type { Sovereignty } from "../types";

const sovereignty: Sovereignty = {
  classification: "local",
  data_residency: "CH",
  max_hop: 0,
  frontier_ok: false,
  model_class: "any",
};

describe("createBidLifecycleEvent", () => {
  it("derives subject and emits an unsigned envelope (transport signs)", () => {
    const result = createBidLifecycleEvent({
      org: "metafactory",
      source: "metafactory.cortex.dispatch",
      sovereignty,
      type: "bid-opened",
      input: { task_id: "t1", participants: 0 },
    });
    expect(result.subject).toBe("local.metafactory.dispatch.bid.bid-opened");
    expect(result.envelope.type).toBe("dispatch.bid.bid-opened");
    expect(result.envelope.payload.task_id).toBe("t1");
    expect(result.envelope.signed_by).toBeUndefined();
  });

  it("subject sits under dispatch.bid.>, not dispatch.task.> (no F-020 collision)", () => {
    const result = createBidLifecycleEvent({
      org: "metafactory",
      source: "metafactory.cortex.dispatch",
      sovereignty,
      type: "bid-assigned",
      input: { task_id: "t1", winner: "did:mf:luna" },
    });
    expect(result.subject).toBe("local.metafactory.dispatch.bid.bid-assigned");
    expect(result.subject.startsWith("local.metafactory.dispatch.task.")).toBe(false);
  });

  it("supports all 5 lifecycle event types", () => {
    const types = ["bid-opened", "bid-received", "bid-closed", "bid-retry", "bid-assigned"] as const;
    for (const type of types) {
      const result = createBidLifecycleEvent({
        org: "metafactory",
        source: "metafactory.cortex.dispatch",
        sovereignty,
        type,
        input: { task_id: "t1" },
      });
      expect(result.envelope.type).toBe(`dispatch.bid.${type}`);
    }
  });

  it("includes optional metadata in payload", () => {
    const result = createBidLifecycleEvent({
      org: "metafactory",
      source: "metafactory.cortex.dispatch",
      sovereignty,
      type: "bid-assigned",
      input: { task_id: "t1", winner: "did:mf:luna", participants: 3, selection_reason: "lowest-load: 0.10" },
    });
    expect(result.envelope.payload.winner).toBe("did:mf:luna");
    expect(result.envelope.payload.participants).toBe(3);
    expect(result.envelope.payload.selection_reason).toBe("lowest-load: 0.10");
  });

  it("threads correlation_id when provided", () => {
    const result = createBidLifecycleEvent({
      org: "metafactory",
      source: "metafactory.cortex.dispatch",
      sovereignty,
      type: "bid-opened",
      input: { task_id: "t1" },
      correlation_id: "770e8400-e29b-41d4-a716-446655440009",
    });
    expect(result.envelope.correlation_id).toBe("770e8400-e29b-41d4-a716-446655440009");
  });
});
