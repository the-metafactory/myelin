import { describe, it, expect } from "bun:test";
import { InMemoryTransport } from "./in-memory";
import { subjectMatchesPattern } from "../subject-matching";
import type { MyelinEnvelope } from "../types";

const makeEnvelope = (overrides?: Partial<MyelinEnvelope>): MyelinEnvelope => ({
  id: crypto.randomUUID(),
  source: "metafactory.test.agent",
  type: "test.event",
  timestamp: new Date().toISOString(),
  sovereignty: {
    classification: "local",
    data_residency: "CH",
    max_hop: 0,
    frontier_ok: true,
    model_class: "any",
  },
  payload: { test: true },
  ...overrides,
});

describe("InMemoryTransport", () => {
  it("publishes and delivers to matching subscriber", async () => {
    const t = new InMemoryTransport();
    const received: MyelinEnvelope[] = [];

    await t.subscribe("local.metafactory.test.>", async (env) => {
      received.push(env);
    });

    const envelope = makeEnvelope();
    await t.publish("local.metafactory.test.event", envelope);

    expect(received.length).toBe(1);
    expect(received[0]!.id).toBe(envelope.id);
  });

  it("subscribeBestEffort works identically to subscribe", async () => {
    const t = new InMemoryTransport();
    const received: MyelinEnvelope[] = [];

    await t.subscribeBestEffort("local.>", async (env) => {
      received.push(env);
    });

    await t.publish("local.metafactory.test.event", makeEnvelope());
    expect(received.length).toBe(1);
  });

  it("does not deliver to non-matching subscriber", async () => {
    const t = new InMemoryTransport();
    const received: MyelinEnvelope[] = [];

    await t.subscribe("federated.>", async (env) => {
      received.push(env);
    });

    await t.publish("local.metafactory.test.event", makeEnvelope());
    expect(received.length).toBe(0);
  });

  it("throws on publish after close", async () => {
    const t = new InMemoryTransport();
    await t.close();
    await expect(t.publish("test", makeEnvelope())).rejects.toThrow("closed");
  });

  it("isolates subscriber failures -- handler #2 receives even if #1 throws", async () => {
    const t = new InMemoryTransport();
    let handler1Called = false;
    const received: MyelinEnvelope[] = [];

    await t.subscribe("test.>", async () => {
      handler1Called = true;
      throw new Error("handler #1 exploded");
    });

    await t.subscribe("test.>", async (env) => {
      received.push(env);
    });

    await t.publish("test.event", makeEnvelope());

    expect(handler1Called).toBe(true);
    expect(received.length).toBe(1);
  });

  it("unsubscribe removes handler", async () => {
    const t = new InMemoryTransport();
    const received: MyelinEnvelope[] = [];

    const sub = await t.subscribe("test.>", async (env) => {
      received.push(env);
    });

    await t.publish("test.event", makeEnvelope());
    expect(received.length).toBe(1);

    await sub.unsubscribe();
    await t.publish("test.event", makeEnvelope());
    expect(received.length).toBe(1);
  });
});

describe("subjectMatchesPattern", () => {
  it("exact match", () => {
    expect(subjectMatchesPattern("a.b.c", "a.b.c")).toBe(true);
  });

  it("single wildcard", () => {
    expect(subjectMatchesPattern("a.b.c", "a.*.c")).toBe(true);
    expect(subjectMatchesPattern("a.x.c", "a.*.c")).toBe(true);
  });

  it("multi-level wildcard >", () => {
    expect(subjectMatchesPattern("a.b.c.d", "a.>")).toBe(true);
    expect(subjectMatchesPattern("a.b", "a.>")).toBe(true);
  });

  it("no match", () => {
    expect(subjectMatchesPattern("a.b.c", "x.y.z")).toBe(false);
    expect(subjectMatchesPattern("a.b", "a.b.c")).toBe(false);
  });
});
