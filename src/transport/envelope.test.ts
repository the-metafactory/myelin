import { describe, it, expect } from "bun:test";
import type { Sovereignty } from "../types";
import { EnvelopeInMemoryTransport } from "./envelope-in-memory";
import type { EnvelopePublishInput } from "./types";

const defaultSovereignty: Sovereignty = {
  classification: "local",
  data_residency: "CH",
  max_hop: 0,
  frontier_ok: true,
  model_class: "any",
};

function makeTransport(opts?: {
  agentSovereignty?: Partial<Sovereignty>;
}) {
  return new EnvelopeInMemoryTransport({
    networkSovereignty: defaultSovereignty,
    agentSovereignty: opts?.agentSovereignty,
  });
}

const validInput: EnvelopePublishInput = {
  source: "metafactory.grove.bot-01",
  type: "review.completed",
  payload: { pr: 42, verdict: "approved" },
};

describe("EnvelopeTransport — sovereignty merge", () => {
  it("uses network defaults when no overrides", async () => {
    const t = makeTransport();
    await t.publish(validInput);
    const env = t.envelopes[0]!;
    expect(env.sovereignty.classification).toBe("local");
    expect(env.sovereignty.data_residency).toBe("CH");
    expect(env.sovereignty.model_class).toBe("any");
  });

  it("agent override merges over network defaults", async () => {
    const t = makeTransport({ agentSovereignty: { frontier_ok: false, model_class: "local-only" } });
    await t.publish(validInput);
    const env = t.envelopes[0]!;
    expect(env.sovereignty.frontier_ok).toBe(false);
    expect(env.sovereignty.model_class).toBe("local-only");
    expect(env.sovereignty.classification).toBe("local");
  });

  it("per-message override merges over agent+network", async () => {
    const t = makeTransport({ agentSovereignty: { frontier_ok: false } });
    await t.publish({
      ...validInput,
      sovereignty: { classification: "federated", max_hop: 2 },
    });
    const env = t.envelopes[0]!;
    expect(env.sovereignty.classification).toBe("federated");
    expect(env.sovereignty.max_hop).toBe(2);
    expect(env.sovereignty.frontier_ok).toBe(false);
  });
});

describe("EnvelopeTransport — envelope creation", () => {
  it("creates valid envelope with UUID and timestamp", async () => {
    const t = makeTransport();
    await t.publish(validInput);
    const env = t.envelopes[0]!;
    expect(env.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(env.source).toBe("metafactory.grove.bot-01");
    expect(env.type).toBe("review.completed");
    expect(new Date(env.timestamp).getTime()).not.toBeNaN();
    expect(env.payload).toEqual({ pr: 42, verdict: "approved" });
  });

  it("includes correlation_id when provided", async () => {
    const t = makeTransport();
    await t.publish({ ...validInput, correlation_id: "550e8400-e29b-41d4-a716-446655440000" });
    expect(t.envelopes[0]!.correlation_id).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("includes extensions", async () => {
    const t = makeTransport();
    await t.publish({ ...validInput, extensions: { network_id: "mf", actor: { type: "agent", id: "bot-01" } } });
    expect(t.envelopes[0]!.extensions?.network_id).toBe("mf");
  });
});

describe("EnvelopeTransport — validation", () => {
  it("throws on invalid source pattern", async () => {
    const t = makeTransport();
    await expect(t.publish({ ...validInput, source: "bad" })).rejects.toThrow("source");
  });

  it("throws on invalid sovereignty classification via message override", async () => {
    const t = makeTransport();
    await expect(
      t.publish({ ...validInput, sovereignty: { classification: "secret" as any } }),
    ).rejects.toThrow("classification");
  });
});

describe("EnvelopeTransport — subject derivation", () => {
  it("derives local subject: local.{org}.{type}", async () => {
    const t = makeTransport();
    await t.publish(validInput);
    expect(t.published[0]!.subject).toBe("local.metafactory.review.completed");
  });

  it("derives public subject without org", async () => {
    const t = makeTransport();
    await t.publish({
      ...validInput,
      sovereignty: { classification: "public" },
    });
    expect(t.published[0]!.subject).toBe("public.review.completed");
  });

  it("uses override subject when provided", async () => {
    const t = makeTransport();
    await t.publish(validInput, "local.metafactory.custom.subject");
    expect(t.published[0]!.subject).toBe("local.metafactory.custom.subject");
  });

  it("throws when override subject misaligns with classification", async () => {
    const t = makeTransport();
    await expect(
      t.publish(validInput, "federated.metafactory.review.completed"),
    ).rejects.toThrow("misalignment");
  });
});

describe("EnvelopeTransport — subscribe + close", () => {
  it("subscribe registers handler on underlying transport", async () => {
    const t = makeTransport();
    const sub = await t.subscribe("local.metafactory.test.>", async () => {});
    expect(sub).toBeDefined();
    expect(typeof sub.unsubscribe).toBe("function");
  });

  it("close delegates to underlying publisher and subscriber", async () => {
    const t = makeTransport();
    await t.close();
  });

  it("delivers envelope through subscribe → handler pipeline", async () => {
    const t = makeTransport();
    const received: any[] = [];

    await t.subscribe("local.metafactory.review.completed", async (env) => {
      received.push(env);
    });

    await t.publish(validInput);
    const { subject, envelope } = t.published[0]!;
    await t.memSubscriber.deliver(subject, envelope);

    expect(received.length).toBe(1);
    expect(received[0].payload).toEqual({ pr: 42, verdict: "approved" });
  });
});

describe("EnvelopeTransport — performance", () => {
  it("1000 publishes complete in <2s", async () => {
    const t = makeTransport();
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      await t.publish({ ...validInput, payload: { i } });
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(2000);
    expect(t.envelopes.length).toBe(1000);
  });
});
