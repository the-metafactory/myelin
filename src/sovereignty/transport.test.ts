import { describe, expect, it } from "bun:test";
import type {
  SubscribeOptions,
  Subscription,
  TransportPublisher,
  TransportSubscriber,
} from "../transport/types";
import type { MyelinEnvelope } from "../types";
import { createSovereigntyEngine } from "./engine";
import { createInMemoryPolicyStore } from "./policy-store";
import {
  SOVEREIGNTY_NAK_PREFIX_DEFAULT,
  SOVEREIGNTY_NAK_SOURCE_DEFAULT,
  SOVEREIGNTY_NAK_TYPE,
  SovereigntyBlockedError,
  createSovereignTransport,
  type SovereigntyNakDetail,
} from "./transport";
import { testPolicy as policy } from "./test-fixtures";

function envelope(
  classification: "local" | "federated" | "public",
  overrides: Partial<MyelinEnvelope> = {},
): MyelinEnvelope {
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    source: "metafactory.echo.local",
    type: "tasks.code-review",
    timestamp: "2026-05-11T12:00:00Z",
    sovereignty: {
      classification,
      data_residency: "CH",
      max_hop: 0,
      frontier_ok: false,
      model_class: "any",
    },
    payload: {},
    ...overrides,
  };
}

interface PublishCall {
  subject: string;
  envelope: MyelinEnvelope;
}

class FakeTransport implements TransportPublisher, TransportSubscriber {
  readonly published: PublishCall[] = [];
  readonly subscribers = new Map<string, (env: MyelinEnvelope) => Promise<void>>();
  readonly bestEffortSubscribers = new Map<string, (env: MyelinEnvelope) => Promise<void>>();
  closed = false;
  publishError: Error | null = null;

  async publish(subject: string, env: MyelinEnvelope): Promise<void> {
    if (this.publishError) throw this.publishError;
    this.published.push({ subject, envelope: env });
  }

  async subscribe(
    subject: string,
    handler: (env: MyelinEnvelope) => Promise<void>,
    _options?: SubscribeOptions,
  ): Promise<Subscription> {
    this.subscribers.set(subject, handler);
    return { unsubscribe: async () => { this.subscribers.delete(subject); } };
  }

