import { describe, it, expect } from "bun:test";
import { InMemoryTransport } from "./in-memory";
import { subjectMatchesPattern } from "../subject-matching";
import { JsonCodec, MsgpackCodec, buildDefaultRegistry, detectCodec } from "../serialization";
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
    expect(received[0].id).toBe(envelope.id);
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

  it("> requires at least one trailing token (NATS spec — zero-match rejected)", () => {
    // Semantic tightening from the cycle-2 unification: previously the
    // iterative transport implementation accepted "a" against "a.>" (zero
    // tokens). The promoted regex-based matcher matches NATS spec: > is
    // one-or-more, never zero.
    expect(subjectMatchesPattern("a", "a.>")).toBe(false);
  });

  it("no match", () => {
    expect(subjectMatchesPattern("a.b.c", "x.y.z")).toBe(false);
    expect(subjectMatchesPattern("a.b", "a.b.c")).toBe(false);
  });
});

describe("InMemoryTransport with codec option", () => {
  it("round-trips envelope through JsonCodec when codec set", async () => {
    const t = new InMemoryTransport({ codec: new JsonCodec() });
    const received: MyelinEnvelope[] = [];
    await t.subscribe("local.>", async (env) => { received.push(env); });

    const envelope = makeEnvelope({ payload: { hello: "world", n: 42 } });
    await t.publish("local.test.event", envelope);

    expect(received.length).toBe(1);
    expect(received[0]).toEqual(envelope);
    // round-trip means a fresh object, not the same reference
    expect(received[0]).not.toBe(envelope);
  });

  it("round-trips through MsgpackCodec and tags extensions.codec", async () => {
    const t = new InMemoryTransport({ codec: new MsgpackCodec() });
    const received: MyelinEnvelope[] = [];
    await t.subscribe("local.>", async (env) => { received.push(env); });

    const envelope = makeEnvelope({ payload: { hello: "world" } });
    await t.publish("local.test.event", envelope);

    expect(received.length).toBe(1);
    expect(received[0]?.payload).toEqual({ hello: "world" });
    expect(received[0]?.extensions?.codec).toBe("msgpack");
  });

  it("msgpack-configured registry decodes raw JSON wire bytes via detect+lookup", () => {
    // Cycle-2 fix: the previous test name claimed "rolling migration"
    // interop that the test couldn't actually exercise (a single
    // InMemoryTransport always encodes through its configured codec).
    // This rewrite directly exercises the registry+detect+decode path
    // that an msgpack-configured subscriber uses on JSON wire bytes —
    // the actual mechanism that supports a rolling JSON→msgpack
    // migration on a shared subject.
    const registry = buildDefaultRegistry(new MsgpackCodec());
    const envelope = makeEnvelope();

    const jsonBytes = new JsonCodec().encode(envelope);
    expect(detectCodec(jsonBytes)).toBe("json");
    const decodedFromJson = registry.get("json").decode(jsonBytes);
    expect(decodedFromJson).toEqual(envelope);

    const msgpackBytes = new MsgpackCodec().encode(envelope);
    expect(detectCodec(msgpackBytes)).toBe("msgpack");
    const decodedFromMsgpack = registry.get("msgpack").decode(msgpackBytes);
    expect(decodedFromMsgpack.id).toBe(envelope.id);
    expect(decodedFromMsgpack.extensions?.codec).toBe("msgpack");
  });

  it("default (no codec) passes envelope by reference", async () => {
    const t = new InMemoryTransport();
    const received: MyelinEnvelope[] = [];
    await t.subscribe("local.>", async (env) => { received.push(env); });

    const envelope = makeEnvelope();
    await t.publish("local.test.event", envelope);

    expect(received[0]).toBe(envelope);
  });
});
