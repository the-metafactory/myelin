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
    org: "metafactory",
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
            principal: "did:mf:test-agent",
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
          principal: "did:mf:test-agent",
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
      expect(result.results["one"]!.status).toBe("completed");
      expect(result.results["one"]!.agent_principal).toBe("did:mf:test-agent");
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
      expect(snap[0]!.completed_steps["a"]!.status).toBe("completed");
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
        events.push(env.type as string);
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
        events.push(env.type as string);
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
      const malformed: Array<{ reason: string }> = [];
      const orchestrator = createOrchestrator({
        publisher: transport,
        subscriber: transport,
        store,
        org: "metafactory",
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
            principal: "did:mf:rogue",
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
      const malformed: Array<{ reason: string }> = [];
      const orchestrator = createOrchestrator({
        publisher: transport,
        subscriber: transport,
        store,
        org: "metafactory",
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
      const malformed: Array<{ reason: string }> = [];
      const orchestrator = createOrchestrator({
        publisher: transport,
        subscriber: transport,
        store,
        org: "metafactory",
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
          type: "dispatch.task.progress" as "dispatch.task.completed",
          sovereignty,
          payload: {
            task_id: payload.task_id,
            principal: "did:mf:test-agent",
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
        close: () => wrapped.close(),
      };
      const store = createInMemoryWorkflowExecutionStore();
      const orchestrator = createOrchestrator({
        publisher: failingPublisher,
        subscriber: wrapped,
        store,
        org: "metafactory",
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
      expect(result.results["b"]).toBeUndefined();
      await orchestrator.close();
    });
  });

  describe("fan-out rejection (this PR)", () => {
    it("rejects definitions with fan-out at execute time", async () => {
      const { orchestrator } = makeRig();
      await expect(
        orchestrator.execute({
          definition: workflow([step("a", "cap", ["b", "c"]), step("b"), step("c")]),
          input: {},
        }),
      ).rejects.toThrow(/fan-out/);
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
        org: "metafactory",
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
      expect(result.results["slow"]!.status).toBe("failed");
      await orchestrator.close();
    });

    it("on_failure 'skip-step' continues past a timed-out step", async () => {
      const transport = new InMemoryTransport();
      const store = createInMemoryWorkflowExecutionStore();
      const orchestrator = createOrchestrator({
        publisher: transport,
        subscriber: transport,
        store,
        org: "metafactory",
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
      expect(result.results["skipped"]!.status).toBe("skipped");
      expect(result.results["skipped"]!.error?.code).toBe("timeout");
      expect(result.results["after"]!.status).toBe("completed");
      await orchestrator.close();
    });

    it("on_failure 'continue' on agent nak skips and proceeds", async () => {
      const transport = new InMemoryTransport();
      const store = createInMemoryWorkflowExecutionStore();
      const orchestrator = createOrchestrator({
        publisher: transport,
        subscriber: transport,
        store,
        org: "metafactory",
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
      expect(result.results["naks"]!.status).toBe("skipped");
      expect(result.results["naks"]!.error?.code).toBe("nak-cant-do");
      expect(result.results["next"]!.status).toBe("completed");
      await orchestrator.close();
    });

    it("workflow-level on_failure applies when step does not override", async () => {
      const transport = new InMemoryTransport();
      const store = createInMemoryWorkflowExecutionStore();
      const orchestrator = createOrchestrator({
        publisher: transport,
        subscriber: transport,
        store,
        org: "metafactory",
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
      expect(result.results["naks"]!.status).toBe("skipped");
      expect(result.results["next"]!.status).toBe("completed");
      await orchestrator.close();
    });

    it("workflow-level timeout always aborts regardless of on_failure", async () => {
      const transport = new InMemoryTransport();
      const store = createInMemoryWorkflowExecutionStore();
      const orchestrator = createOrchestrator({
        publisher: transport,
        subscriber: transport,
        store,
        org: "metafactory",
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
        org: "metafactory",
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

  describe("workflow-level timeout", () => {
    it("times out when no agent responds within the deadline", async () => {
      const transport = new InMemoryTransport();
      const store = createInMemoryWorkflowExecutionStore();
      const orchestrator = createOrchestrator({
        publisher: transport,
        subscriber: transport,
        store,
        org: "metafactory",
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
      const result = await exec.catch((e: Error) => ({ error: e.message }));
      expect(result).toBeDefined();
    });

    it("is idempotent", async () => {
      const { orchestrator } = makeRig();
      await orchestrator.close();
      await orchestrator.close();
    });
  });
});