  async subscribeBestEffort(
    subject: string,
    handler: (env: MyelinEnvelope) => Promise<void>,
  ): Promise<Subscription> {
    this.bestEffortSubscribers.set(subject, handler);
    return { unsubscribe: async () => { this.bestEffortSubscribers.delete(subject); } };
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  async deliver(subject: string, env: MyelinEnvelope, mode: "subscribe" | "bestEffort" = "subscribe"): Promise<void> {
    const map = mode === "subscribe" ? this.subscribers : this.bestEffortSubscribers;
    const handler = map.get(subject);
    if (!handler) throw new Error(`no handler for ${subject}`);
    await handler(env);
  }
}

function makeStack() {
  const fake = new FakeTransport();
  const engine = createSovereigntyEngine({
    policyStore: createInMemoryPolicyStore({ initial: policy }),
  });
  const sov = createSovereignTransport({
    transport: fake,
    engine,
    now: () => new Date("2026-05-11T12:00:00Z"),
  });
  return { fake, engine, sov };
}

describe("SovereignTransport.publish", () => {
  it("passes valid envelopes through to the underlying transport", async () => {
    const { fake, sov } = makeStack();
    const env = envelope("local");
    await sov.publish("local.metafactory.tasks.review", env);
    expect(fake.published.length).toBe(1);
    expect(fake.published[0]!.subject).toBe("local.metafactory.tasks.review");
    expect(fake.published[0]!.envelope).toBe(env);
  });

  it("blocks invalid egress: throws SovereigntyBlockedError + emits structured nak", async () => {
    const { fake, sov } = makeStack();
    const env = envelope("local");
    await expect(sov.publish("federated.metafactory.tasks.review", env)).rejects.toBeInstanceOf(
      SovereigntyBlockedError,
    );
    // Underlying transport saw ONLY the nak — the blocked envelope never made it.
    expect(fake.published.length).toBe(1);
    const nak = fake.published[0]!;
    expect(nak.subject).toBe(`${SOVEREIGNTY_NAK_PREFIX_DEFAULT}.egress.${env.id}`);
    expect(nak.envelope.type).toBe(SOVEREIGNTY_NAK_TYPE);
    expect(nak.envelope.source).toBe(SOVEREIGNTY_NAK_SOURCE_DEFAULT);
    expect(nak.envelope.correlation_id).toBe(env.id);
    const detail = nak.envelope.payload as unknown as SovereigntyNakDetail;
    expect(detail.type).toBe("compliance-block");
    expect(detail.code).toBe("compliance-block:classification-mismatch");
    expect(detail.direction).toBe("egress");
    expect(detail.envelope_id).toBe(env.id);
    expect(detail.subject).toBe("federated.metafactory.tasks.review");
  });

  it("SovereigntyBlockedError carries the full detail", async () => {
    const { sov } = makeStack();
    try {
      await sov.publish("federated.metafactory.tasks.review", envelope("local"));
      expect(false).toBe(true); // unreachable
    } catch (err) {
      expect(err).toBeInstanceOf(SovereigntyBlockedError);
      const e = err as SovereigntyBlockedError;
      expect(e.detail.code).toBe("compliance-block:classification-mismatch");
      expect(e.detail.direction).toBe("egress");
      expect(e.message).toContain("sovereignty-block");
    }
  });

  it("custom nakSubjectPrefix + nakSource flow into the nak envelope", async () => {
    const fake = new FakeTransport();
    const engine = createSovereigntyEngine({
      policyStore: createInMemoryPolicyStore({ initial: policy }),
    });
    const sov = createSovereignTransport({
      transport: fake,
      engine,
      nakSubjectPrefix: "_nak.test",
      nakSource: "test.engine",
      now: () => new Date("2026-05-11T12:00:00Z"),
    });
    const env = envelope("local");
    await expect(sov.publish("federated.metafactory.tasks.review", env)).rejects.toBeInstanceOf(
      SovereigntyBlockedError,
    );
    expect(fake.published[0]!.subject).toBe(`_nak.test.egress.${env.id}`);
    expect(fake.published[0]!.envelope.source).toBe("test.engine");
  });

  it("propagates underlying-transport publish failures on the allow path", async () => {
    const { fake, sov } = makeStack();
    fake.publishError = new Error("nats-down");
    await expect(sov.publish("local.metafactory.tasks.review", envelope("local"))).rejects.toThrow(
      "nats-down",
    );
  });

  it("forwards nak-publish failures to onNakPublishError without masking the block", async () => {
    const fake = new FakeTransport();
    fake.publishError = new Error("nak-publish-fail");
    const engine = createSovereigntyEngine({
      policyStore: createInMemoryPolicyStore({ initial: policy }),
    });
    const nakErrors: SovereigntyNakDetail[] = [];
    const sov = createSovereignTransport({
      transport: fake,
      engine,
      now: () => new Date("2026-05-11T12:00:00Z"),
      onNakPublishError: (_err, detail) => nakErrors.push(detail),
    });
    await expect(sov.publish("federated.metafactory.tasks.review", envelope("local"))).rejects.toBeInstanceOf(
      SovereigntyBlockedError,
    );
    expect(nakErrors.length).toBe(1);
    expect(nakErrors[0]!.code).toBe("compliance-block:classification-mismatch");
  });
});

describe("SovereignTransport.subscribe", () => {
  it("calls handler when ingress validation passes", async () => {
    const { fake, sov } = makeStack();
    const received: MyelinEnvelope[] = [];
    await sov.subscribe("federated.operator-b.tasks.review", async (env) => {
      received.push(env);
    });
    await fake.deliver(
      "federated.operator-b.tasks.review",
      envelope("federated", {
        signed_by: { method: "ed25519", principal: "did:mf:echo", signature: "x", at: "2026-05-11T12:00:00Z" },
      }),
    );
    expect(received.length).toBe(1);
  });

  it("blocks unknown principal: handler not called, structured nak emitted, onIngressBlock fires", async () => {
    const fake = new FakeTransport();
    const engine = createSovereigntyEngine({
      policyStore: createInMemoryPolicyStore({ initial: policy }),
    });
    const blocks: SovereigntyNakDetail[] = [];
    const sov = createSovereignTransport({
      transport: fake,
      engine,
      now: () => new Date("2026-05-11T12:00:00Z"),
      onIngressBlock: (detail) => blocks.push(detail),
    });
    let handlerCalls = 0;
    await sov.subscribe("federated.operator-b.tasks.review", async () => {
      handlerCalls += 1;
    });
    const blocked = envelope("federated", {
      id: "550e8400-e29b-41d4-a716-446655440111",
      signed_by: { method: "ed25519", principal: "did:mf:rogue", signature: "x", at: "2026-05-11T12:00:00Z" },
    });
    await fake.deliver("federated.operator-b.tasks.review", blocked);
    expect(handlerCalls).toBe(0);
    expect(blocks.length).toBe(1);
    expect(blocks[0]!.code).toBe("compliance-block:unknown-principal");
    expect(blocks[0]!.direction).toBe("ingress");
    // Nak envelope landed on the dedicated subject.
    const nak = fake.published.find((p) => p.subject.startsWith(`${SOVEREIGNTY_NAK_PREFIX_DEFAULT}.ingress.`));
    expect(nak).toBeDefined();
    expect(nak!.envelope.correlation_id).toBe(blocked.id);
  });

  it("returns normally on block (ack-and-drop) — does not throw", async () => {
    const { fake, sov } = makeStack();
    await sov.subscribe("federated.operator-b.tasks.review", async () => {});
    const blocked = envelope("federated", {
      signed_by: { method: "ed25519", principal: "did:mf:rogue", signature: "x", at: "2026-05-11T12:00:00Z" },
    });
    await expect(fake.deliver("federated.operator-b.tasks.review", blocked)).resolves.toBeUndefined();
  });
});

describe("SovereignTransport.subscribeBestEffort", () => {
  it("drops invalid envelopes silently — no nak, no handler", async () => {
    const fake = new FakeTransport();
    const engine = createSovereigntyEngine({
      policyStore: createInMemoryPolicyStore({ initial: policy }),
    });
    const blocks: SovereigntyNakDetail[] = [];
    const sov = createSovereignTransport({
      transport: fake,
      engine,
      now: () => new Date("2026-05-11T12:00:00Z"),
      onIngressBlock: (detail) => blocks.push(detail),
    });
    let handlerCalls = 0;
    await sov.subscribeBestEffort("federated.operator-b.tasks.review", async () => {
      handlerCalls += 1;
    });
    await fake.deliver(
      "federated.operator-b.tasks.review",
      envelope("federated", {
        signed_by: { method: "ed25519", principal: "did:mf:rogue", signature: "x", at: "2026-05-11T12:00:00Z" },
      }),
      "bestEffort",
    );
    expect(handlerCalls).toBe(0);
    expect(fake.published.length).toBe(0);
    // Observer still fires so callers can collect metrics.
    expect(blocks.length).toBe(1);
  });

  it("passes valid envelopes to the handler", async () => {
    const { fake, sov } = makeStack();
    let received = 0;
    await sov.subscribeBestEffort("federated.operator-b.tasks.review", async () => {
      received += 1;
    });
    await fake.deliver(
      "federated.operator-b.tasks.review",
      envelope("federated", {
        signed_by: { method: "ed25519", principal: "did:mf:echo", signature: "x", at: "2026-05-11T12:00:00Z" },
      }),
      "bestEffort",
    );
    expect(received).toBe(1);
  });
});

describe("SovereignTransport plumbing", () => {
  it("getEngine() returns the underlying engine", () => {
    const { engine, sov } = makeStack();
    expect(sov.getEngine()).toBe(engine);
  });

  it("close() delegates to the underlying transport", async () => {
    const { fake, sov } = makeStack();
    await sov.close();
    expect(fake.closed).toBe(true);
  });

  it("nak publish does NOT recurse through validateEgress", async () => {
    // Publish to a federated subject from a local-classified envelope —
    // would be blocked if the wrapper revalidated. The nak goes straight
    // to the underlying transport.
    const { fake, sov } = makeStack();
    const env = envelope("local");
    await expect(sov.publish("federated.metafactory.tasks.review", env)).rejects.toBeInstanceOf(
      SovereigntyBlockedError,
    );
    // Exactly one publish call hit the underlying transport: the nak itself.
    // If the wrapper had recursed, we'd either see >1 (multiple naks) or 0
    // (the nak itself getting blocked and swallowed by onNakPublishError).
    expect(fake.published.length).toBe(1);
  });
});
