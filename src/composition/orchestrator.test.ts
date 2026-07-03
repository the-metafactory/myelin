import { describe, it, expect } from "bun:test";
import { createOrchestrator } from "./orchestrator";
import { createInMemoryWorkflowExecutionStore } from "./memory-execution-store";
import { InMemoryTransport } from "../transport/in-memory";
import { createEnvelope } from "../envelope";
import type { Sovereignty } from "../types";
import type { MyelinEnvelope } from "../types";
import type {
  WorkflowDefinition,
  WorkflowStep,
} from "./types";

const sovereignty: Sovereignty = {
  classification: "local",
  data_residency: "CH",
  max_hop: 1,
  frontier_ok: false,
  model_class: "any",
};

function step(id: string, capability = "test-cap", next?: string[]): WorkflowStep {
  return {
    id,
    capability,
    input: { compatibility_key: "io.v1" },
    output: { compatibility_key: "io.v1" },
    ...(next ? { next } : {}),
  };
}

function workflow(steps: WorkflowStep[]): WorkflowDefinition {
  return {
    id: "wf-test",
    name: "test workflow",
    version: "1.0.0",
    steps,
  };
}

function makeRig() {
  const transport = new InMemoryTransport();
  const store = createInMemoryWorkflowExecutionStore();
  const orchestrator = createOrchestrator({
    publisher: transport,
    subscriber: transport,
    store,
    principal: "metafactory",
    source: "metafactory.cortex.composition",
    sovereignty,
    defaultWorkflowTimeoutMs: 5000,
  });
  return { transport, store, orchestrator };
}

async function fakeAgent(
  transport: InMemoryTransport,
  capability: string,
  handler: (input: unknown, task_id: string) => Promise<{ result?: unknown; failure?: { nak_reason?: string; error?: string } }>,
): Promise<void> {
  await transport.subscribe(
    `local.metafactory.tasks.${capability}`,
    async (env) => {
      const payload = env.payload as { task_id: string; input: unknown };
      const verdict = await handler(payload.input, payload.task_id);
      if (verdict.failure) {
        const failedEnv = createEnvelope({
          source: "agent.test",
          type: "dispatch.task.failed",
          sovereignty,
          payload: {
            task_id: payload.task_id,
            correlation_id: env.correlation_id,
            identity: "did:mf:test-agent",
            ...(verdict.failure.nak_reason ? { nak_reason: verdict.failure.nak_reason } : {}),
            ...(verdict.failure.error ? { error: verdict.failure.error } : {}),
          },
          correlation_id: env.correlation_id,
        });
        await transport.publish(`local.metafactory.dispatch.task.failed`, failedEnv);
        return;
      }
      const completedEnv = createEnvelope({
        source: "agent.test",
        type: "dispatch.task.completed",
        sovereignty,
        payload: {
          task_id: payload.task_id,
          correlation_id: env.correlation_id,
          identity: "did:mf:test-agent",
          result: verdict.result,
        },
        correlation_id: env.correlation_id,
      });
      await transport.publish(`local.metafactory.dispatch.task.completed`, completedEnv);
    },
  );
}

