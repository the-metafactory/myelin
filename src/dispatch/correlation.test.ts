import { describe, it, expect } from "bun:test";
import {
  generateCorrelationId,
  isValidCorrelationId,
  ensureCorrelationId,
  deriveChildEnvelope,
  createReplyEnvelope,
  reconstructTrace,
  isRootOfTrace,
} from "./correlation";
import type { MyelinEnvelope } from "../types";

const sovereignty = { classification: "local" as const, data_residency: "CH", max_hop: 0, frontier_ok: false, model_class: "any" as const };

function envelope(overrides: Partial<MyelinEnvelope> = {}): MyelinEnvelope {
  return {
    id: crypto.randomUUID(),
    source: "metafactory.cortex.dispatch",
    type: "tasks.code-review",
    timestamp: "2026-05-10T10:00:00Z",
    sovereignty,
    payload: {},
    ...overrides,
  };
}

describe("generateCorrelationId / isValidCorrelationId", () => {
  it("generates a UUID", () => {
    const id = generateCorrelationId();
    expect(isValidCorrelationId(id)).toBe(true);
  });

  it("rejects non-UUID strings", () => {
    expect(isValidCorrelationId("not-a-uuid")).toBe(false);
    expect(isValidCorrelationId("")).toBe(false);
  });
});

describe("ensureCorrelationId", () => {
  it("adds correlation_id when missing", () => {
    const result = ensureCorrelationId({ source: "x" } as { source: string; correlation_id?: string });
    expect(isValidCorrelationId(result.correlation_id)).toBe(true);
  });

  it("preserves existing correlation_id", () => {
    const existing = generateCorrelationId();
    const result = ensureCorrelationId({ correlation_id: existing });
    expect(result.correlation_id).toBe(existing);
  });

  it("rejects invalid existing correlation_id", () => {
    expect(() => ensureCorrelationId({ correlation_id: "not-a-uuid" })).toThrow(/invalid correlation_id/);
  });

  it("does not mutate input when generating", () => {
    const input: { correlation_id?: string; foo: string } = { foo: "bar" };
    const result = ensureCorrelationId(input);
    expect(input.correlation_id).toBeUndefined();
    expect(result.correlation_id).toBeDefined();
    expect(result.foo).toBe("bar");
    expect(result).not.toBe(input);
  });

  it("returns a NEW object even when correlation_id is already present", () => {
    const existing = generateCorrelationId();
    const input = { correlation_id: existing, foo: "bar" };
    const result = ensureCorrelationId(input);
    expect(result).not.toBe(input);
    expect(result.correlation_id).toBe(existing);
    expect(result.foo).toBe("bar");
    // Mutating result must not affect input.
    (result as { foo: string }).foo = "mutated";
    expect(input.foo).toBe("bar");
  });
});

describe("deriveChildEnvelope", () => {
  it("propagates parent correlation_id", () => {
    const parent = envelope({ correlation_id: generateCorrelationId() });
    const child = deriveChildEnvelope(parent, { source: "metafactory.echo.review", type: "task.review.reply", sovereignty, payload: {} });
    expect(child.correlation_id).toBe(parent.correlation_id);
  });

  it("generates fresh correlation_id when parent has none", () => {
    const parent = envelope();
    expect(parent.correlation_id).toBeUndefined();
    const child = deriveChildEnvelope(parent, { source: "metafactory.echo.review", type: "task.review.reply", sovereignty, payload: {} });
    expect(child.correlation_id).toBeDefined();
    expect(isValidCorrelationId(child.correlation_id!)).toBe(true);
  });

  it("gives child a fresh id (not parent's)", () => {
    const parent = envelope({ correlation_id: generateCorrelationId() });
    const child = deriveChildEnvelope(parent, { source: "metafactory.echo.review", type: "task.review.reply", sovereignty, payload: {} });
    expect(child.id).not.toBe(parent.id);
  });

  it("does not carry parent correlation_id into input arg's overrides", () => {
    const parent = envelope({ correlation_id: generateCorrelationId() });
    const input = { source: "metafactory.echo.review", type: "task.review.reply", sovereignty, payload: { result: "ok" } };
    const child = deriveChildEnvelope(parent, input);
    expect(child.payload.result).toBe("ok");
  });
});

