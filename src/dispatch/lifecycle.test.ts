import { describe, it, expect } from "bun:test";
import {
  generateCorrelationId,
  isValidCorrelationId,
  deriveLifecycleSubject,
  deriveLifecycleWildcard,
  lifecycleSubjectAndType,
  validateEmissionRules,
  createLifecycleEmitter,
  subscribeLifecycle,
  getEventsStreamConfig,
  STATE_TO_TYPE,
  type LifecycleState,
  type DispatchLifecycleEnvelope,
} from "./index";
import { TestEnvelopeTransport } from "../transport/test-envelope-transport";
import { EnvelopeTransport } from "../transport/envelope";
import { InMemoryTransport } from "../transport/in-memory";
import type { Sovereignty } from "../types";

const sovereignty: Sovereignty = {
  classification: "local",
  data_residency: "CH",
  max_hop: 0,
  frontier_ok: false,
  model_class: "any",
};

describe("correlation utilities", () => {
  it("generateCorrelationId produces valid UUIDs", () => {
    for (let i = 0; i < 5; i++) {
      const id = generateCorrelationId();
      expect(isValidCorrelationId(id)).toBe(true);
    }
  });

  it("isValidCorrelationId rejects non-UUID", () => {
    expect(isValidCorrelationId("not-a-uuid")).toBe(false);
    expect(isValidCorrelationId("550e8400-e29b-41d4-a716-44665544000")).toBe(false); // too short
    expect(isValidCorrelationId("")).toBe(false);
    expect(isValidCorrelationId("zzzzzzzz-e29b-41d4-a716-446655440000")).toBe(false);
  });

  it("isValidCorrelationId accepts canonical UUID v4", () => {
    expect(isValidCorrelationId("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  });
});

describe("subject derivation", () => {
  it("derives all 7 lifecycle subjects", () => {
    const states: LifecycleState[] = ["received", "assigned", "started", "progress", "completed", "failed", "aborted"];
    for (const state of states) {
      expect(deriveLifecycleSubject("metafactory", state)).toBe(`local.metafactory.dispatch.task.${state}`);
    }
  });

  it("wildcard subject covers all dispatch.task.*", () => {
    expect(deriveLifecycleWildcard("metafactory")).toBe("local.metafactory.dispatch.task.>");
  });

  it("STATE_TO_TYPE maps every state", () => {
    expect(STATE_TO_TYPE.received).toBe("dispatch.task.received");
    expect(STATE_TO_TYPE.aborted).toBe("dispatch.task.aborted");
  });

  // myelin#143 — subject+type pairing helper. Consumers stop carrying a
  // second source of truth for the `dispatch.task.{state}` envelope type.
  it("lifecycleSubjectAndType bundles subject and type for every state", () => {
    const states: LifecycleState[] = ["received", "assigned", "started", "progress", "completed", "failed", "aborted"];
    for (const state of states) {
      const pair = lifecycleSubjectAndType("metafactory", state);
      expect(pair.subject).toBe(deriveLifecycleSubject("metafactory", state));
      expect(pair.subject).toBe(`local.metafactory.dispatch.task.${state}`);
      expect(pair.type).toBe(STATE_TO_TYPE[state]);
      expect(pair.type).toBe(`dispatch.task.${state}`);
    }
  });

  // myelin#154 — stack-aware 6-segment forms. Default cases above prove
  // legacy bit-identical behaviour; these prove the stack slot.
  it("derives 6-segment lifecycle subjects when stack is supplied", () => {
    const states: LifecycleState[] = ["received", "assigned", "started", "progress", "completed", "failed", "aborted"];
    for (const state of states) {
      expect(deriveLifecycleSubject("metafactory", state, "default")).toBe(
        `local.metafactory.default.dispatch.task.${state}`,
      );
      expect(deriveLifecycleSubject("metafactory", state, "research")).toBe(
        `local.metafactory.research.dispatch.task.${state}`,
      );
    }
  });

  it("derives 6-segment lifecycle wildcard when stack is supplied", () => {
    expect(deriveLifecycleWildcard("metafactory", "default")).toBe(
      "local.metafactory.default.dispatch.task.>",
    );
    expect(deriveLifecycleWildcard("metafactory", "research")).toBe(
      "local.metafactory.research.dispatch.task.>",
    );
  });

  it("lifecycleSubjectAndType propagates stack to underlying derivation", () => {
    const pair = lifecycleSubjectAndType("metafactory", "completed", "default");
    expect(pair.subject).toBe("local.metafactory.default.dispatch.task.completed");
    expect(pair.type).toBe("dispatch.task.completed");
  });

  it("stack-aware wildcard pairs with stack-aware subject (matched stack only — symmetric)", () => {
    // Cross-stack non-matching enforced in BOTH directions: a `default`
    // subscriber must not observe `research` publishes, AND a `research`
    // subscriber must not observe `default` publishes. The symmetric
    // pair is what mirrors sage's bridge isolation semantics — checking
    // only one direction would let a half-broken reverse case ship.
    const subDefault = deriveLifecycleWildcard("metafactory", "default");
    const subResearch = deriveLifecycleWildcard("metafactory", "research");
    const pubDefault = deriveLifecycleSubject("metafactory", "completed", "default");
    const pubResearch = deriveLifecycleSubject("metafactory", "completed", "research");

    const prefixDefault = subDefault.slice(0, -1);
    const prefixResearch = subResearch.slice(0, -1);

    // Same-stack pairs match.
    expect(pubDefault.startsWith(prefixDefault)).toBe(true);
    expect(pubResearch.startsWith(prefixResearch)).toBe(true);
    // Cross-stack pairs don't match — in both directions.
    expect(pubResearch.startsWith(prefixDefault)).toBe(false);
    expect(pubDefault.startsWith(prefixResearch)).toBe(false);
  });

  it("throws when stack is not a valid namespace segment", () => {
    expect(() => deriveLifecycleSubject("metafactory", "completed", "*")).toThrow(/Invalid stack segment/);
    expect(() => deriveLifecycleSubject("metafactory", "completed", ">")).toThrow(/Invalid stack segment/);
    expect(() => deriveLifecycleSubject("metafactory", "completed", "")).toThrow(/Invalid stack segment/);
    expect(() => deriveLifecycleWildcard("metafactory", "*")).toThrow(/Invalid stack segment/);
    expect(() => deriveLifecycleWildcard("metafactory", "")).toThrow(/Invalid stack segment/);
  });
});

describe("validateEmissionRules", () => {
  it("delegate-only states throw for broadcast/direct", () => {
    expect(() => { validateEmissionRules("started", "broadcast"); }).toThrow(/only valid for delegate/);
    expect(() => { validateEmissionRules("progress", "direct"); }).toThrow(/only valid for delegate/);
    expect(() => { validateEmissionRules("aborted", "broadcast"); }).toThrow(/only valid for delegate/);
  });

  it("delegate-only states pass for delegate", () => {
    expect(() => { validateEmissionRules("started", "delegate"); }).not.toThrow();
    expect(() => { validateEmissionRules("progress", "delegate"); }).not.toThrow();
    expect(() => { validateEmissionRules("aborted", "delegate"); }).not.toThrow();
  });

  it("universal states pass for all modes", () => {
    for (const mode of ["broadcast", "direct", "delegate"] as const) {
      for (const state of ["received", "assigned", "completed", "failed"] as LifecycleState[]) {
        expect(() => { validateEmissionRules(state, mode); }).not.toThrow();
      }
    }
  });
});

describe("createLifecycleEmitter — envelope emission via TestEnvelopeTransport", () => {
  function makeEmitter() {
    const transport = new TestEnvelopeTransport({ networkSovereignty: sovereignty });
    const emitter = createLifecycleEmitter({
      publisher: transport,
      org: "metafactory",
      source: "metafactory.cortex.dispatch",
      sovereignty,
    });
    return { transport, emitter };
  }
  // (Note: bun:test treats `expect(promise).rejects` as awaitable but TS
  // sees it as an expectation object — eslint/tsc 'await has no effect'
  // is a false positive. Tests pass at runtime.)

  it("received() emits to local.{org}.dispatch.task.received with full payload", async () => {
    const { transport, emitter } = makeEmitter();
    const correlation_id = generateCorrelationId();
    await emitter.received({
      task_id: "task-1",
      correlation_id,
      distribution_mode: "broadcast",
      requirements: ["code-review"],
    });
    expect(transport.published).toHaveLength(1);
    const pub = transport.published[0];
    expect(pub.subject).toBe("local.metafactory.dispatch.task.received");
    expect(pub.envelope.type).toBe("dispatch.task.received");
    expect(pub.envelope.correlation_id).toBe(correlation_id);
    expect((pub.envelope.payload as any).requirements).toEqual(["code-review"]);
    expect((pub.envelope.payload as any).timestamp).toBeDefined();
  });

  it("delegate full lifecycle preserves correlation_id across all events", async () => {
    const { transport, emitter } = makeEmitter();
    const correlation_id = generateCorrelationId();
    await emitter.received({
      task_id: "task-1", correlation_id, distribution_mode: "delegate",
      requirements: ["pr-merge"], target_principal: "did:mf:pilot",
    });
    await emitter.assigned({
      task_id: "task-1", correlation_id, distribution_mode: "delegate",
      principal: "did:mf:pilot", claimed_at: "2026-05-09T20:00:00Z",
    });
    await emitter.started({
      task_id: "task-1", correlation_id, distribution_mode: "delegate", principal: "did:mf:pilot",
    });
    await emitter.progress({
      task_id: "task-1", correlation_id, distribution_mode: "delegate",
      principal: "did:mf:pilot", message: "fan-out to Echo for review", severity: "info",
      sub_correlation_id: generateCorrelationId(),
    });
    await emitter.completed({
      task_id: "task-1", correlation_id, distribution_mode: "delegate",
      principal: "did:mf:pilot", input_tokens: 15420, output_tokens: 8200, duration_ms: 324000,
    });

    expect(transport.published).toHaveLength(5);
    for (const p of transport.published) {
      expect(p.envelope.correlation_id).toBe(correlation_id);
    }
    expect(transport.published.map(p => p.envelope.type)).toEqual([
      "dispatch.task.received",
      "dispatch.task.assigned",
      "dispatch.task.started",
      "dispatch.task.progress",
      "dispatch.task.completed",
    ]);
  });

  it("blocks delegate-only states for broadcast", async () => {
    const { emitter } = makeEmitter();
    const correlation_id = generateCorrelationId();
    await expect(emitter.started({
      task_id: "x", correlation_id, distribution_mode: "broadcast", principal: "did:mf:luna",
    })).rejects.toThrow(/only valid for delegate/);
  });

  it("progress severity surface (info|warn|escalate) flows through", async () => {
    const { transport, emitter } = makeEmitter();
    const correlation_id = generateCorrelationId();
    for (const severity of ["info", "warn", "escalate"] as const) {
      await emitter.progress({
        task_id: "task-1", correlation_id, distribution_mode: "delegate",
        principal: "did:mf:pilot", message: `${severity} update`, severity,
      });
    }
    expect(transport.published.map(p => (p.envelope.payload as any).severity)).toEqual(["info", "warn", "escalate"]);
  });

  it("failed payload includes nak_reason when supplied", async () => {
    const { transport, emitter } = makeEmitter();
    const correlation_id = generateCorrelationId();
    await emitter.failed({
      task_id: "task-1", correlation_id, distribution_mode: "broadcast",
      nak_reason: "compliance-block", error: "egress denied", retries_exhausted: false,
    });
    const payload = transport.published[0].envelope.payload as any;
    expect(payload.nak_reason).toBe("compliance-block");
  });

  it("aborted (delegate only) carries reason", async () => {
    const { transport, emitter } = makeEmitter();
    const correlation_id = generateCorrelationId();
    await emitter.aborted({
      task_id: "task-1", correlation_id, distribution_mode: "delegate",
      reason: "operator-interrupt", aborted_by: "did:mf:jcfischer",
    });
    const payload = transport.published[0].envelope.payload as any;
    expect(payload.reason).toBe("operator-interrupt");
  });

  it("auto-generates correlation_id when caller omits", async () => {
    const { transport, emitter } = makeEmitter();
    await emitter.received({
      task_id: "task-1",
      // @ts-expect-error testing missing correlation_id
      correlation_id: undefined,
      distribution_mode: "broadcast",
      requirements: [],
    });
    const id = transport.published[0].envelope.correlation_id;
    expect(id).toBeDefined();
    expect(isValidCorrelationId(id!)).toBe(true);
  });
});

describe("subscribeLifecycle — round-trip via EnvelopeTransport over InMemoryTransport", () => {
  function makeRoundTripTransport() {
    const inner = new InMemoryTransport();
    return new EnvelopeTransport({ publisher: inner, subscriber: inner, networkSovereignty: sovereignty });
  }

  it("single-state subscription receives only that state", async () => {
    const transport = makeRoundTripTransport();
    const emitter = createLifecycleEmitter({
      publisher: transport, org: "metafactory", source: "metafactory.cortex.dispatch", sovereignty,
    });
    const received: DispatchLifecycleEnvelope[] = [];
    const sub = await subscribeLifecycle({
      subscriber: transport, org: "metafactory",
      states: ["received"],
      handler: async (env) => { received.push(env); },
    });

    const correlation_id = generateCorrelationId();
    await emitter.received({ task_id: "t1", correlation_id, distribution_mode: "broadcast", requirements: [] });
    await emitter.assigned({ task_id: "t1", correlation_id, distribution_mode: "broadcast", principal: "did:mf:luna", claimed_at: "2026-05-09T20:00:00Z" });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("dispatch.task.received");
    await sub.unsubscribe();
  });

  it("wildcard subscription receives all 7 states (delegate flow)", async () => {
    const transport = makeRoundTripTransport();
    const emitter = createLifecycleEmitter({
      publisher: transport, org: "metafactory", source: "metafactory.cortex.dispatch", sovereignty,
    });
    const seen: string[] = [];
    const sub = await subscribeLifecycle({
      subscriber: transport, org: "metafactory",
      handler: async (env) => { seen.push(env.type); },
    });

    const correlation_id = generateCorrelationId();
    await emitter.received({ task_id: "t1", correlation_id, distribution_mode: "delegate", requirements: [], target_principal: "did:mf:pilot" });
    await emitter.assigned({ task_id: "t1", correlation_id, distribution_mode: "delegate", principal: "did:mf:pilot", claimed_at: "2026-05-09T20:00:00Z" });
    await emitter.started({ task_id: "t1", correlation_id, distribution_mode: "delegate", principal: "did:mf:pilot" });
    await emitter.progress({ task_id: "t1", correlation_id, distribution_mode: "delegate", principal: "did:mf:pilot", message: "ok", severity: "info" });
    await emitter.completed({ task_id: "t1", correlation_id, distribution_mode: "delegate", principal: "did:mf:pilot" });
    await emitter.failed({ task_id: "t2", correlation_id, distribution_mode: "delegate", principal: "did:mf:pilot", error: "boom", error_code: "INTERNAL", retries_exhausted: true });
    await emitter.aborted({ task_id: "t3", correlation_id, distribution_mode: "delegate", reason: "operator-interrupt", aborted_by: "did:mf:cortex" });

    expect(seen).toEqual([
      "dispatch.task.received",
      "dispatch.task.assigned",
      "dispatch.task.started",
      "dispatch.task.progress",
      "dispatch.task.completed",
      "dispatch.task.failed",
      "dispatch.task.aborted",
    ]);
    await sub.unsubscribe();
  });
});

describe("getEventsStreamConfig", () => {
  it("returns org-scoped EVENTS stream config", () => {
    const config = getEventsStreamConfig("metafactory");
    expect(config.name).toBe("EVENTS_METAFACTORY");
    expect(config.subjects).toEqual(["local.metafactory.dispatch.task.>"]);
    expect(config.retention).toBe("limits");
    expect(config.max_age).toBe(7 * 24 * 60 * 60 * 1e9);
    expect(config.storage).toBe("file");
    expect(config.discard).toBe("old");
  });

  it("sanitizes dots in org names (NATS stream names disallow `.`)", () => {
    const config = getEventsStreamConfig("hub.metafactory");
    expect(config.name).toBe("EVENTS_HUB_METAFACTORY");
    // subject keeps the dotted org for routing
    expect(config.subjects).toEqual(["local.hub.metafactory.dispatch.task.>"]);
  });

  it("two orgs in same cluster get distinct stream names (no collision)", () => {
    const a = getEventsStreamConfig("metafactory");
    const b = getEventsStreamConfig("acme");
    expect(a.name).not.toBe(b.name);
  });
});
