import { describe, it, expect } from "bun:test";
import { utils, getPublicKeyAsync } from "@noble/ed25519";
import { verifyEnvelopeIdentity } from "../identity/verify";
import { createInMemoryRegistry } from "../identity/registry";
import type { MyelinEnvelope, Sovereignty } from "../types";
import { TestEnvelopeTransport } from "./test-envelope-transport";
import { InMemoryTransport } from "./in-memory";
import { EnvelopeTransport } from "./envelope";
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
  stack?: string;
}) {
  return new TestEnvelopeTransport({
    networkSovereignty: defaultSovereignty,
    agentSovereignty: opts?.agentSovereignty,
    ...(opts?.stack !== undefined && { stack: opts.stack }),
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
    const env = t.envelopes[0];
    expect(env.sovereignty.classification).toBe("local");
    expect(env.sovereignty.data_residency).toBe("CH");
    expect(env.sovereignty.model_class).toBe("any");
  });

  it("agent override merges over network defaults", async () => {
    const t = makeTransport({ agentSovereignty: { frontier_ok: false, model_class: "local-only" } });
    await t.publish(validInput);
    const env = t.envelopes[0];
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
    const env = t.envelopes[0];
    expect(env.sovereignty.classification).toBe("federated");
    expect(env.sovereignty.max_hop).toBe(2);
    expect(env.sovereignty.frontier_ok).toBe(false);
  });
});