describe("createReplyEnvelope (alias)", () => {
  it("behaves identically to deriveChildEnvelope", () => {
    const parent = envelope({ correlation_id: generateCorrelationId() });
    const reply = createReplyEnvelope(parent, { source: "metafactory.echo.review", type: "task.review.reply", sovereignty, payload: {} });
    expect(reply.correlation_id).toBe(parent.correlation_id);
  });
});

describe("reconstructTrace", () => {
  const corr = generateCorrelationId();

  it("returns matching envelopes sorted by timestamp", () => {
    const e1 = envelope({ correlation_id: corr, timestamp: "2026-05-10T10:00:00Z", id: "a-1-1-1-1-1" });
    const e2 = envelope({ correlation_id: corr, timestamp: "2026-05-10T10:00:01Z", id: "b-2-2-2-2-2" });
    const e3 = envelope({ correlation_id: corr, timestamp: "2026-05-10T10:00:02Z", id: "c-3-3-3-3-3" });
    const trace = reconstructTrace([e3, e1, e2], corr);
    expect(trace.map((n) => n.envelope.id)).toEqual([e1.id, e2.id, e3.id]);
  });

  it("filters out non-matching correlation_id", () => {
    const other = generateCorrelationId();
    const matching = envelope({ correlation_id: corr });
    const unrelated = envelope({ correlation_id: other });
    const trace = reconstructTrace([matching, unrelated], corr);
    expect(trace).toHaveLength(1);
    expect(trace[0]!.envelope.id).toBe(matching.id);
  });

  it("filters out envelopes without correlation_id", () => {
    const matching = envelope({ correlation_id: corr });
    const orphan = envelope();
    const trace = reconstructTrace([matching, orphan], corr);
    expect(trace).toHaveLength(1);
  });

  it("preserves input order on equal timestamps (stable sort)", () => {
    const t = "2026-05-10T10:00:00Z";
    const e1 = envelope({ correlation_id: corr, timestamp: t });
    const e2 = envelope({ correlation_id: corr, timestamp: t });
    const e3 = envelope({ correlation_id: corr, timestamp: t });
    const trace = reconstructTrace([e3, e1, e2], corr);
    expect(trace.map((n) => n.envelope.id)).toEqual([e3.id, e1.id, e2.id]);
  });

  it("returns empty array when no matches", () => {
    expect(reconstructTrace([envelope()], corr)).toEqual([]);
  });

  it("rejects invalid correlation_id", () => {
    expect(() => reconstructTrace([], "not-a-uuid")).toThrow(/invalid correlation_id/);
  });

  it("assigns sequential index to nodes after sorting", () => {
    const e1 = envelope({ correlation_id: corr, timestamp: "2026-05-10T10:00:00Z" });
    const e2 = envelope({ correlation_id: corr, timestamp: "2026-05-10T10:00:01Z" });
    const trace = reconstructTrace([e2, e1], corr);
    expect(trace[0]!.index).toBe(0);
    expect(trace[1]!.index).toBe(1);
  });
});

describe("isRootOfTrace", () => {
  it("returns true when envelope has no correlation_id", () => {
    expect(isRootOfTrace(envelope(), [])).toBe(true);
  });

  it("returns true when envelope is the earliest in its trace", () => {
    const corr = generateCorrelationId();
    const e1 = envelope({ correlation_id: corr, timestamp: "2026-05-10T10:00:00Z" });
    const e2 = envelope({ correlation_id: corr, timestamp: "2026-05-10T10:00:01Z" });
    expect(isRootOfTrace(e1, [e1, e2])).toBe(true);
  });

  it("returns false when envelope is not earliest", () => {
    const corr = generateCorrelationId();
    const e1 = envelope({ correlation_id: corr, timestamp: "2026-05-10T10:00:00Z" });
    const e2 = envelope({ correlation_id: corr, timestamp: "2026-05-10T10:00:01Z" });
    expect(isRootOfTrace(e2, [e1, e2])).toBe(false);
  });

  it("returns false when envelope's correlation_id has no matches in collection", () => {
    const orphan = envelope({ correlation_id: generateCorrelationId() });
    expect(isRootOfTrace(orphan, [])).toBe(false);
  });
});