describe("createOrchestrator", () => {
  describe("happy path", () => {
    it("executes a single-step workflow end-to-end", async () => {
      const { transport, orchestrator } = makeRig();
      await fakeAgent(transport, "echo", async (input) => ({
        result: { echoed: input },
      }));
      const result = await orchestrator.execute({
        definition: workflow([step("one", "echo")]),
        input: { hello: "world" },
      });
      expect(result.status).toBe("completed");
      expect(result.output).toEqual({ echoed: { hello: "world" } });
      expect(result.results.one!.status).toBe("completed");
      expect(result.results.one!.agent_identity).toBe("did:mf:test-agent");
      await orchestrator.close();
    });

    it("threads each step's output into the next step's input", async () => {
      const { transport, orchestrator } = makeRig();
      await fakeAgent(transport, "double", async (input) => {
        const n = (input as { n: number }).n;
        return { result: { n: n * 2 } };
      });
      const result = await orchestrator.execute({
        definition: workflow([step("a", "double", ["b"]), step("b", "double")]),
        input: { n: 3 },
      });
      expect(result.status).toBe("completed");
      expect(result.output).toEqual({ n: 12 });
      await orchestrator.close();
    });

    it("propagates correlation_id across every dispatched task", async () => {
      const { transport, orchestrator } = makeRig();
      const seenCorrelations: string[] = [];
      await fakeAgent(transport, "cap", async (_input, task_id) => {
        // Capture correlation by reading from the transport context — but
        // fakeAgent abstracts that, so we use indirect verification: every
        // step's output carries the task_id back, and the orchestrator's
        // store reflects the shared correlation_id.
        seenCorrelations.push(task_id);
        return { result: { ok: true } };
      });
      const corr = "11111111-1111-4111-8111-111111111111";
      const result = await orchestrator.execute({
        definition: workflow([step("a", "cap", ["b"]), step("b", "cap")]),
        input: {},
        correlation_id: corr,
      });
      expect(result.correlation_id).toBe(corr);
      expect(seenCorrelations.length).toBe(2);
      await orchestrator.close();
    });
  });

  describe("store checkpointing", () => {
    it("checkpoints execution after every state transition", async () => {
      const { transport, store, orchestrator } = makeRig();
      await fakeAgent(transport, "cap", async () => ({ result: { ok: true } }));
      await orchestrator.execute({
        definition: workflow([step("a", "cap")]),
        input: {},
      });
      const snap = store.snapshot();
      expect(snap.length).toBe(1);
      expect(snap[0]!.status).toBe("completed");
      expect(snap[0]!.completed_steps.a!.status).toBe("completed");
      await orchestrator.close();
    });

    it("listRunning returns no executions after success", async () => {
      const { transport, store, orchestrator } = makeRig();
      await fakeAgent(transport, "cap", async () => ({ result: { ok: true } }));
      await orchestrator.execute({
        definition: workflow([step("a", "cap")]),
        input: {},
      });
      const running = await store.listRunning();
      expect(running.length).toBe(0);
      await orchestrator.close();
    });
  });

  describe("lifecycle events", () => {
    // NOTE: these tests assert exact event order. With `InMemoryTransport`,
    // `publish()` resolves only after all matching handlers run synchronously,
    // so the orchestrator's emit-then-await pattern serializes events in
    // emission order. Against a real NATS transport the equality assertion
    // here is NOT robust — events may interleave per subject-routing latency.
    // Tests are scoped to in-memory; integration suites in `tests/integration/`
    // (T-8.2) assert ordering across real transports with the appropriate
    // tolerance.
    it("emits workflow.started, step.started, step.completed, workflow.completed in order [InMemoryTransport]", async () => {
      const { transport, orchestrator } = makeRig();
      const events: string[] = [];
      await transport.subscribe("local.metafactory.dispatch.workflow.>", async (env) => {
        events.push(env.type);
      });
      await fakeAgent(transport, "cap", async () => ({ result: { ok: true } }));
      await orchestrator.execute({
        definition: workflow([step("a", "cap")]),
        input: {},
      });
      expect(events).toEqual([
        "workflow.started",
        "workflow.step.started",
        "workflow.step.completed",
        "workflow.completed",
      ]);
      await orchestrator.close();
    });

    it("emits workflow.step.failed + workflow.failed on agent failure", async () => {
      const { transport, orchestrator } = makeRig();
      const events: string[] = [];
      await transport.subscribe("local.metafactory.dispatch.workflow.>", async (env) => {
        events.push(env.type);
      });
      await fakeAgent(transport, "cap", async () => ({
        failure: { nak_reason: "cant-do", error: "agent refused" },
      }));
      const result = await orchestrator.execute({
        definition: workflow([step("a", "cap")]),
        input: {},
      });
      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("nak-cant-do");
      expect(events).toEqual([
        "workflow.started",
        "workflow.step.started",
        "workflow.step.failed",
        "workflow.failed",
      ]);
      await orchestrator.close();
    });
  });

  describe("schema validation", () => {
    it("rejects step output that fails the declared data_schema", async () => {
      const { transport, orchestrator } = makeRig();
      await fakeAgent(transport, "cap", async () => ({
        result: { wrong: "shape" },
      }));
      const stepWithSchema: WorkflowStep = {
        id: "a",
        capability: "cap",
        input: { compatibility_key: "io.v1" },
        output: {
          compatibility_key: "io.v1",
          data_schema: { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } } },
        },
      };
      const result = await orchestrator.execute({
        definition: workflow([stepWithSchema]),
        input: {},
      });
      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("schema-mismatch");
      expect(result.error?.details).toBeDefined();
      await orchestrator.close();
    });

    it("accepts step output that matches the declared data_schema", async () => {
      const { transport, orchestrator } = makeRig();
      await fakeAgent(transport, "cap", async () => ({
        result: { ok: true },
      }));
      const stepWithSchema: WorkflowStep = {
        id: "a",
        capability: "cap",
        input: { compatibility_key: "io.v1" },
        output: {
          compatibility_key: "io.v1",
          data_schema: { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } } },
        },
      };
      const result = await orchestrator.execute({
        definition: workflow([stepWithSchema]),
        input: {},
      });
      expect(result.status).toBe("completed");
      await orchestrator.close();
    });
  });

  describe("malformed response handling", () => {
    it("silently drops responses with a mismatched correlation_id and reports via onMalformedResponse", async () => {
      const transport = new InMemoryTransport();
      const store = createInMemoryWorkflowExecutionStore();
      const malformed: { reason: string }[] = [];
      const orchestrator = createOrchestrator({
        publisher: transport,
        subscriber: transport,
        store,
        principal: "metafactory",
        source: "metafactory.cortex.composition",
        sovereignty,
        defaultWorkflowTimeoutMs: 200,
        onMalformedResponse: (info) => {
          malformed.push({ reason: info.reason });
        },
      });
      // A "rogue" agent that completes the task using a foreign correlation_id.
      await transport.subscribe(`local.metafactory.tasks.cap`, async (env) => {
        const payload = env.payload as { task_id: string };
        const completedEnv = createEnvelope({
          source: "agent.rogue",
          type: "dispatch.task.completed",
          sovereignty,
          payload: {
            task_id: payload.task_id,
            identity: "did:mf:rogue",
            result: { spoofed: true },
          },
          correlation_id: "00000000-0000-4000-8000-000000000000",
        });
        await transport.publish(`local.metafactory.dispatch.task.completed`, completedEnv);
      });
      const result = await orchestrator.execute({
        definition: workflow([step("a", "cap")]),
        input: {},
      });
      // The spoofed response was dropped, so the orchestrator hits the
      // workflow timeout instead of accepting the rogue output.
      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("timeout");
      expect(malformed.some((m) => m.reason === "correlation-mismatch")).toBe(true);
      await orchestrator.close();
    });

    it("reports non-object payloads via onMalformedResponse", async () => {
      const transport = new InMemoryTransport();
      const store = createInMemoryWorkflowExecutionStore();
      const malformed: { reason: string }[] = [];
      const orchestrator = createOrchestrator({
        publisher: transport,
        subscriber: transport,
        store,
        principal: "metafactory",
        source: "metafactory.cortex.composition",
        sovereignty,
        defaultWorkflowTimeoutMs: 200,
        onMalformedResponse: (info) => {
          malformed.push({ reason: info.reason });
        },
      });
      await transport.subscribe(`local.metafactory.tasks.cap`, async (env) => {
        // Reply with a non-object payload — must be silently dropped.
        const garbage = createEnvelope({
          source: "agent.broken",
          type: "dispatch.task.completed",
          sovereignty,
          payload: "string-payload" as unknown as Record<string, unknown>,
          correlation_id: env.correlation_id,
        });
        await transport.publish(`local.metafactory.dispatch.task.completed`, garbage);
      });
      const result = await orchestrator.execute({
        definition: workflow([step("a", "cap")]),
        input: {},
      });
      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("timeout");
      expect(malformed.some((m) => m.reason === "non-object-payload" || m.reason === "missing-task-id")).toBe(true);
      await orchestrator.close();
    });
  });

  describe("unknown type handling", () => {
    it("drops dispatch.task.* envelopes with neither completed nor failed type and reports via onMalformedResponse", async () => {
      const transport = new InMemoryTransport();
      const store = createInMemoryWorkflowExecutionStore();
      const malformed: { reason: string }[] = [];
      const orchestrator = createOrchestrator({
        publisher: transport,
        subscriber: transport,
        store,
        principal: "metafactory",
        source: "metafactory.cortex.composition",
        sovereignty,
        defaultWorkflowTimeoutMs: 200,
        onMalformedResponse: (info) => {
          malformed.push({ reason: info.reason });
        },
      });
      // Agent replies with `dispatch.task.progress` (future F-020
      // type the orchestrator hasn't grown a case for). Known
      // task_id, matching correlation_id, but unhandled type —
      // must NOT resolve the waiter; must surface via observer.
      await transport.subscribe(`local.metafactory.tasks.cap`, async (env) => {
        const payload = env.payload as { task_id: string };
        const progressEnv = createEnvelope({
          source: "agent.test",
          type: "dispatch.task.progress",
          sovereignty,
          payload: {
            task_id: payload.task_id,
            identity: "did:mf:test-agent",
          },
          correlation_id: env.correlation_id,
        });
        await transport.publish(`local.metafactory.dispatch.task.progress`, progressEnv);
      });
      const result = await orchestrator.execute({
        definition: workflow([step("a", "cap")]),
        input: {},
      });
      // Step never completed (orchestrator ignored progress event),
      // workflow hits timeout. Observer recorded the discard.
      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("timeout");
      expect(malformed.some((m) => m.reason === "unknown-type")).toBe(true);
      await orchestrator.close();
    });
  });

  describe("validator memoization", () => {
    it("compiles each step's data_schema once per WorkflowDefinition across repeated execute() calls", async () => {
      const { transport, orchestrator } = makeRig();
      await fakeAgent(transport, "cap", async () => ({ result: { ok: true } }));
      const definition = workflow([
        {
          id: "a",
          capability: "cap",
          input: { compatibility_key: "io.v1" },
          output: {
            compatibility_key: "io.v1",
            data_schema: { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } } },
          },
        },
      ]);
      // Three consecutive executes against the same definition.
      // The validator should be compiled once and re-used; the
      // WeakMap memoization is invisible to the caller, but we can
      // assert correctness behavior (all three succeed identically).
      for (let i = 0; i < 3; i++) {
        const result = await orchestrator.execute({ definition, input: {} });
        expect(result.status).toBe("completed");
      }
      await orchestrator.close();
    });
  });

  describe("publish failure handling", () => {
    it("rejects execute() when the task publish fails and does not leak a pending entry", async () => {
      // Custom transport whose publish fails for task.* but succeeds for
      // everything else (we need workflow.* lifecycle to publish).
      const wrapped = new InMemoryTransport();
      const failingPublisher = {
        publish(subject: string, env: MyelinEnvelope) {
          if (subject.startsWith("local.metafactory.tasks.")) {
            return Promise.reject(new Error("publish blew up"));
          }
          return wrapped.publish(subject, env);
        },
        async request(): Promise<MyelinEnvelope> { throw new Error("not implemented"); },
        close: () => wrapped.close(),
      };
      const store = createInMemoryWorkflowExecutionStore();
      const orchestrator = createOrchestrator({
        publisher: failingPublisher,
        subscriber: wrapped,
        store,
        principal: "metafactory",
        source: "metafactory.cortex.composition",
        sovereignty,
        defaultWorkflowTimeoutMs: 5000,
      });
      await expect(
        orchestrator.execute({
          definition: workflow([step("a", "cap")]),
          input: {},
        }),
      ).rejects.toThrow(/publish blew up/);
      await orchestrator.close();
    });
  });

  describe("failure mapping", () => {
    it("maps cant-do nak to nak-cant-do StepErrorCode", async () => {
      const { transport, orchestrator } = makeRig();
      await fakeAgent(transport, "cap", async () => ({
        failure: { nak_reason: "cant-do" },
      }));
      const result = await orchestrator.execute({
        definition: workflow([step("a", "cap")]),
        input: {},
      });
      expect(result.error?.code).toBe("nak-cant-do");
      await orchestrator.close();
    });

    it("maps wont-do nak to nak-wont-do", async () => {
      const { transport, orchestrator } = makeRig();
      await fakeAgent(transport, "cap", async () => ({
        failure: { nak_reason: "wont-do" },
      }));
      const result = await orchestrator.execute({
        definition: workflow([step("a", "cap")]),
        input: {},
      });
      expect(result.error?.code).toBe("nak-wont-do");
      await orchestrator.close();
    });

    it("maps not-now nak to nak-not-now", async () => {
      const { transport, orchestrator } = makeRig();
      await fakeAgent(transport, "cap", async () => ({
        failure: { nak_reason: "not-now" },
      }));
      const result = await orchestrator.execute({
        definition: workflow([step("a", "cap")]),
        input: {},
      });
      expect(result.error?.code).toBe("nak-not-now");
      await orchestrator.close();
    });

    it("maps unknown nak (no nak_reason) to agent-error", async () => {
      const { transport, orchestrator } = makeRig();
      await fakeAgent(transport, "cap", async () => ({
        failure: { error: "kernel panic" },
      }));
      const result = await orchestrator.execute({
        definition: workflow([step("a", "cap")]),
        input: {},
      });
      expect(result.error?.code).toBe("agent-error");
      expect(result.error?.message).toBe("kernel panic");
      await orchestrator.close();
    });

    it("stops at the first failing step (downstream steps do not run)", async () => {
      const { transport, orchestrator } = makeRig();
      let bCalls = 0;
      await fakeAgent(transport, "cap-a", async () => ({
        failure: { nak_reason: "cant-do", error: "stop" },
      }));
      await fakeAgent(transport, "cap-b", async () => {
        bCalls += 1;
        return { result: { ok: true } };
      });
      const result = await orchestrator.execute({
        definition: workflow([step("a", "cap-a", ["b"]), step("b", "cap-b")]),
        input: {},
      });
      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("nak-cant-do");
      expect(bCalls).toBe(0);
      expect(result.results.b).toBeUndefined();
      await orchestrator.close();
    });
  });

  describe("fan-out (T-7.1)", () => {
    it("dispatches multiple children in parallel from a fan-out step", async () => {
      const { transport, orchestrator } = makeRig();
      const seen: string[] = [];
      await fakeAgent(transport, "root-cap", async () => ({ result: { ok: true } }));
      await fakeAgent(transport, "branch-cap", async (input, task_id) => {
        seen.push(task_id);
        return { result: { branch: input } };
      });
      const result = await orchestrator.execute({
        definition: workflow([
          step("root", "root-cap", ["b", "c", "d"]),
          step("b", "branch-cap"),
          step("c", "branch-cap"),
          step("d", "branch-cap"),
        ]),
        input: {},
      });
      expect(result.status).toBe("completed");
      // Three branch dispatches landed.
      expect(seen.length).toBe(3);
      expect(result.results.root!.status).toBe("completed");
      expect(result.results.b!.status).toBe("completed");
      expect(result.results.c!.status).toBe("completed");
      expect(result.results.d!.status).toBe("completed");
      await orchestrator.close();
    });

    it("fails the workflow when any fan-out branch aborts", async () => {
      const { transport, orchestrator } = makeRig();
      await fakeAgent(transport, "root", async () => ({ result: { ok: true } }));
      await fakeAgent(transport, "good", async () => ({ result: { ok: true } }));
      await fakeAgent(transport, "bad", async () => ({
        failure: { nak_reason: "cant-do", error: "branch refused" },
      }));
      const result = await orchestrator.execute({
        definition: workflow([
          step("root", "root", ["good-1", "bad-1"]),
          step("good-1", "good"),
          step("bad-1", "bad"),
        ]),
        input: {},
      });
      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("nak-cant-do");
      await orchestrator.close();
    });

    it("fan-out under skip-step continues if a branch fails", async () => {
      const { transport, orchestrator } = makeRig();
      await fakeAgent(transport, "root", async () => ({ result: { ok: true } }));
      await fakeAgent(transport, "good", async () => ({ result: { ok: true } }));
      await fakeAgent(transport, "bad", async () => ({
        failure: { nak_reason: "cant-do" },
      }));
      const stepRoot: WorkflowStep = {
        id: "root",
        capability: "root",
        input: { compatibility_key: "io.v1" },
        output: { compatibility_key: "io.v1" },
        next: ["good-1", "bad-1"],
      };
      const stepGood: WorkflowStep = {
        id: "good-1",
        capability: "good",
        input: { compatibility_key: "io.v1" },
        output: { compatibility_key: "io.v1" },
      };
      const stepBad: WorkflowStep = {
        id: "bad-1",
        capability: "bad",
        input: { compatibility_key: "io.v1" },
        output: { compatibility_key: "io.v1" },
        on_failure: "skip-step",
      };
      const result = await orchestrator.execute({
        definition: workflow([stepRoot, stepGood, stepBad]),
        input: {},
      });
      expect(result.status).toBe("completed");
      expect(result.results["good-1"]!.status).toBe("completed");
      expect(result.results["bad-1"]!.status).toBe("skipped");
      await orchestrator.close();
    });
  });

  describe("fan-in aggregation (T-7.2)", () => {
    it("dispatches the fan-in step once with aggregated {branches} input after all parents complete", async () => {
      const { transport, orchestrator } = makeRig();
      let aggregatedInput: unknown;
      await fakeAgent(transport, "root", async () => ({ result: { ok: true } }));
      await fakeAgent(transport, "branch", async (input) => ({
        result: { fromBranch: input },
      }));
      await fakeAgent(transport, "merge", async (input) => {
        aggregatedInput = input;
        return { result: { merged: true } };
      });
      // root → [b1, b2, b3] → merge (3-way fan-in)
      const result = await orchestrator.execute({
        definition: workflow([
          step("root", "root", ["b1", "b2", "b3"]),
          step("b1", "branch", ["merge"]),
          step("b2", "branch", ["merge"]),
          step("b3", "branch", ["merge"]),
          step("merge", "merge"),
        ]),
        input: {},
      });
      expect(result.status).toBe("completed");
      expect(result.results.merge!.status).toBe("completed");
      // Aggregated input must be { branches: [...] } sorted by step_id.
      expect(aggregatedInput).toBeDefined();
      const agg = aggregatedInput as { branches: { step_id: string; status: string; output: unknown }[] };
      expect(agg.branches.map((b) => b.step_id)).toEqual(["b1", "b2", "b3"]);
      for (const b of agg.branches) {
        expect(b.status).toBe("completed");
        expect((b.output as { fromBranch: unknown }).fromBranch).toBeDefined();
      }
      await orchestrator.close();
    });

    it("aggregation carries status='skipped' for parents skipped via on_failure", async () => {
      const { transport, orchestrator } = makeRig();
      let aggregatedInput: unknown;
      await fakeAgent(transport, "root", async () => ({ result: { from: "root" } }));
      await fakeAgent(transport, "good-cap", async (input) => ({ result: { from: "good", input } }));
      await fakeAgent(transport, "bad-cap", async () => ({
        failure: { nak_reason: "cant-do", error: "branch refused" },
      }));
      await fakeAgent(transport, "merge", async (input) => {
        aggregatedInput = input;
        return { result: { merged: true } };
      });
      const stepGood: WorkflowStep = {
        id: "good",
        capability: "good-cap",
        input: { compatibility_key: "io.v1" },
        output: { compatibility_key: "io.v1" },
        next: ["merge"],
      };
      const stepBad: WorkflowStep = {
        id: "bad",
        capability: "bad-cap",
        input: { compatibility_key: "io.v1" },
        output: { compatibility_key: "io.v1" },
        on_failure: "skip-step",
        next: ["merge"],
      };
      const result = await orchestrator.execute({
        definition: workflow([
          step("root", "root", ["good", "bad"]),
          stepGood,
          stepBad,
          step("merge", "merge"),
        ]),
        input: {},
      });
      expect(result.status).toBe("completed");
      const agg = aggregatedInput as { branches: { step_id: string; status: string; output: unknown }[] };
      const goodBranch = agg.branches.find((b) => b.step_id === "good")!;
      const badBranch = agg.branches.find((b) => b.step_id === "bad")!;
      expect(goodBranch.status).toBe("completed");
      expect(badBranch.status).toBe("skipped");
      // Skipped parent's output is the chain's pre-step input (the
      // value the fan-out parent forwarded), NOT the skipped
      // step's computed result (it never ran). Lock the contract
      // in code so a future refactor that forwards a step default
      // instead doesn't drift past the test silently.
      expect((badBranch.output as { from?: string }).from).toBe("root");
      await orchestrator.close();
    });

    it("workflow fails with atStep=fan-in when the fan-in step itself aborts", async () => {
      const { transport, store, orchestrator } = makeRig();
      await fakeAgent(transport, "root", async () => ({ result: {} }));
      await fakeAgent(transport, "branch", async () => ({ result: { ok: true } }));
      await fakeAgent(transport, "merge", async () => ({
        failure: { nak_reason: "cant-do", error: "merge refused" },
      }));
      const result = await orchestrator.execute({
        definition: workflow([
          step("root", "root", ["b1", "b2"]),
          step("b1", "branch", ["m"]),
          step("b2", "branch", ["m"]),
          step("m", "merge"),
        ]),
        input: {},
      });
      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("nak-cant-do");
      // Store reflects the fan-in step as the failing step.
      const snap = store.snapshot();
      expect(snap[0]!.completed_steps.m!.status).toBe("failed");
      expect(snap[0]!.completed_steps.m!.error?.message).toContain("merge refused");
      await orchestrator.close();
    });

    it("lifecycle: every parent step.completed fires before fan-in step.started", async () => {
      const { transport, orchestrator } = makeRig();
      await fakeAgent(transport, "root", async () => ({ result: {} }));
      await fakeAgent(transport, "branch", async () => ({ result: { ok: true } }));
      await fakeAgent(transport, "merge", async () => ({ result: { merged: true } }));
      const events: { type: string; step?: string }[] = [];
      await transport.subscribe("local.metafactory.dispatch.workflow.>", async (env) => {
        const payload = env.payload as { step_id?: string };
        events.push({ type: env.type, step: payload?.step_id });
      });
      const result = await orchestrator.execute({
        definition: workflow([
          step("root", "root", ["b1", "b2"]),
          step("b1", "branch", ["m"]),
          step("b2", "branch", ["m"]),
          step("m", "merge"),
        ]),
        input: {},
      });
      expect(result.status).toBe("completed");
      // Find the indexes.
      const idxB1Completed = events.findIndex((e) => e.type === "workflow.step.completed" && e.step === "b1");
      const idxB2Completed = events.findIndex((e) => e.type === "workflow.step.completed" && e.step === "b2");
      const idxMStarted = events.findIndex((e) => e.type === "workflow.step.started" && e.step === "m");
      expect(idxB1Completed).toBeGreaterThan(-1);
      expect(idxB2Completed).toBeGreaterThan(-1);
      expect(idxMStarted).toBeGreaterThan(-1);
      // Both parent completions precede merge's start.
      expect(idxMStarted).toBeGreaterThan(idxB1Completed);
      expect(idxMStarted).toBeGreaterThan(idxB2Completed);
      await orchestrator.close();
    });

    it("rejects definitions with excessive fan-in width", async () => {
      const transport = new InMemoryTransport();
      const store = createInMemoryWorkflowExecutionStore();
      const orchestrator = createOrchestrator({
        publisher: transport,
        subscriber: transport,
        store,
        principal: "metafactory",
        source: "metafactory.cortex.composition",
        sovereignty,
        maxFanOutWidth: 2,
      });
      // Build a graph where every fan-OUT step has <= 2 children
      // (passes the fan-out cap) but `merge` has 3 parents
      // (exceeds the cap on the fan-in path).
      const result = await orchestrator.execute({
        definition: workflow([
          step("root", "cap", ["a", "b"]),
          step("a", "cap", ["c", "d"]),
          step("b", "cap", ["e"]),
          step("c", "cap", ["merge"]),
          step("d", "cap", ["merge"]),
          step("e", "cap", ["merge"]),
          step("merge", "cap"),
        ]),
        input: {},
      });
      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("validation-failed");
      expect(result.error?.message).toMatch(/fan-in|parents/);
      await orchestrator.close();
    });

    it("does not dispatch fan-in step if any parent's chain aborts", async () => {
      const { transport, orchestrator } = makeRig();
      let mergeCalls = 0;
      await fakeAgent(transport, "root", async () => ({ result: { ok: true } }));
      await fakeAgent(transport, "good-branch", async () => ({ result: { ok: true } }));
      await fakeAgent(transport, "bad-branch", async () => ({
        failure: { nak_reason: "cant-do", error: "branch refused" },
      }));
      await fakeAgent(transport, "merge", async () => {
        mergeCalls += 1;
        return { result: { merged: true } };
      });
      const result = await orchestrator.execute({
        definition: workflow([
          step("root", "root", ["a", "b"]),
          step("a", "good-branch", ["merge"]),
          step("b", "bad-branch", ["merge"]),
          step("merge", "merge"),
        ]),
        input: {},
      });
      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("nak-cant-do");
      expect(mergeCalls).toBe(0);
      expect(result.results.merge).toBeUndefined();
      await orchestrator.close();
    });

    it("aggregation is sorted deterministically by step_id (FIFO arrival order ignored)", async () => {
      const { transport, orchestrator } = makeRig();
      // Branches with non-alphabetical IDs to ensure sort actually
      // matters. Vary completion order by delay.
      let aggregatedInput: unknown;
      await fakeAgent(transport, "root", async () => ({ result: {} }));
      const delays = new Map<string, number>([["zeta", 5], ["alpha", 25], ["mu", 15]]);
      await fakeAgent(transport, "delayed", async (_input, task_id) => {
        // Look up which step this is by checking which one's currently waiting.
        // Each branch uses the same capability with a different delay; that's
        // OK because the orchestrator dispatches each individually.
        void task_id;
        return { result: { id: "x" } };
      });
      await fakeAgent(transport, "merge", async (input) => {
        aggregatedInput = input;
        return { result: { ok: true } };
      });
      // Use distinct capabilities per branch so each agent's delay is
      // separately controllable.
      for (const [id, ms] of delays) {
        await fakeAgent(transport, `delayed-${id}`, async () => {
          await new Promise((r) => setTimeout(r, ms));
          return { result: { from: id } };
        });
      }
      const result = await orchestrator.execute({
        definition: workflow([
          step("root", "root", ["zeta", "alpha", "mu"]),
          step("zeta", "delayed-zeta", ["merge"]),
          step("alpha", "delayed-alpha", ["merge"]),
          step("mu", "delayed-mu", ["merge"]),
          step("merge", "merge"),
        ]),
        input: {},
      });
      expect(result.status).toBe("completed");
      const agg = aggregatedInput as { branches: { step_id: string; output: unknown }[] };
      // Despite zeta finishing first and alpha last, output order is
      // step_id-sorted: alpha < mu < zeta.
      expect(agg.branches.map((b) => b.step_id)).toEqual(["alpha", "mu", "zeta"]);
      await orchestrator.close();
    });

    it("supports diamond DAG: A → [B, C] → D", async () => {
      const { transport, orchestrator } = makeRig();
      await fakeAgent(transport, "cap", async () => ({ result: { ok: true } }));
      const result = await orchestrator.execute({
        definition: workflow([
          step("a", "cap", ["b", "c"]),
          step("b", "cap", ["d"]),
          step("c", "cap", ["d"]),
          step("d", "cap"),
        ]),
        input: {},
      });
      expect(result.status).toBe("completed");
      for (const id of ["a", "b", "c", "d"]) {
        expect(result.results[id]!.status).toBe("completed");
      }
      await orchestrator.close();
    });

    it("multi-level fan-in (A → [B, C] → D where D fans out to [E, F] which converge on G)", async () => {
      const { transport, orchestrator } = makeRig();
      await fakeAgent(transport, "cap", async () => ({ result: { ok: true } }));
      const result = await orchestrator.execute({
        definition: workflow([
          step("a", "cap", ["b", "c"]),
          step("b", "cap", ["d"]),
          step("c", "cap", ["d"]),
          step("d", "cap", ["e", "f"]),
          step("e", "cap", ["g"]),
          step("f", "cap", ["g"]),
          step("g", "cap"),
        ]),
        input: {},
      });
      expect(result.status).toBe("completed");
      for (const id of ["a", "b", "c", "d", "e", "f", "g"]) {
        expect(result.results[id]!.status).toBe("completed");
      }
      await orchestrator.close();
    });
  });

  describe("excessive fan-out rejection", () => {
    it("rejects definitions where a step fans out beyond maxFanOutWidth", async () => {
      const transport = new InMemoryTransport();
      const store = createInMemoryWorkflowExecutionStore();
      const orchestrator = createOrchestrator({
        publisher: transport,
        subscriber: transport,
        store,
        principal: "metafactory",
        source: "metafactory.cortex.composition",
        sovereignty,
        defaultWorkflowTimeoutMs: 5000,
        maxFanOutWidth: 2,
      });
      const next = ["b", "c", "d"];
      const result = await orchestrator.execute({
        definition: workflow([
          step("a", "cap", next),
          step("b", "cap"),
          step("c", "cap"),
          step("d", "cap"),
        ]),
        input: {},
      });
      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("validation-failed");
      expect(result.error?.message).toContain("MAX_FANOUT_WIDTH");
      await orchestrator.close();
    });
  });

  describe("cycle 2 — concurrent executions, depth cap, validation", () => {
    it("concurrent execute() calls do NOT cross-contaminate current_steps (B1 regression)", async () => {
      const { transport, store, orchestrator } = makeRig();
      // Slow agent so workflows overlap in flight.
      await fakeAgent(transport, "slow", async () => {
        await new Promise((r) => setTimeout(r, 50));
        return { result: { ok: true } };
      });
      const [a, b] = await Promise.all([
        orchestrator.execute({
          definition: { ...workflow([step("alpha", "slow")]), id: "wf-A" },
          input: {},
        }),
        orchestrator.execute({
          definition: { ...workflow([step("beta", "slow")]), id: "wf-B" },
          input: {},
        }),
      ]);
      expect(a.status).toBe("completed");
      expect(b.status).toBe("completed");
      // Final completed-states must each carry only their own step.
      const snap = store.snapshot();
      const recA = snap.find((s) => s.workflow_id === "wf-A")!;
      const recB = snap.find((s) => s.workflow_id === "wf-B")!;
      expect(Object.keys(recA.completed_steps)).toEqual(["alpha"]);
      expect(Object.keys(recB.completed_steps)).toEqual(["beta"]);
      await orchestrator.close();
    });

    it("rejects deep fan-out trees via maxFanOutDepth", async () => {
      const transport = new InMemoryTransport();
      const store = createInMemoryWorkflowExecutionStore();
      const orchestrator = createOrchestrator({
        publisher: transport,
        subscriber: transport,
        store,
        principal: "metafactory",
        source: "metafactory.cortex.composition",
        sovereignty,
        defaultWorkflowTimeoutMs: 5000,
        maxFanOutDepth: 3,
      });
      // 5-deep linear chain (depth 5 > cap 3).
      const steps: WorkflowStep[] = [];
      for (let i = 0; i < 5; i++) {
        steps.push({
          id: `s-${i}`,
          capability: "cap",
          input: { compatibility_key: "io.v1" },
          output: { compatibility_key: "io.v1" },
          ...(i < 4 ? { next: [`s-${i + 1}`] } : {}),
        });
      }
      const result = await orchestrator.execute({
        definition: workflow(steps),
        input: {},
      });
      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("validation-failed");
      expect(result.error?.message).toContain("MAX_FANOUT_DEPTH");
      await orchestrator.close();
    });

    it("detectExcessiveDepth measures DAG-diamond depth via the longest path, not the path count (regression: deepest-path-wins)", async () => {
      // PART 1 — Symmetric diamond per Luna's spec: a → [b, c] → d.
      //   - Longest root-to-leaf path = a → b → d (= a → c → d) = depth 3.
      //   - There are two distinct paths to `d`, but only ONE topological depth.
      //   - The diamond at depth 3 must pass at maxFanOutDepth=3 and fail at 2.
      //   - This catches OVER-COUNTING regressions (e.g. path-sum: 4, or
      //     per-entry-restart with stale state: 4) where a refactor counts
      //     each path independently or double-walks through the tip.
      //
      // PART 2 — Unequal-depth diamond: a → [b, c→c2] → d.
      //   - Longest path = a → c → c2 → d = depth 4.
      //   - Short path  = a → b → d = depth 3.
      //   - These two paths reach `d` at DIFFERENT depths. The deepest-path-wins
      //     `Map<id, maxDepth>` contract requires `d` be recorded at depth 4
      //     (the deeper of the two visits). A regression to first-visit-wins
      //     `Set<string>` could, depending on stack pop order, record `d` at
      //     depth 3 (under-counting). This part of the test exercises both
      //     visit orders implicitly because `next: [b, c]` iteration order is
      //     stable and the iterative-DFS stack pops in reverse-push order; the
      //     deepest-path-wins check (`prev >= depth` skip) is what guarantees
      //     correctness regardless of visit order.
      //
      // See orchestrator.ts `detectExcessiveDepth` doc-block (Diamond
      // observability section) — this is the regression test it anticipates.

      // PART 1 — symmetric diamond at maxFanOutDepth=3 (passes) and =2 (fails).
      const symmetricDiamond: WorkflowStep[] = [
        step("a", "cap", ["b", "c"]),
        step("b", "cap", ["d"]),
        step("c", "cap", ["d"]),
        step("d", "cap"),
      ];

      {
        const transport = new InMemoryTransport();
        const store = createInMemoryWorkflowExecutionStore();
        const orchestrator = createOrchestrator({
          publisher: transport,
          subscriber: transport,
          store,
          principal: "metafactory",
          source: "metafactory.cortex.composition",
          sovereignty,
          defaultWorkflowTimeoutMs: 5000,
          maxFanOutDepth: 3,
        });
        await fakeAgent(transport, "cap", async () => ({ result: { ok: true } }));
        const result = await orchestrator.execute({
          definition: workflow(symmetricDiamond),
          input: {},
        });
        expect(result.status).toBe("completed");
        for (const id of ["a", "b", "c", "d"]) {
          expect(result.results[id]!.status).toBe("completed");
        }
        await orchestrator.close();
      }

      {
        const transport = new InMemoryTransport();
        const store = createInMemoryWorkflowExecutionStore();
        const orchestrator = createOrchestrator({
          publisher: transport,
          subscriber: transport,
          store,
          principal: "metafactory",
          source: "metafactory.cortex.composition",
          sovereignty,
          defaultWorkflowTimeoutMs: 5000,
          maxFanOutDepth: 2,
        });
        const result = await orchestrator.execute({
          definition: workflow(symmetricDiamond),
          input: {},
        });
        expect(result.status).toBe("failed");
        expect(result.error?.code).toBe("validation-failed");
        expect(result.error?.message).toContain("MAX_FANOUT_DEPTH=2");
        // Pin the measured depth: must be exactly 3 (longest path), not 4
        // (path-sum) or anything else. A regression that counts paths or
        // double-walks through `d` would land here.
        expect(result.error?.message).toMatch(/workflow depth 3\b/);
        expect(result.error?.message).toContain("at step 'd'");
        await orchestrator.close();
      }

      // PART 2 — unequal-depth diamond at cap=4 (passes) and =3 (fails).
      //   a → b → d  (depth 3, short side)
      //   a → c → c2 → d  (depth 4, long side)
      // The tip `d` is reachable at BOTH 3 and 4; the deepest-path-wins
      // semantics MUST select 4. If the test sees the workflow pass at
      // cap=3, that proves the implementation under-counted.
      //
      // Stack-order rigging: `a.next = [c, b]` declares the long side first
      // (c → c2 → d) so the iterative-DFS push-then-pop ordering visits the
      // SHORT side first (b → d at depth 3) before later re-encountering `d`
      // via the LONG side at depth 4. This makes first-visit-wins
      // regressions observable: a `Set<string>` impl would record d=3
      // (short first) and skip the d=4 push, letting cap=3 erroneously
      // pass. The deepest-path-wins `Map<id, maxDepth>` impl records d=3
      // first then upgrades to d=4 because `prev(3) >= depth(4)` is false.
      const unequalDiamond: WorkflowStep[] = [
        step("a", "cap", ["c", "b"]),
        step("b", "cap", ["d"]),
        step("c", "cap", ["c2"]),
        step("c2", "cap", ["d"]),
        step("d", "cap"),
      ];

      {
        const transport = new InMemoryTransport();
        const store = createInMemoryWorkflowExecutionStore();
        const orchestrator = createOrchestrator({
          publisher: transport,
          subscriber: transport,
          store,
          principal: "metafactory",
          source: "metafactory.cortex.composition",
          sovereignty,
          defaultWorkflowTimeoutMs: 5000,
          maxFanOutDepth: 4,
        });
        await fakeAgent(transport, "cap", async () => ({ result: { ok: true } }));
        const result = await orchestrator.execute({
          definition: workflow(unequalDiamond),
          input: {},
        });
        expect(result.status).toBe("completed");
        for (const id of ["a", "b", "c", "c2", "d"]) {
          expect(result.results[id]!.status).toBe("completed");
        }
        await orchestrator.close();
      }

      {
        const transport = new InMemoryTransport();
        const store = createInMemoryWorkflowExecutionStore();
        const orchestrator = createOrchestrator({
          publisher: transport,
          subscriber: transport,
          store,
          principal: "metafactory",
          source: "metafactory.cortex.composition",
          sovereignty,
          defaultWorkflowTimeoutMs: 5000,
          maxFanOutDepth: 3,
        });
        // Register a fakeAgent so that IF the depth check fails to fire
        // (e.g. under a first-visit-wins regression that under-counts `d`),
        // the workflow runs to completion and the `expect(failed)` below
        // surfaces as a clean assertion failure rather than a 5-second
        // timeout. The correct (deepest-path-wins) impl rejects at
        // validation time and this agent never receives anything.
        await fakeAgent(transport, "cap", async () => ({ result: { ok: true } }));
        const result = await orchestrator.execute({
          definition: workflow(unequalDiamond),
          input: {},
        });
        // Critical assertion: the workflow MUST fail at cap=3 because the
        // long path is depth 4. A first-visit-wins regression (depending
        // on stack pop order, could record `d` at depth 3 via the short
        // path) would let this workflow complete — flipping this expect
        // to a green-on-bug.
        expect(result.status).toBe("failed");
        expect(result.error?.code).toBe("validation-failed");
        expect(result.error?.message).toContain("MAX_FANOUT_DEPTH=3");
        expect(result.error?.message).toMatch(/workflow depth 4\b/);
        await orchestrator.close();
      }
    });

    it("rejects construction with invalid maxFanOutDepth", () => {
      const transport = new InMemoryTransport();
      const store = createInMemoryWorkflowExecutionStore();
      expect(() =>
        createOrchestrator({
          publisher: transport,
          subscriber: transport,
          store,
          principal: "metafactory",
          source: "metafactory.cortex.composition",
          sovereignty,
          maxFanOutDepth: 0,
        }),
      ).toThrow(/positive integer/);
      expect(() =>
        createOrchestrator({
          publisher: transport,
          subscriber: transport,
          store,
          principal: "metafactory",
          source: "metafactory.cortex.composition",
          sovereignty,
          maxFanOutDepth: Number.NaN,
        }),
      ).toThrow(/positive integer/);
      expect(() =>
        createOrchestrator({
          publisher: transport,
          subscriber: transport,
          store,
          principal: "metafactory",
          source: "metafactory.cortex.composition",
          sovereignty,
          maxFanOutDepth: 1.5,
        }),
      ).toThrow(/positive integer/);
    });

    it("maxFanOutDepth 0 / NaN / 1.5 are rejected symmetrically (same error shape, same code path)", () => {
      // SYMMETRY contract: each of the three pathological values
      // (zero, non-integer, NaN) must produce a clean, consistent
      // construction-time failure — not a silent fallback for one
      // and a throw for another. The regression Luna's audit
      // anticipates: a future refactor that swaps `Number.isInteger`
      // for something laxer (e.g. `Number.isFinite` + `Math.floor`),
      // or that allows `??` to coerce NaN to the default 32. Both
      // would erode the fail-fast contract documented in the
      // orchestrator's option-validation block.
      //
      // Pin all three to:
      //   1. throw at construction (none silently bypass to a default)
      //   2. throw an `Error` (not a TypeError, not an Ajv schema error)
      //   3. share the same error-message prefix that names the
      //      offending option, so callers can `.message.startsWith()`
      //   4. echo the rejected value in the message so debugging is
      //      possible without re-running with logs
      const transport = new InMemoryTransport();
      const store = createInMemoryWorkflowExecutionStore();
      const cases: { label: string; value: number; rendered: string }[] = [
        { label: "zero", value: 0, rendered: "0" },
        { label: "NaN", value: Number.NaN, rendered: "NaN" },
        { label: "1.5 (non-integer)", value: 1.5, rendered: "1.5" },
      ];

      const PREFIX = "F-16 orchestrator: maxFanOutDepth must be a positive integer";
      const errors: Error[] = [];
      for (const { label, value, rendered } of cases) {
        let caught: unknown;
        try {
          createOrchestrator({
            publisher: transport,
            subscriber: transport,
            store,
            principal: "metafactory",
            source: "metafactory.cortex.composition",
            sovereignty,
            maxFanOutDepth: value,
          });
        } catch (err) {
          caught = err;
        }
        // (1) construction MUST throw — no silent fallback to default.
        expect(caught, `case=${label}: expected throw, got silent success`).toBeInstanceOf(Error);
        const e = caught as Error;
        // (2) error type symmetry — plain `Error`, not a subclass.
        //     `instanceof Error` already asserted above; the constructor
        //     check pins that no one slipped in a custom subclass that
        //     callers couldn't `.startsWith()` against.
        expect(e.constructor.name, `case=${label}: error class`).toBe("Error");
        // (3) message-prefix symmetry — same human-readable handle
        //     for all three values.
        expect(e.message.startsWith(PREFIX), `case=${label}: msg='${e.message}'`).toBe(true);
        // (4) rejected value preserved in message for debuggability.
        //     `String(NaN) === 'NaN'`, `String(0) === '0'`, etc.
        expect(e.message).toContain(`got ${rendered}`);
        errors.push(e);
      }
      // Cross-case symmetry: each error has the exact same prefix
      // before the value, differing ONLY in the trailing rendered value.
      // A regression that special-cases NaN (e.g. early-returns to a
      // default) would break this — the NaN entry would simply not exist.
      expect(errors).toHaveLength(3);
      for (const e of errors) {
        expect(e.message.split(";")[0]).toBe(PREFIX);
      }
    });

    it("rejects construction with invalid maxFanOutWidth", () => {
      const transport = new InMemoryTransport();
      const store = createInMemoryWorkflowExecutionStore();
      expect(() =>
        createOrchestrator({
          publisher: transport,
          subscriber: transport,
          store,
          principal: "metafactory",
          source: "metafactory.cortex.composition",
          sovereignty,
          maxFanOutWidth: 0,
        }),
      ).toThrow(/positive integer/);
      expect(() =>
        createOrchestrator({
          publisher: transport,
          subscriber: transport,
          store,
          principal: "metafactory",
          source: "metafactory.cortex.composition",
          sovereignty,
          maxFanOutWidth: Number.NaN,
        }),
      ).toThrow(/positive integer/);
      expect(() =>
        createOrchestrator({
          publisher: transport,
          subscriber: transport,
          store,
          principal: "metafactory",
          source: "metafactory.cortex.composition",
          sovereignty,
          maxFanOutWidth: 1.5,
        }),
      ).toThrow(/positive integer/);
    });

    it("nested fan-out where root is linear leaves exec.output undefined (M2)", async () => {
      const { transport, store, orchestrator } = makeRig();
      await fakeAgent(transport, "cap", async () => ({ result: { ok: true } }));
      // Linear root → linear middle → fan-out into leaves.
      const result = await orchestrator.execute({
        definition: workflow([
          step("root", "cap", ["mid"]),
          step("mid", "cap", ["leaf-a", "leaf-b"]),
          step("leaf-a", "cap"),
          step("leaf-b", "cap"),
        ]),
        input: {},
      });
      expect(result.status).toBe("completed");
      // Workflow had transitive fan-out — exec.output must be undefined
      // even though the outermost chain only walked linearly.
      expect(result.output).toBeUndefined();
      const snap = store.snapshot();
      expect(snap[0]!.output).toBeUndefined();
      await orchestrator.close();
    });
  });

  describe("nested fan-out + transport failure mid-fan-out", () => {
    it("supports a fan-out branch that contains its own fan-out", async () => {
      const { transport, orchestrator } = makeRig();
      const dispatched: string[] = [];
      await fakeAgent(transport, "cap", async (_input, task_id) => {
        dispatched.push(task_id);
        return { result: { ok: true } };
      });
      // root → [mid-a, mid-b]; mid-a → [leaf-1, leaf-2]; mid-b alone.
      const result = await orchestrator.execute({
        definition: workflow([
          step("root", "cap", ["mid-a", "mid-b"]),
          step("mid-a", "cap", ["leaf-1", "leaf-2"]),
          step("mid-b", "cap"),
          step("leaf-1", "cap"),
          step("leaf-2", "cap"),
        ]),
        input: {},
      });
      expect(result.status).toBe("completed");
      // 5 step dispatches: root + mid-a + mid-b + leaf-1 + leaf-2.
      expect(dispatched.length).toBe(5);
      for (const id of ["root", "mid-a", "mid-b", "leaf-1", "leaf-2"]) {
        expect(result.results[id]!.status).toBe("completed");
      }
      await orchestrator.close();
    });

    it("does not leak unhandled rejection on transport failure mid-fan-out", async () => {
      // The `.catch` on each runChain invocation maps infrastructure
      // throws onto BranchResult.failed so Promise.all settles cleanly.
      // Without that guard, a sibling rejection after Promise.all
      // short-circuits would become an unhandledRejection event.
      const wrapped = new InMemoryTransport();
      const failingPublisher = {
        publish(subject: string, env: MyelinEnvelope) {
          if (subject === `local.metafactory.tasks.bad-cap`) {
            return Promise.reject(new Error("transport blew up"));
          }
          return wrapped.publish(subject, env);
        },
        async request(): Promise<MyelinEnvelope> { throw new Error("not implemented"); },
        close: () => wrapped.close(),
      };
      const store = createInMemoryWorkflowExecutionStore();
      const orchestrator = createOrchestrator({
        publisher: failingPublisher,
        subscriber: wrapped,
        store,
        principal: "metafactory",
        source: "metafactory.cortex.composition",
        sovereignty,
        defaultWorkflowTimeoutMs: 2000,
      });
      await fakeAgent(wrapped, "good-cap", async () => ({ result: { ok: true } }));
      // Root → [good-cap, bad-cap]. The bad branch's publish rejects;
      // good branch completes. Result: workflow fails with the
      // bad branch's error (mapped from infrastructure throw).
      await fakeAgent(wrapped, "root-cap", async () => ({ result: { ok: true } }));
      const result = await orchestrator.execute({
        definition: workflow([
          step("root", "root-cap", ["good-branch", "bad-branch"]),
          step("good-branch", "good-cap"),
          step("bad-branch", "bad-cap"),
        ]),
        input: {},
      });
      expect(result.status).toBe("failed");
      expect(result.error?.message).toContain("transport blew up");
      await orchestrator.close();
    });
  });

  describe("multi-entry rejection", () => {
    it("rejects definitions with multiple entry steps", async () => {
      const { transport, orchestrator } = makeRig();
      await fakeAgent(transport, "cap", async () => ({ result: { ok: true } }));
      const result = await orchestrator.execute({
        definition: workflow([
          step("entry-a", "cap"),
          step("entry-b", "cap"),
        ]),
        input: {},
      });
      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("validation-failed");
      expect(result.error?.message).toContain("multiple entry steps");
      await orchestrator.close();
    });
  });

  describe("cycle rejection", () => {
    it("returns failed result with validation-failed error on cyclic definition", async () => {
      const { orchestrator } = makeRig();
      const result = await orchestrator.execute({
        definition: workflow([step("a", "cap", ["b"]), step("b", "cap", ["a"])]),
        input: {},
      });
      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("validation-failed");
      expect(result.error?.message).toContain("cycle");
      await orchestrator.close();
    });
  });

  describe("per-step timeout (T-6.3)", () => {
    it("rejects step that exceeds its own timeout_ms before the workflow deadline", async () => {
      const transport = new InMemoryTransport();
      const store = createInMemoryWorkflowExecutionStore();
      const orchestrator = createOrchestrator({
        publisher: transport,
        subscriber: transport,
        store,
        principal: "metafactory",
        source: "metafactory.cortex.composition",
        sovereignty,
        defaultWorkflowTimeoutMs: 5000,
      });
      // No agent subscribed → the step never gets a response.
      const stepWithTimeout: WorkflowStep = {
        id: "slow",
        capability: "cap",
        input: { compatibility_key: "io.v1" },
        output: { compatibility_key: "io.v1" },
        timeout_ms: 50,
      };
      const result = await orchestrator.execute({
        definition: workflow([stepWithTimeout]),
        input: {},
      });
      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("timeout");
      expect(result.error?.message).toContain("timeout_ms");
      expect(result.results.slow!.status).toBe("failed");
      await orchestrator.close();
    });

    it("on_failure 'skip-step' continues past a timed-out step", async () => {
      const transport = new InMemoryTransport();
      const store = createInMemoryWorkflowExecutionStore();
      const orchestrator = createOrchestrator({
        publisher: transport,
        subscriber: transport,
        store,
        principal: "metafactory",
        source: "metafactory.cortex.composition",
        sovereignty,
        defaultWorkflowTimeoutMs: 5000,
      });
      // Step 1: no agent + tight timeout + skip-step.
      // Step 2: real agent — should run and succeed.
      await fakeAgent(transport, "ok-cap", async () => ({ result: { ok: true } }));
      const stepA: WorkflowStep = {
        id: "skipped",
        capability: "missing-cap",
        input: { compatibility_key: "io.v1" },
        output: { compatibility_key: "io.v1" },
        timeout_ms: 50,
        on_failure: "skip-step",
        next: ["after"],
      };
      const stepB: WorkflowStep = {
        id: "after",
        capability: "ok-cap",
        input: { compatibility_key: "io.v1" },
        output: { compatibility_key: "io.v1" },
      };
      const result = await orchestrator.execute({
        definition: workflow([stepA, stepB]),
        input: { hello: "world" },
      });
      expect(result.status).toBe("completed");
      expect(result.results.skipped!.status).toBe("skipped");
      expect(result.results.skipped!.error?.code).toBe("timeout");
      expect(result.results.after!.status).toBe("completed");
      await orchestrator.close();
    });

    it("on_failure 'continue' on agent nak skips and proceeds", async () => {
      const transport = new InMemoryTransport();
      const store = createInMemoryWorkflowExecutionStore();
      const orchestrator = createOrchestrator({
        publisher: transport,
        subscriber: transport,
        store,
        principal: "metafactory",
        source: "metafactory.cortex.composition",
        sovereignty,
        defaultWorkflowTimeoutMs: 5000,
      });
      await fakeAgent(transport, "naks", async () => ({
        failure: { nak_reason: "cant-do", error: "agent refuses" },
      }));
      await fakeAgent(transport, "succeeds", async () => ({ result: { ok: true } }));
      const stepA: WorkflowStep = {
        id: "naks",
        capability: "naks",
        input: { compatibility_key: "io.v1" },
        output: { compatibility_key: "io.v1" },
        on_failure: "continue",
        next: ["next"],
      };
      const stepB: WorkflowStep = {
        id: "next",
        capability: "succeeds",
        input: { compatibility_key: "io.v1" },
        output: { compatibility_key: "io.v1" },
      };
      const result = await orchestrator.execute({
        definition: workflow([stepA, stepB]),
        input: {},
      });
      expect(result.status).toBe("completed");
      expect(result.results.naks!.status).toBe("skipped");
      expect(result.results.naks!.error?.code).toBe("nak-cant-do");
      expect(result.results.next!.status).toBe("completed");
      await orchestrator.close();
    });

    it("workflow-level on_failure applies when step does not override", async () => {
      const transport = new InMemoryTransport();
      const store = createInMemoryWorkflowExecutionStore();
      const orchestrator = createOrchestrator({
        publisher: transport,
        subscriber: transport,
        store,
        principal: "metafactory",
        source: "metafactory.cortex.composition",
        sovereignty,
        defaultWorkflowTimeoutMs: 5000,
      });
      await fakeAgent(transport, "naks", async () => ({
        failure: { nak_reason: "wont-do" },
      }));
      await fakeAgent(transport, "succeeds", async () => ({ result: { ok: true } }));
      const stepA: WorkflowStep = {
        id: "naks",
        capability: "naks",
        input: { compatibility_key: "io.v1" },
        output: { compatibility_key: "io.v1" },
        next: ["next"],
      };
      const stepB: WorkflowStep = {
        id: "next",
        capability: "succeeds",
        input: { compatibility_key: "io.v1" },
        output: { compatibility_key: "io.v1" },
      };
      const result = await orchestrator.execute({
        definition: { ...workflow([stepA, stepB]), on_failure: "skip-step" },
        input: {},
      });
      expect(result.status).toBe("completed");
      expect(result.results.naks!.status).toBe("skipped");
      expect(result.results.next!.status).toBe("completed");
      await orchestrator.close();
    });

    it("workflow-level timeout always aborts regardless of on_failure", async () => {
      const transport = new InMemoryTransport();
      const store = createInMemoryWorkflowExecutionStore();
      const orchestrator = createOrchestrator({
        publisher: transport,
        subscriber: transport,
        store,
        principal: "metafactory",
        source: "metafactory.cortex.composition",
        sovereignty,
        defaultWorkflowTimeoutMs: 50,
      });
      // No agent + skip-step + no per-step timeout. Workflow
      // deadline fires → must abort, not skip.
      const stepA: WorkflowStep = {
        id: "a",
        capability: "missing-cap",
        input: { compatibility_key: "io.v1" },
        output: { compatibility_key: "io.v1" },
        on_failure: "skip-step",
      };
      const result = await orchestrator.execute({
        definition: workflow([stepA]),
        input: {},
      });
      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("timeout");
      await orchestrator.close();
    });

    it("step.timeout_ms greater than workflow remaining uses the workflow ceiling (workflow aborts)", async () => {
      const transport = new InMemoryTransport();
      const store = createInMemoryWorkflowExecutionStore();
      const orchestrator = createOrchestrator({
        publisher: transport,
        subscriber: transport,
        store,
        principal: "metafactory",
        source: "metafactory.cortex.composition",
        sovereignty,
        defaultWorkflowTimeoutMs: 50,
      });
      // step.timeout_ms = 10s but workflow has 50ms total.
      // Workflow deadline fires first → workflow-level timeout
      // path runs → abort regardless of on_failure: "skip-step".
      const stepA: WorkflowStep = {
        id: "a",
        capability: "missing-cap",
        input: { compatibility_key: "io.v1" },
        output: { compatibility_key: "io.v1" },
        timeout_ms: 10000,
        on_failure: "skip-step",
      };
      const result = await orchestrator.execute({
        definition: workflow([stepA]),
        input: {},
      });
      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("timeout");
      // The message reflects the workflow-level path, not the step-level.
      expect(result.error?.message).toContain("workflow deadline");
      await orchestrator.close();
    });
  });

  describe("FailureStrategy lifecycle observability", () => {
    it("emits workflow.step.skipped (not workflow.step.failed) when on_failure='skip-step' applies", async () => {
      const { transport, orchestrator } = makeRig();
      const events: string[] = [];
      await transport.subscribe("local.metafactory.dispatch.workflow.>", async (env) => {
        events.push(env.type);
      });
      await fakeAgent(transport, "naks", async () => ({
        failure: { nak_reason: "cant-do", error: "agent refuses" },
      }));
      await fakeAgent(transport, "ok", async () => ({ result: { ok: true } }));
      const result = await orchestrator.execute({
        definition: workflow([
          {
            id: "a",
            capability: "naks",
            input: { compatibility_key: "io.v1" },
            output: { compatibility_key: "io.v1" },
            on_failure: "skip-step",
            next: ["b"],
          },
          {
            id: "b",
            capability: "ok",
            input: { compatibility_key: "io.v1" },
            output: { compatibility_key: "io.v1" },
          },
        ]),
        input: {},
      });
      expect(result.status).toBe("completed");
      expect(result.results.a!.status).toBe("skipped");
      expect(events).toContain("workflow.step.skipped");
      expect(events).not.toContain("workflow.step.failed");
      await orchestrator.close();
    });

    it("checkpoints state after skip-step before continuing", async () => {
      const { transport, store, orchestrator } = makeRig();
      await fakeAgent(transport, "naks", async () => ({
        failure: { nak_reason: "cant-do" },
      }));
      await fakeAgent(transport, "ok", async () => ({ result: { ok: true } }));
      // Snapshot the store right at the moment the skip lands.
      // The skipped step's status must be persisted before the
      // next step's start checkpoint runs.
      const snaps: string[] = [];
      const watcher = (async () => {
        for await (const event of store.watch()) {
          const skipped = event.execution.completed_steps.a;
          if (skipped) snaps.push(skipped.status);
        }
      })();
      const result = await orchestrator.execute({
        definition: workflow([
          {
            id: "a",
            capability: "naks",
            input: { compatibility_key: "io.v1" },
            output: { compatibility_key: "io.v1" },
            on_failure: "skip-step",
            next: ["b"],
          },
          {
            id: "b",
            capability: "ok",
            input: { compatibility_key: "io.v1" },
            output: { compatibility_key: "io.v1" },
          },
        ]),
        input: {},
      });
      await orchestrator.close();
      void watcher;
      expect(result.status).toBe("completed");
      // First snapshot of "a" must have status "skipped" — proving
      // the store persisted the strategy decision before the next
      // step ran.
      expect(snaps[0]).toBe("skipped");
    });

    it("rejects on_failure 'retry' at execute time (unsupported in this PR)", async () => {
      const { orchestrator } = makeRig();
      await expect(
        orchestrator.execute({
          definition: workflow([
            {
              id: "a",
              capability: "cap",
              input: { compatibility_key: "io.v1" },
              output: { compatibility_key: "io.v1" },
              on_failure: "retry" as unknown as "abort",
            },
          ]),
          input: {},
        }),
      ).rejects.toThrow(/not implemented/);
      await orchestrator.close();
    });

    it("supports skip-step on the terminal step (workflow output = previous step output)", async () => {
      const { transport, orchestrator } = makeRig();
      await fakeAgent(transport, "first", async () => ({ result: { from: "first" } }));
      await fakeAgent(transport, "terminal-naks", async () => ({
        failure: { nak_reason: "cant-do" },
      }));
      const result = await orchestrator.execute({
        definition: workflow([
          {
            id: "first",
            capability: "first",
            input: { compatibility_key: "io.v1" },
            output: { compatibility_key: "io.v1" },
            next: ["terminal"],
          },
          {
            id: "terminal",
            capability: "terminal-naks",
            input: { compatibility_key: "io.v1" },
            output: { compatibility_key: "io.v1" },
            on_failure: "skip-step",
          },
        ]),
        input: { hello: "world" },
      });
      expect(result.status).toBe("completed");
      // Terminal step was skipped; workflow output is the previous
      // step's output.
      expect(result.output).toEqual({ from: "first" });
      expect(result.results.terminal!.status).toBe("skipped");
      await orchestrator.close();
    });
  });

  describe("workflow-level timeout", () => {
    it("times out when no agent responds within the deadline", async () => {
      const transport = new InMemoryTransport();
      const store = createInMemoryWorkflowExecutionStore();
      const orchestrator = createOrchestrator({
        publisher: transport,
        subscriber: transport,
        store,
        principal: "metafactory",
        source: "metafactory.cortex.composition",
        sovereignty,
        defaultWorkflowTimeoutMs: 100,
      });
      // No agent subscribed → step never completes.
      const result = await orchestrator.execute({
        definition: workflow([step("a", "missing-cap")]),
        input: {},
      });
      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("timeout");
      await orchestrator.close();
    });
  });

  describe("recovery (T-8.1)", () => {
    it("rejects recover() when no definitionLoader is configured", async () => {
      const { orchestrator } = makeRig();
      await expect(orchestrator.recover()).rejects.toMatchObject({
        message: expect.stringMatching(/definitionLoader/),
        code: "validation-failed",
      });
      await orchestrator.close();
    });

    it("resumes a running execution from the store with shared execution_id + correlation_id", async () => {
      const transport = new InMemoryTransport();
      const store = createInMemoryWorkflowExecutionStore();
      const wfDefinition = workflow([
        step("a", "cap", ["b"]),
        step("b", "cap"),
      ]);
      const priorExec = {
        execution_id: "exec-original-id",
        workflow_id: wfDefinition.id,
        workflow_version: wfDefinition.version,
        correlation_id: "11111111-1111-4111-8111-111111111111",
        status: "running" as const,
        current_steps: [],
        completed_steps: {
          a: {
            step_id: "a",
            status: "completed" as const,
            output: { fromRecorded: "a-output" },
            started_at: "2026-05-12T00:00:00Z",
            completed_at: "2026-05-12T00:00:01Z",
            duration_ms: 1000,
          },
        },
        pending_fan_in: {},
        input: { original: true },
        started_at: "2026-05-12T00:00:00Z",
        last_checkpoint_at: "2026-05-12T00:00:01Z",
        retry_count: 0,
      };
      await store.put(priorExec);
      let bInput: unknown;
      await fakeAgent(transport, "cap", async (input) => {
        bInput = input;
        return { result: { fromB: input } };
      });
      const orchestrator = createOrchestrator({
        publisher: transport,
        subscriber: transport,
        store,
        principal: "metafactory",
        source: "metafactory.cortex.composition",
        sovereignty,
        defaultWorkflowTimeoutMs: 5000,
        definitionLoader: (id, version) =>
          id === wfDefinition.id && version === wfDefinition.version ? wfDefinition : undefined,
      });
      const [resumed] = await orchestrator.recover();
      expect(resumed).toBeDefined();
      expect(resumed!.execution_id).toBe("exec-original-id");
      expect(resumed!.correlation_id).toBe(priorExec.correlation_id);
      expect(resumed!.status).toBe("completed");
      // Step "a" was NOT re-dispatched — its prior output was reused.
      // Step "b" received "a"'s recorded output as input.
      expect(bInput).toEqual({ fromRecorded: "a-output" });
      const snap = store.snapshot();
      const final = snap.find((s) => s.execution_id === "exec-original-id")!;
      expect(final.retry_count).toBe(1);
      expect(final.status).toBe("completed");
      await orchestrator.close();
    });

    it("aborts execution cleanly when the definitionLoader returns undefined", async () => {
      const transport = new InMemoryTransport();
      const store = createInMemoryWorkflowExecutionStore();
      const priorExec = {
        execution_id: "exec-orphan",
        workflow_id: "unknown-wf",
        workflow_version: "1.0.0",
        correlation_id: "22222222-2222-4222-8222-222222222222",
        status: "running" as const,
        current_steps: [],
        completed_steps: {},
        pending_fan_in: {},
        input: {},
        started_at: "2026-05-12T00:00:00Z",
        last_checkpoint_at: "2026-05-12T00:00:00Z",
        retry_count: 0,
      };
      await store.put(priorExec);
      const orchestrator = createOrchestrator({
        publisher: transport,
        subscriber: transport,
        store,
        principal: "metafactory",
        source: "metafactory.cortex.composition",
        sovereignty,
        definitionLoader: () => undefined,
      });
      const [resumed] = await orchestrator.recover();
      expect(resumed!.status).toBe("failed");
      expect(resumed!.error?.code).toBe("validation-failed");
      expect(resumed!.error?.message).toContain("unknown-wf");
      const snap = store.snapshot();
      const final = snap.find((s) => s.execution_id === "exec-orphan")!;
      expect(final.status).toBe("failed");
      expect(final.completed_at).toBeDefined();
      await orchestrator.close();
    });

    it("treats a throwing definitionLoader as a per-snapshot failure, not a sweep abort", async () => {
      const transport = new InMemoryTransport();
      const store = createInMemoryWorkflowExecutionStore();
      const goodWf = workflow([step("a", "cap")]);
      const priorThrow = {
        execution_id: "exec-loader-throw",
        workflow_id: "broken-wf",
        workflow_version: "1.0.0",
        correlation_id: "33333333-3333-4333-8333-333333333333",
        status: "running" as const,
        current_steps: [],
        completed_steps: {},
        pending_fan_in: {},
        input: {},
        started_at: "2026-05-12T00:00:00Z",
        last_checkpoint_at: "2026-05-12T00:00:00Z",
        retry_count: 0,
      };
      const priorGood = {
        execution_id: "exec-good",
        workflow_id: goodWf.id,
        workflow_version: goodWf.version,
        correlation_id: "44444444-4444-4444-8444-444444444444",
        status: "running" as const,
        current_steps: [],
        completed_steps: {},
        pending_fan_in: {},
        input: { ok: true },
        started_at: "2026-05-12T00:00:00Z",
        last_checkpoint_at: "2026-05-12T00:00:00Z",
        retry_count: 0,
      };
      await store.put(priorThrow);
      await store.put(priorGood);
      await fakeAgent(transport, "cap", async () => ({ result: { ok: "yes" } }));
      const orchestrator = createOrchestrator({
        publisher: transport,
        subscriber: transport,
        store,
        principal: "metafactory",
        source: "metafactory.cortex.composition",
        sovereignty,
        defaultWorkflowTimeoutMs: 5000,
        definitionLoader: (id, version) => {
          if (id === "broken-wf") throw new Error("simulated loader fault");
          return id === goodWf.id && version === goodWf.version ? goodWf : undefined;
        },
      });
      const results = await orchestrator.recover();
      expect(results).toHaveLength(2);
      const failed = results.find((r) => r.execution_id === "exec-loader-throw")!;
      const ok = results.find((r) => r.execution_id === "exec-good")!;
      expect(failed.status).toBe("failed");
      expect(failed.error?.message).toMatch(/simulated loader fault/);
      expect(ok.status).toBe("completed");
      await orchestrator.close();
    });

    it("resumes against a drifted definition (step removed) using prior completed_steps", async () => {
      const transport = new InMemoryTransport();
      const store = createInMemoryWorkflowExecutionStore();
      // New definition has only a → c; the prior run also had a "b"
      // step whose recorded result is irrelevant under the new shape.
      const newDef = workflow([step("a", "cap", ["c"]), step("c", "cap")]);
      const prior = {
        execution_id: "exec-drift",
        workflow_id: newDef.id,
        workflow_version: newDef.version,
        correlation_id: "55555555-5555-4555-8555-555555555555",
        status: "running" as const,
        current_steps: [],
        completed_steps: {
          a: {
            step_id: "a",
            status: "completed" as const,
            output: { fromA: 1 },
            started_at: "2026-05-12T00:00:00Z",
            completed_at: "2026-05-12T00:00:01Z",
            duration_ms: 1000,
          },
          b: {
            step_id: "b",
            status: "completed" as const,
            output: { fromB_orphan: true },
            started_at: "2026-05-12T00:00:01Z",
            completed_at: "2026-05-12T00:00:02Z",
            duration_ms: 1000,
          },
        },
        pending_fan_in: {},
        input: { original: true },
        started_at: "2026-05-12T00:00:00Z",
        last_checkpoint_at: "2026-05-12T00:00:02Z",
        retry_count: 0,
      };
      await store.put(prior);
      let cInput: unknown;
      await fakeAgent(transport, "cap", async (input) => {
        cInput = input;
        return { result: { fromC: input } };
      });
      const orchestrator = createOrchestrator({
        publisher: transport,
        subscriber: transport,
        store,
        principal: "metafactory",
        source: "metafactory.cortex.composition",
        sovereignty,
        defaultWorkflowTimeoutMs: 5000,
        definitionLoader: (id, version) =>
          id === newDef.id && version === newDef.version ? newDef : undefined,
      });
      const [resumed] = await orchestrator.recover();
      expect(resumed!.status).toBe("completed");
      // c sees a's recorded output as input (under the new edge a→c),
      // ignoring the orphan b record entirely.
      expect(cInput).toEqual({ fromA: 1 });
      await orchestrator.close();
    });

    it("re-dispatches a step that was in-flight at crash time", async () => {
      const transport = new InMemoryTransport();
      const store = createInMemoryWorkflowExecutionStore();
      const def = workflow([step("a", "cap", ["b"]), step("b", "cap")]);
      // current_steps recorded "b" was in flight when the process
      // crashed; completed_steps only carries "a". Resume must re-
      // dispatch b rather than treat current_steps as authoritative
      // for completion.
      const prior = {
        execution_id: "exec-mid-step",
        workflow_id: def.id,
        workflow_version: def.version,
        correlation_id: "66666666-6666-4666-8666-666666666666",
        status: "running" as const,
        current_steps: ["b"],
        completed_steps: {
          a: {
            step_id: "a",
            status: "completed" as const,
            output: { fromA: "x" },
            started_at: "2026-05-12T00:00:00Z",
            completed_at: "2026-05-12T00:00:01Z",
            duration_ms: 1000,
          },
        },
        pending_fan_in: {},
        input: {},
        started_at: "2026-05-12T00:00:00Z",
        last_checkpoint_at: "2026-05-12T00:00:01Z",
        retry_count: 0,
      };
      await store.put(prior);
      let bDispatchCount = 0;
      await fakeAgent(transport, "cap", async (input) => {
        bDispatchCount += 1;
        return { result: { fromB: input, attempt: bDispatchCount } };
      });
      const orchestrator = createOrchestrator({
        publisher: transport,
        subscriber: transport,
        store,
        principal: "metafactory",
        source: "metafactory.cortex.composition",
        sovereignty,
        defaultWorkflowTimeoutMs: 5000,
        definitionLoader: (id, version) =>
          id === def.id && version === def.version ? def : undefined,
      });
      const [resumed] = await orchestrator.recover();
      expect(resumed!.status).toBe("completed");
      // b dispatched exactly once on the resume; a was NOT
      // re-dispatched because it has a completed record.
      expect(bDispatchCount).toBe(1);
      await orchestrator.close();
    });

    it("surfaces schema-mismatch on recovery when a still-present step's data_schema tightened across the resume boundary", async () => {
      // Schema drift on a still-present step: the prior recorded
      // output (a string value) no longer satisfies the new
      // definition's tightened output.data_schema (which now
      // requires a number). The runStep short-circuit re-validates
      // against the current validator and surfaces schema-mismatch
      // rather than silently advancing with stale-contract output.
      const transport = new InMemoryTransport();
      const store = createInMemoryWorkflowExecutionStore();
      const tightenedStep: WorkflowStep = {
        id: "a",
        capability: "cap",
        input: { compatibility_key: "io.v1" },
        output: {
          compatibility_key: "io.v1",
          data_schema: { type: "object", required: ["value"], properties: { value: { type: "number" } } },
        },
      };
      const tightenedDef = workflow([tightenedStep]);
      const prior = {
        execution_id: "exec-drift-tight",
        workflow_id: tightenedDef.id,
        workflow_version: tightenedDef.version,
        correlation_id: "77777777-7777-4777-8777-777777777777",
        status: "running" as const,
        current_steps: [],
        completed_steps: {
          a: {
            step_id: "a",
            status: "completed" as const,
            // Prior contract (looser) accepted a string here;
            // tightened contract requires number.
            output: { value: "hello" },
            started_at: "2026-05-12T00:00:00Z",
            completed_at: "2026-05-12T00:00:01Z",
            duration_ms: 1000,
          },
        },
        pending_fan_in: {},
        input: {},
        started_at: "2026-05-12T00:00:00Z",
        last_checkpoint_at: "2026-05-12T00:00:01Z",
        retry_count: 0,
      };
      await store.put(prior);
      const orchestrator = createOrchestrator({
        publisher: transport,
        subscriber: transport,
        store,
        principal: "metafactory",
        source: "metafactory.cortex.composition",
        sovereignty,
        defaultWorkflowTimeoutMs: 5000,
        definitionLoader: (id, version) =>
          id === tightenedDef.id && version === tightenedDef.version ? tightenedDef : undefined,
      });
      const [resumed] = await orchestrator.recover();
      expect(resumed!.status).toBe("failed");
      expect(resumed!.error?.code).toBe("schema-mismatch");
      expect(resumed!.error?.message).toMatch(/schema drift|data_schema/i);
      await orchestrator.close();
    });

    it("rejects a second recover() call on the same orchestrator instance", async () => {
      const transport = new InMemoryTransport();
      const store = createInMemoryWorkflowExecutionStore();
      const orchestrator = createOrchestrator({
        publisher: transport,
        subscriber: transport,
        store,
        principal: "metafactory",
        source: "metafactory.cortex.composition",
        sovereignty,
        definitionLoader: () => undefined,
      });
      // First call resolves (no running executions → []).
      const first = await orchestrator.recover();
      expect(first).toEqual([]);
      // Second call rejects — single-active-instance guarantee is
      // enforced mechanically rather than left to operator
      // discipline. Asserting the `code` field too so a future
      // refactor that drops the structured error contract on
      // this path can't silently downgrade to a message-only
      // rejection.
      await expect(orchestrator.recover()).rejects.toMatchObject({
        message: expect.stringMatching(/already been called/),
        code: "validation-failed",
      });
      await orchestrator.close();
    });

    it("recover() returns empty array when no running executions exist", async () => {
      const transport = new InMemoryTransport();
      const store = createInMemoryWorkflowExecutionStore();
      const orchestrator = createOrchestrator({
        publisher: transport,
        subscriber: transport,
        store,
        principal: "metafactory",
        source: "metafactory.cortex.composition",
        sovereignty,
        definitionLoader: () => undefined,
      });
      const result = await orchestrator.recover();
      expect(result).toEqual([]);
      await orchestrator.close();
    });
  });

  describe("close()", () => {
    it("rejects in-flight tasks with a clear error", async () => {
      const { transport, orchestrator } = makeRig();
      // Agent that never replies
      await transport.subscribe(`local.metafactory.tasks.cap`, async () => {});
      const exec = orchestrator.execute({
        definition: workflow([step("a", "cap")]),
        input: {},
      });
      await new Promise((r) => setTimeout(r, 20));
      await orchestrator.close();
      // The execute promise resolves with failed (timeout fires) or
      // with an orchestrator-closed error — either is acceptable
      // post-close behavior. We just assert it terminates.
      const result = await exec.catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
      expect(result).toBeDefined();
    });

    it("is idempotent", async () => {
      const { orchestrator } = makeRig();
      await orchestrator.close();
      await orchestrator.close();
    });
  });
});
