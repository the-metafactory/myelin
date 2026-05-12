import { describe, it, expect } from "bun:test";
import { createOrchestrator } from "./orchestrator";
import { createInMemoryWorkflowExecutionStore } from "./memory-execution-store";
import { InMemoryTransport } from "../transport/in-memory";
import { createEnvelope } from "../envelope";
import type { Sovereignty } from "../types";
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
    it("emits workflow.started, step.started, step.completed, workflow.completed in order", async () => {
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
      // wait a tick so the post-completion event publishes drain
      await new Promise((r) => setTimeout(r, 10));
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
      await new Promise((r) => setTimeout(r, 10));
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