describe("EnvelopeTransport — envelope creation", () => {
  it("creates valid envelope with UUID and timestamp", async () => {
    const t = makeTransport();
    await t.publish(validInput);
    const env = t.envelopes[0];
    expect(env.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(env.source).toBe("metafactory.grove.bot-01");
    expect(env.type).toBe("review.completed");
    expect(new Date(env.timestamp).getTime()).not.toBeNaN();
    expect(env.payload).toEqual({ pr: 42, verdict: "approved" });
  });

  it("includes correlation_id when provided", async () => {
    const t = makeTransport();
    await t.publish({ ...validInput, correlation_id: "550e8400-e29b-41d4-a716-446655440000" });
    expect(t.envelopes[0].correlation_id).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("includes extensions", async () => {
    const t = makeTransport();
    await t.publish({ ...validInput, extensions: { network_id: "mf", actor: { type: "agent", id: "bot-01" } } });
    expect(t.envelopes[0].extensions?.network_id).toBe("mf");
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
    expect(t.published[0].subject).toBe("local.metafactory.review.completed");
  });

  it("derives public subject without org", async () => {
    const t = makeTransport();
    await t.publish({
      ...validInput,
      sovereignty: { classification: "public" },
    });
    expect(t.published[0].subject).toBe("public.review.completed");
  });

  it("uses override subject when provided", async () => {
    const t = makeTransport();
    await t.publish(validInput, "local.metafactory.custom.subject");
    expect(t.published[0].subject).toBe("local.metafactory.custom.subject");
  });

  it("throws when override subject misaligns with classification", async () => {
    const t = makeTransport();
    await expect(
      t.publish(validInput, "federated.metafactory.review.completed"),
    ).rejects.toThrow("misalignment");
  });

  // myelin#155 — stack-aware derivation fallback. When the transport is
  // constructed with a `stack`, the fallback subject (when no override is
  // supplied) lands on the canonical 6-segment grammar matching
  // post-myelin#113 subscribers. Omitting `stack` preserves the legacy
  // 5-segment behaviour for callers that haven't wired stack identity.
  it("derives 6-segment subject when stack option is set (myelin#155)", async () => {
    const t = makeTransport({ stack: "research" });
    await t.publish(validInput);
    expect(t.published[0].subject).toBe(
      "local.metafactory.research.review.completed",
    );
  });

  it("derives 5-segment subject when stack option is omitted (legacy compat)", async () => {
    const t = makeTransport();
    await t.publish(validInput);
    expect(t.published[0].subject).toBe(
      "local.metafactory.review.completed",
    );
  });

  it("passes stack through to validateSubjectEnvelopeAlignment on override path", async () => {
    // When stack is configured and an explicit subject is supplied,
    // alignment validation uses the stack so the wire-form detector can
    // disambiguate stack-aware subjects (envelope.ts:515). Stack-aware
    // override should accept; classification-mismatched override should
    // still reject regardless of stack.
    const t = makeTransport({ stack: "research" });
    await t.publish(
      validInput,
      "local.metafactory.research.review.completed",
    );
    expect(t.published[0].subject).toBe(
      "local.metafactory.research.review.completed",
    );
    await expect(
      t.publish(validInput, "federated.metafactory.research.review.completed"),
    ).rejects.toThrow("misalignment");
  });

  it("disambiguates the stack-vs-type collision case via stack arg (envelope.ts:508-514)", async () => {
    // The motivating case the upstream `validateSubjectEnvelopeAlignment`
    // docstring calls out: `stack="review"` + envelope `type="review.completed"`.
    // The wire-form detector heuristic cannot tell `local.{org}.review.review.completed`
    // apart from `local.{org}.review.completed` (legacy 5-seg) without the
    // stack hint. Passing `stack` lets it correctly classify the 6-seg form
    // and accept the override. If the transport silently dropped `stack`
    // here, the validator would mis-classify and either misalign or false-
    // reject — neither would surface as a test failure with the prior cases.
    const t = makeTransport({ stack: "review" });
    await t.publish(
      validInput,
      "local.metafactory.review.review.completed",
    );
    expect(t.published[0].subject).toBe(
      "local.metafactory.review.review.completed",
    );
  });
});

describe("EnvelopeTransport — subscribe + close", () => {
  it("subscribe registers handler on underlying transport", async () => {
    const t = makeTransport();
    const sub = await t.subscribe("local.metafactory.test.>", async () => {});
    expect(sub).toBeDefined();
    expect(typeof sub.unsubscribe).toBe("function");
  });

  it("close is idempotent and finalizes transport", async () => {
    const t = makeTransport();
    await t.publish(validInput);
    expect(t.envelopes.length).toBe(1);
    await t.close();
    await t.close(); // idempotent — no throw
    expect(t.envelopes.length).toBe(1); // no new activity after close
  });

  it("delivers envelope through subscribe → handler pipeline", async () => {
    const t = makeTransport();
    const received: any[] = [];

    await t.subscribe("local.metafactory.review.completed", async (env) => {
      received.push(env);
    });

    await t.publish(validInput);
    const { subject, envelope } = t.published[0];
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

describe("EnvelopeTransport — identity signing", () => {
  it("publishes unsigned when no identity configured", async () => {
    const t = makeTransport();
    await t.publish(validInput);
    expect(t.envelopes[0].signed_by).toBeUndefined();
  });

  it("signs envelope when identity is configured", async () => {
    const privKey = utils.randomSecretKey();
    const privKeyB64 = Buffer.from(privKey).toString("base64");

    const t = new TestEnvelopeTransport({
      networkSovereignty: defaultSovereignty,
      identity: { did: "did:mf:test-bot", privateKey: privKeyB64 },
    });
    await t.publish(validInput);

    const env = t.envelopes[0];
    expect(env.signed_by).toBeDefined();
    expect(env.signed_by![0].method).toBe("ed25519");
    expect(env.signed_by![0].principal).toBe("did:mf:test-bot");
  });

  it("signed envelope verifies against registry", async () => {
    const privKey = utils.randomSecretKey();
    const pubKey = await getPublicKeyAsync(privKey);
    const privKeyB64 = Buffer.from(privKey).toString("base64");
    const pubKeyB64 = Buffer.from(pubKey).toString("base64");

    const t = new TestEnvelopeTransport({
      networkSovereignty: defaultSovereignty,
      identity: { did: "did:mf:test-bot", privateKey: privKeyB64 },
    });
    await t.publish(validInput);

    const registry = createInMemoryRegistry();
    registry.add({
      id: "did:mf:test-bot",
      display_name: "Test Bot",
      network: "OP_TEST",
      public_key: pubKeyB64,
      type: "agent",
      created_at: new Date().toISOString(),
    });

    const result = await verifyEnvelopeIdentity(t.envelopes[0], registry);
    expect(result.status).toBe("verified");
  });

  it("preserves validation — invalid source still throws with identity", async () => {
    const privKey = utils.randomSecretKey();
    const privKeyB64 = Buffer.from(privKey).toString("base64");

    const t = new TestEnvelopeTransport({
      networkSovereignty: defaultSovereignty,
      identity: { did: "did:mf:test-bot", privateKey: privKeyB64 },
    });
    await expect(t.publish({ ...validInput, source: "bad" })).rejects.toThrow("source");
  });

  it("throws when signing fails at runtime (bad key in identity)", async () => {
    const shortKey = Buffer.from(new Uint8Array(16)).toString("base64");

    const t = new TestEnvelopeTransport({
      networkSovereignty: defaultSovereignty,
      identity: { did: "did:mf:test-bot", privateKey: shortKey },
    });
    await expect(t.publish(validInput)).rejects.toThrow("expected 32-byte");
    expect(t.envelopes.length).toBe(0);
  });

  it("throws when identity has invalid DID", async () => {
    const privKey = utils.randomSecretKey();
    const privKeyB64 = Buffer.from(privKey).toString("base64");

    const t = new TestEnvelopeTransport({
      networkSovereignty: defaultSovereignty,
      identity: { did: "not-a-did", privateKey: privKeyB64 },
    });
    await expect(t.publish(validInput)).rejects.toThrow("Invalid principal DID");
    expect(t.envelopes.length).toBe(0);
  });
});

// myelin#154 — backward-compat normalisation gate at the subscribe layer.
// `EnvelopeTransport.subscribe` opts into a dual subscription on the
// derived 5-segment counterpart of a stack-aware pattern, so legacy
// publishers stay observable through the migration window (spec rule
// MV-3). Tests use `InMemoryTransport` directly because it implements
// NATS-style wildcard matching via `subjectMatchesPattern` — the
// `TestEnvelopeTransport`'s sub-fixture stores handlers under literal
// pattern keys, which can't model the publisher-side concrete subject
// vs. subscriber-side wildcard pattern asymmetry these tests need.
describe("EnvelopeTransport — dualSubscribeLegacy (myelin#154)", () => {
  function makeTransport(): {
    transport: EnvelopeTransport;
    bus: InMemoryTransport;
  } {
    const bus = new InMemoryTransport();
    const transport = new EnvelopeTransport({
      publisher: bus,
      subscriber: bus,
      networkSovereignty: defaultSovereignty,
    });
    return { transport, bus };
  }

  function makeEnvelope(payload: Record<string, unknown> = { pr: 1 }): MyelinEnvelope {
    return {
      id: "00000000-0000-4000-8000-000000000000",
      source: "metafactory.test.fixture",
      type: "code.pr.review.approved",
      timestamp: new Date().toISOString(),
      sovereignty: defaultSovereignty,
      payload,
    };
  }

  it("when flag is true and stack is `default`, dual-subscribes the legacy 5-seg form", async () => {
    const { transport, bus } = makeTransport();

    const received: MyelinEnvelope[] = [];
    await transport.subscribe(
      "local.metafactory.default.code.pr.>",
      async (env) => { received.push(env); },
      { dualSubscribeLegacy: true },
    );

    // Stack-aware (6-seg) publish reaches the primary subscription via
    // wildcard match `local.metafactory.default.code.pr.>`.
    await bus.publish(
      "local.metafactory.default.code.pr.review.approved",
      makeEnvelope({ pr: 1 }),
    );
    expect(received.length).toBe(1);
    expect(received[0].payload).toEqual({ pr: 1 });

    // Legacy (5-seg) publish reaches the derived secondary subscription
    // (`local.metafactory.code.pr.>`) — the bridge the spec mandates.
    await bus.publish(
      "local.metafactory.code.pr.review.approved",
      makeEnvelope({ pr: 2 }),
    );
    expect(received.length).toBe(2);
    expect(received[1].payload).toEqual({ pr: 2 });
  });

  it("when flag is false, only the primary stack-aware subscription fires", async () => {
    const { transport, bus } = makeTransport();

    const received: MyelinEnvelope[] = [];
    await transport.subscribe(
      "local.metafactory.default.code.pr.>",
      async (env) => { received.push(env); },
      // Flag omitted: classic single-subscription behavior — no bridge.
    );

    await bus.publish(
      "local.metafactory.default.code.pr.review.approved",
      makeEnvelope(),
    );
    expect(received.length).toBe(1);

    // Legacy publish is invisible because no secondary subscription exists.
    await bus.publish(
      "local.metafactory.code.pr.review.approved",
      makeEnvelope(),
    );
    expect(received.length).toBe(1);
  });

  it("ignores the flag for a non-`default` literal stack — no legacy traffic to bridge", async () => {
    const { transport, bus } = makeTransport();

    const received: MyelinEnvelope[] = [];
    await transport.subscribe(
      "local.metafactory.research.code.pr.>",
      async (env) => { received.push(env); },
      { dualSubscribeLegacy: true },
    );

    // Primary subscription fires for `research` stack.
    await bus.publish(
      "local.metafactory.research.code.pr.review.approved",
      makeEnvelope(),
    );
    expect(received.length).toBe(1);

    // No dual exists — legacy 5-seg publish must NOT reach this subscriber.
    // (Legacy publishers don't address `research`; the spec rule says legacy
    // maps to `default` only.)
    await bus.publish(
      "local.metafactory.code.pr.review.approved",
      makeEnvelope(),
    );
    expect(received.length).toBe(1);
  });

  it("dual-subscribes for a `*` wildcard at the stack slot", async () => {
    const { transport, bus } = makeTransport();

    const received: MyelinEnvelope[] = [];
    await transport.subscribe(
      "local.metafactory.*.code.pr.>",
      async (env) => { received.push(env); },
      { dualSubscribeLegacy: true },
    );

    // A subscriber spanning all stacks (`*`) opts in to legacy observability
    // because legacy maps to `default`, which `*` covers.
    await bus.publish(
      "local.metafactory.code.pr.review.approved",
      makeEnvelope(),
    );
    expect(received.length).toBe(1);
  });

  it("is a no-op for an already-legacy 5-seg subscribe pattern", async () => {
    const { transport, bus } = makeTransport();

    const received: MyelinEnvelope[] = [];
    await transport.subscribe(
      "local.metafactory.code.pr.>",
      async (env) => { received.push(env); },
      { dualSubscribeLegacy: true },
    );

    // Pattern has no stack slot to drop — `deriveLegacySubjectPattern` returns
    // null. Only one subscription exists; one legacy delivery, one receive.
    await bus.publish(
      "local.metafactory.code.pr.review.approved",
      makeEnvelope(),
    );
    expect(received.length).toBe(1);
  });

  it("unsubscribe tears down both primary and secondary subscriptions", async () => {
    const { transport, bus } = makeTransport();

    const received: MyelinEnvelope[] = [];
    const sub = await transport.subscribe(
      "local.metafactory.default.code.pr.>",
      async (env) => { received.push(env); },
      { dualSubscribeLegacy: true },
    );

    await bus.publish(
      "local.metafactory.default.code.pr.review.approved",
      makeEnvelope(),
    );
    await bus.publish(
      "local.metafactory.code.pr.review.approved",
      makeEnvelope(),
    );
    expect(received.length).toBe(2);

    // The composite Subscription returned by EnvelopeTransport.subscribe
    // tears down both inner subscriptions in parallel via Promise.all.
    await expect(sub.unsubscribe()).resolves.toBeUndefined();

    // After unsubscribe, neither shape reaches the handler any more.
    await bus.publish(
      "local.metafactory.default.code.pr.review.approved",
      makeEnvelope(),
    );
    await bus.publish(
      "local.metafactory.code.pr.review.approved",
      makeEnvelope(),
    );
    expect(received.length).toBe(2);
  });

  it("ensures the dual sub does NOT catch stack-aware traffic on a different stack", async () => {
    // Correctness invariant: `local.metafactory.default.code.pr.>` paired with
    // dual `local.metafactory.code.pr.>` must not over-match `research`-stack
    // 6-seg traffic, which has `research` at position 2 (not `pr`).
    const { transport, bus } = makeTransport();

    const received: MyelinEnvelope[] = [];
    await transport.subscribe(
      "local.metafactory.default.code.pr.>",
      async (env) => { received.push(env); },
      { dualSubscribeLegacy: true },
    );

    // `research` stack publish: must NOT match either primary (default-only)
    // or the derived dual (`local.metafactory.code.pr.>` requires segment 2
    // to be `code`, but here it's `research`).
    await bus.publish(
      "local.metafactory.research.code.pr.review.approved",
      makeEnvelope(),
    );
    expect(received.length).toBe(0);
  });
});
