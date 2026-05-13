/**
 * F-13 follow-up: dispatch lifecycle integration test against live NATS.
 *
 * Exercises the F-020 emitter + subscriber pair end-to-end through
 * JetStream:
 *   - createLifecycleEmitter publishes envelopes for each state
 *   - subscribeLifecycle reads them off the wildcard subject
 *   - correlation_id propagates intact through every state
 *   - subjects derive correctly per state
 *
 * Skips when NATS_URL is unset.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { defaultSovereignty, hasNats, provisionNatsStream, testPrefix, waitFor } from "./setup";
import { EnvelopeTransport } from "../../src/transport/envelope";
import { createLifecycleEmitter, subscribeLifecycle, generateCorrelationId } from "../../src/dispatch";
import type { NATSTransport } from "../../src/transport/nats";
import type { DispatchLifecycleEnvelope, LifecycleState } from "../../src/dispatch";

const ORG = "testintegration";
const SUITE = testPrefix("disp");
const STREAM = SUITE;

(hasNats ? describe : describe.skip)("F-13 dispatch lifecycle (live NATS required)", () => {
  let transport: NATSTransport;
  let cleanup: () => Promise<void>;
  let envelopeTransport: EnvelopeTransport;

  beforeAll(async () => {
    const provisioned = await provisionNatsStream({
      streamName: STREAM,
      // Stream must cover every dispatch lifecycle subject under this org.
      subjects: [`local.${ORG}.dispatch.task.>`],
    });
    transport = provisioned.transport;
    cleanup = provisioned.cleanup;
    envelopeTransport = new EnvelopeTransport({
      publisher: transport,
      subscriber: transport,
      networkSovereignty: defaultSovereignty,
    });
  });

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  it("delegate full lifecycle: received → assigned → started → progress → completed", async () => {
    const received: DispatchLifecycleEnvelope[] = [];

    const sub = await subscribeLifecycle({
      subscriber: envelopeTransport,
      org: ORG,
      handler: async (env) => {
        received.push(env);
      },
    });

    try {
      const correlation_id = generateCorrelationId();
      const task_id = `task-${SUITE.toLowerCase()}`;
      const principal = "did:mf:pilot:test";

      const emitter = createLifecycleEmitter({
        publisher: envelopeTransport,
        org: ORG,
        source: "metafactory.test.dispatch",
        sovereignty: defaultSovereignty,
      });

      await emitter.received({
        task_id, correlation_id, distribution_mode: "delegate",
        requirements: ["code-review"], target_principal: principal,
      });
      await emitter.assigned({
        task_id, correlation_id, distribution_mode: "delegate",
        principal, claimed_at: new Date().toISOString(),
      });
      await emitter.started({
        task_id, correlation_id, distribution_mode: "delegate", principal,
      });
      await emitter.progress({
        task_id, correlation_id, distribution_mode: "delegate",
        principal, message: "halfway", severity: "info", step: 1, total_steps: 2,
      });
      await emitter.completed({
        task_id, correlation_id, distribution_mode: "delegate", principal,
        duration_ms: 250,
      });

      await waitFor(() => received.length >= 5, {
        message: `expected 5 lifecycle events, got ${received.length}`,
        timeoutMs: 8_000,
      });

      // Filter to envelopes for this task (best-effort tolerance for
      // cross-suite subject overlap — there is no overlap by construction
      // because the stream is suite-scoped, but the assertion stays robust
      // in case the harness changes).
      const forTask = received.filter((e) => e.payload.task_id === task_id);
      expect(forTask).toHaveLength(5);

      const states: LifecycleState[] = ["received", "assigned", "started", "progress", "completed"];
      for (let i = 0; i < states.length; i++) {
        const state = states[i];
        const env = forTask[i];
        expect(env.type).toBe(`dispatch.task.${state}`);
        expect(env.correlation_id).toBe(correlation_id);
        expect(env.payload.distribution_mode).toBe("delegate");
      }
    } finally {
      await sub.unsubscribe();
    }
  }, 15_000);

  it("multi-state-filtered subscription drops non-matching states in-process", async () => {
    // subscribeLifecycle short-circuits to a single-state NATS subject
    // when states.length === 1 (subject-level filtering). A multi-state
    // subset hits the wildcard subscription + in-process Set filter
    // path — that's the one we want to exercise here. Pass
    // ["completed", "failed"] and assert only `completed` is delivered
    // for this task (we never emit `failed`).
    const allowed: DispatchLifecycleEnvelope[] = [];

    const sub = await subscribeLifecycle({
      subscriber: envelopeTransport,
      org: ORG,
      states: ["completed", "failed"],
      handler: async (env) => {
        allowed.push(env);
      },
    });

    try {
      const correlation_id = generateCorrelationId();
      const task_id = `task-filter-${SUITE.toLowerCase()}`;
      const principal = "did:mf:pilot:test";

      const emitter = createLifecycleEmitter({
        publisher: envelopeTransport,
        org: ORG,
        source: "metafactory.test.dispatch",
        sovereignty: defaultSovereignty,
      });

      await emitter.received({
        task_id, correlation_id, distribution_mode: "broadcast",
        requirements: ["x"],
      });
      await emitter.assigned({
        task_id, correlation_id, distribution_mode: "broadcast",
        principal, claimed_at: new Date().toISOString(),
      });
      await emitter.completed({
        task_id, correlation_id, distribution_mode: "broadcast", principal,
      });

      await waitFor(() => allowed.some((e) => e.payload.task_id === task_id), {
        message: "filtered subscriber never saw the completed event",
        timeoutMs: 8_000,
      });

      // received + assigned were emitted but the in-process Set filter
      // dropped them; only `completed` reached the handler for this task.
      const forTask = allowed.filter((e) => e.payload.task_id === task_id);
      expect(forTask.map((e) => e.type)).toEqual(["dispatch.task.completed"]);
    } finally {
      await sub.unsubscribe();
    }
  }, 15_000);
});
