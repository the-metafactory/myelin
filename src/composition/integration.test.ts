/**
 * F-16 T-8.2: end-to-end integration scenarios.
 *
 * These tests exercise the orchestrator against the named-agent
 * scenarios from `.specify/specs/f-16-envelope-composition-
 * orchestrator/spec.md`. They use `InMemoryTransport` (not live
 * NATS) so they stay in the `bun test` fast path; the contract
 * coverage is the same since the orchestrator depends only on
 * the `TransportPublisher` / `TransportSubscriber` interfaces.
 *
 * Granular case coverage (per-edge schemas, exhaustive failure
 * strategy permutations, cycle detection, fan-in barrier
 * semantics) lives in `orchestrator.test.ts` and
 * `composition.test.ts`. This file walks the through-line story
 * for each of the five spec scenarios + a recovery roundtrip,
 * so that what an operator reads in the spec is mechanically
 * verifiable end-to-end.
 */
import { describe, it, expect } from "bun:test";
import { createOrchestrator } from "./orchestrator";
import { createInMemoryWorkflowExecutionStore } from "./memory-execution-store";
import { validateWorkflow } from "./validate";
import { InMemoryTransport } from "../transport/in-memory";
import { createEnvelope } from "../envelope";
import type { Sovereignty, MyelinEnvelope } from "../types";
import type {
  WorkflowDefinition,
  WorkflowLifecyclePayload,
} from "./types";

const sovereignty: Sovereignty = {
  classification: "local",
  data_residency: "CH",
  max_hop: 1,
  frontier_ok: false,
  model_class: "any",
};

/** Stand up a fresh orchestrator + transport rig per test. */
function makeRig(options: { workflowTimeoutMs?: number } = {}) {
  const transport = new InMemoryTransport();
  const store = createInMemoryWorkflowExecutionStore();
  const orchestrator = createOrchestrator({
    publisher: transport,
    subscriber: transport,
    store,
    principal: "metafactory",
    source: "metafactory.cortex.composition",
    sovereignty,
    defaultWorkflowTimeoutMs: options.workflowTimeoutMs ?? 5000,
  });
  return { transport, store, orchestrator };
}

/**
 * Register an agent against a capability subject. The handler
 * returns either a `result` (dispatch.task.completed) or a
 * `failure` (dispatch.task.failed) record per the orchestrator's
 * F-020-aligned response contract.
 */
async function agent(
  transport: InMemoryTransport,
  capability: string,
  handler: (input: unknown) => Promise<{
    result?: unknown;
    failure?: { nak_reason?: string; error?: string };
  } | undefined>,
): Promise<void> {
  await transport.subscribe(
    `local.metafactory.tasks.${capability}`,
    async (env) => {
      const payload = env.payload as { task_id: string; input: unknown };
      const verdict = (await handler(payload.input)) ?? {};
      if (verdict.failure) {
        const failedEnv = createEnvelope({
          source: "agent.test",
          type: "dispatch.task.failed",
          sovereignty,
          payload: {
            task_id: payload.task_id,
            correlation_id: env.correlation_id,
            principal: `did:mf:${capability}`,
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
          principal: `did:mf:${capability}`,
          result: verdict.result,
        },
        correlation_id: env.correlation_id,
      });
      await transport.publish(`local.metafactory.dispatch.task.completed`, completedEnv);
    },
  );
}

/**
 * Subscribe to the orchestrator's lifecycle events stream and
 * accumulate them in array order. The orchestrator publishes
 * each event on `local.{principal}.dispatch.{event}` and a single
 * subscription wildcard captures them all.
 */
async function captureLifecycle(transport: InMemoryTransport): Promise<{
  events: { type: string; payload: WorkflowLifecyclePayload }[];
}> {
  const events: { type: string; payload: WorkflowLifecyclePayload }[] = [];
  await transport.subscribe(
    `local.metafactory.dispatch.workflow.>`,
    async (env: MyelinEnvelope) => {
      events.push({
        type: env.type,
        payload: env.payload as unknown as WorkflowLifecyclePayload,
      });
    },
  );
  return { events };
}

describe("F-16 integration scenarios (T-8.2)", () => {
  describe("Scenario 1: Sequential Two-Agent Pipeline", () => {
    it("routes a PR through code-review → security-scan with shared correlation_id and lifecycle events", async () => {
      const { transport, orchestrator } = makeRig();
      const { events } = await captureLifecycle(transport);

      let codeReviewInput: unknown;
      let securityScanInput: unknown;
      await agent(transport, "code-review", async (input) => {
        codeReviewInput = input;
        return { result: { reviewed: true, comments: 3 } };
      });
      await agent(transport, "security-scan", async (input) => {
        securityScanInput = input;
        return { result: { scanned: true, vulnerabilities: 0 } };
      });

      const definition: WorkflowDefinition = {
        id: "wf-pipeline-1",
        name: "code review then security scan",
        version: "1.0.0",
        steps: [
          {
            id: "code-review",
            capability: "code-review",
            input: { compatibility_key: "PullRequest.v1" },
            output: { compatibility_key: "ReviewResult.v1" },
            next: ["security-scan"],
          },
          {
            id: "security-scan",
            capability: "security-scan",
            input: { compatibility_key: "ReviewResult.v1" },
            output: { compatibility_key: "ScanResult.v1" },
          },
        ],
      };

      const result = await orchestrator.execute({
        definition,
        input: { pr_id: "PR-42", branch: "feat/x" },
      });

      expect(result.status).toBe("completed");
      expect(result.correlation_id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(codeReviewInput).toEqual({ pr_id: "PR-42", branch: "feat/x" });
      expect(securityScanInput).toEqual({ reviewed: true, comments: 3 });

      // Every lifecycle event shares the workflow's correlation_id.
      const corr = result.correlation_id;
      const types = events.map((e) => e.type);
      expect(types).toContain("workflow.started");
      expect(types).toContain("workflow.step.started");
      expect(types).toContain("workflow.step.completed");
      expect(types).toContain("workflow.completed");
      for (const e of events) expect(e.payload.correlation_id).toBe(corr);

      // Every step transitioned started → completed in declared
      // order — observe both halves of the pair, not just the
      // completion half, so a future regression that drops one
      // side fails the suite.
      const startedIds = events
        .filter((e) => e.type === "workflow.step.started")
        .map((e) => e.payload.step_id);
      const completedIds = events
        .filter((e) => e.type === "workflow.step.completed")
        .map((e) => e.payload.step_id);
      expect(startedIds).toEqual(["code-review", "security-scan"]);
      expect(completedIds).toEqual(["code-review", "security-scan"]);

      await orchestrator.close();
      await transport.close();
    });
  });

  describe("Scenario 2: Schema Mismatch Detection", () => {
    it("rejects a workflow definition with incompatible adjacent schemas at load time", () => {
      const incompatible: WorkflowDefinition = {
        id: "wf-mismatch",
        name: "summarize then deploy",
        version: "1.0.0",
        steps: [
          {
            id: "summarize",
            capability: "summarize",
            input: { compatibility_key: "Doc.v1" },
            output: { compatibility_key: "Summary.v1" },
            next: ["deploy"],
          },
          {
            id: "deploy",
            capability: "deploy",
            input: { compatibility_key: "Artifact.v1" },
            output: { compatibility_key: "DeployResult.v1" },
          },
        ],
      };
      const verdict = validateWorkflow(incompatible);
      expect(verdict.valid).toBe(false);
      const messages = (verdict.errors ?? []).map((e) => e.message).join(" ");
      expect(messages).toMatch(/incompatible|compatibility_key|schema/i);
    });
  });

  describe("Scenario 3: Fan-Out with Correlation Tracking", () => {
    it("fans triage out to three parallel branches that share the workflow correlation_id", async () => {
      const { transport, orchestrator } = makeRig();
      const { events } = await captureLifecycle(transport);

      const seenInputs: Record<string, unknown> = {};
      const seenCorr: Record<string, string | undefined> = {};
      await agent(transport, "triage", async (input) => {
        seenInputs.triage = input;
        return { result: { triage_id: "T-1", labels: ["urgent"] } };
      });
      for (const cap of ["code-review", "security-scan", "docs-check"]) {
        await agent(transport, cap, async (input) => {
          seenInputs[cap] = input;
          return { result: { from: cap, ok: true } };
        });
      }
      // Capture per-step correlation_id from the routed task
      // envelopes themselves (not the lifecycle stream) — every
      // dispatch envelope must carry the workflow's correlation_id.
      for (const cap of ["triage", "code-review", "security-scan", "docs-check"]) {
        await transport.subscribe(
          `local.metafactory.tasks.${cap}`,
          async (env) => {
            seenCorr[cap] = env.correlation_id;
          },
        );
      }

      const definition: WorkflowDefinition = {
        id: "wf-fanout",
        name: "triage then 3 reviewers",
        version: "1.0.0",
        steps: [
          {
            id: "triage",
            capability: "triage",
            input: { compatibility_key: "PullRequest.v1" },
            output: { compatibility_key: "TriageResult.v1" },
            next: ["code-review", "security-scan", "docs-check"],
            kind: "fan-out",
          },
          {
            id: "code-review",
            capability: "code-review",
            input: { compatibility_key: "TriageResult.v1" },
            output: { compatibility_key: "ReviewResult.v1" },
          },
          {
            id: "security-scan",
            capability: "security-scan",
            input: { compatibility_key: "TriageResult.v1" },
            output: { compatibility_key: "ReviewResult.v1" },
          },
          {
            id: "docs-check",
            capability: "docs-check",
            input: { compatibility_key: "TriageResult.v1" },
            output: { compatibility_key: "ReviewResult.v1" },
          },
        ],
      };

      const result = await orchestrator.execute({
        definition,
        input: { pr_id: "PR-77" },
      });
      expect(result.status).toBe("completed");
      const corr = result.correlation_id;
      // All four downstream dispatches saw the workflow's
      // correlation_id — the orchestrator does NOT mint a fresh
      // correlation per branch.
      for (const cap of ["triage", "code-review", "security-scan", "docs-check"]) {
        expect(seenCorr[cap]).toBe(corr);
      }
      // Each branch was independently tracked in lifecycle events.
      const completedSteps = events
        .filter((e) => e.type === "workflow.step.completed")
        .map((e) => e.payload.step_id);
      expect(completedSteps.sort()).toEqual([
        "code-review",
        "docs-check",
        "security-scan",
        "triage",
      ]);

      // Each fan-out branch received the triage step's output as
      // input — symmetric with Scenario 1's input assertions, so
      // future regressions on per-branch payload routing fail
      // here rather than only being detected by downstream tests.
      expect(seenInputs.triage).toEqual({ pr_id: "PR-77" });
      for (const cap of ["code-review", "security-scan", "docs-check"]) {
        expect(seenInputs[cap]).toEqual({ triage_id: "T-1", labels: ["urgent"] });
      }

      await orchestrator.close();
      await transport.close();
    });
  });

  describe("Scenario 4: Step Failure Propagation", () => {
    it("aborts the workflow on first step failure and does not execute downstream steps", async () => {
      const { transport, orchestrator } = makeRig();
      const { events } = await captureLifecycle(transport);

      let testRan = false;
      let deployRan = false;
      await agent(transport, "build", async () => ({
        failure: { error: "compilation error in src/foo.ts" },
      }));
      await agent(transport, "test", async () => {
        testRan = true;
        return { result: { passed: true } };
      });
      await agent(transport, "deploy", async () => {
        deployRan = true;
        return { result: { deployed: true } };
      });

      const definition: WorkflowDefinition = {
        id: "wf-build-test-deploy",
        name: "build then test then deploy",
        version: "1.0.0",
        on_failure: "abort",
        steps: [
          {
            id: "build",
            capability: "build",
            input: { compatibility_key: "Source.v1" },
            output: { compatibility_key: "Artifact.v1" },
            next: ["test"],
          },
          {
            id: "test",
            capability: "test",
            input: { compatibility_key: "Artifact.v1" },
            output: { compatibility_key: "TestResult.v1" },
            next: ["deploy"],
          },
          {
            id: "deploy",
            capability: "deploy",
            input: { compatibility_key: "TestResult.v1" },
            output: { compatibility_key: "DeployResult.v1" },
          },
        ],
      };

      const result = await orchestrator.execute({
        definition,
        input: { repo: "myelin", sha: "abc123" },
      });

      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("agent-error");
      expect(testRan).toBe(false);
      expect(deployRan).toBe(false);

      // workflow.step.failed for `build` and then workflow.failed
      // — observers branching on event type can find both.
      const stepFailed = events.find(
        (e) => e.type === "workflow.step.failed" && e.payload.step_id === "build",
      );
      const wfFailed = events.find((e) => e.type === "workflow.failed");
      expect(stepFailed).toBeDefined();
      expect(wfFailed).toBeDefined();
      expect(wfFailed!.payload.reason).toMatch(/compilation error/);

      await orchestrator.close();
      await transport.close();
    });
  });

  describe("Scenario 5: Timeout on Workflow Step", () => {
    it("times out a step whose agent does not respond within the configured budget", async () => {
      // 1000ms workflow budget; 250ms step budget. Step budget
      // is the canonical assertion (the agent never replies, so
      // the step's deadline fires first); the workflow budget
      // is a backstop ensuring the test still terminates if the
      // step's deadline somehow slips. 250ms (vs. the tighter
      // 100ms previously) is more tolerant of slow CI runners.
      const { transport, orchestrator } = makeRig({ workflowTimeoutMs: 1000 });
      const { events } = await captureLifecycle(transport);

      // Agent subscribes but never replies — orchestrator must
      // hit the step's timeout_ms and surface a timeout failure.
      await transport.subscribe(`local.metafactory.tasks.code-review`, async () => {
        // intentional no-op
      });

      const definition: WorkflowDefinition = {
        id: "wf-timeout",
        name: "single step with tight timeout",
        version: "1.0.0",
        steps: [
          {
            id: "code-review",
            capability: "code-review",
            input: { compatibility_key: "PullRequest.v1" },
            output: { compatibility_key: "ReviewResult.v1" },
            timeout_ms: 250,
          },
        ],
      };

      const result = await orchestrator.execute({
        definition,
        input: { pr_id: "PR-99" },
      });
      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("timeout");

      const failed = events.find(
        (e) => e.type === "workflow.step.failed" && e.payload.step_id === "code-review",
      );
      expect(failed).toBeDefined();
      expect(failed!.payload.reason).toMatch(/timeout|deadline/i);

      await orchestrator.close();
      await transport.close();
    });
  });

  describe("Recovery roundtrip (T-8.1 end-to-end)", () => {
    it("resumes mid-workflow state from the store across a fresh orchestrator instance", async () => {
      // Phase 1: original orchestrator dispatches step A, agent
      // responds, store records completion, then we drop the
      // orchestrator without ever calling B. Phase 2: a brand-
      // new orchestrator wired to the same store calls recover()
      // and the resumed run completes step B with A's recorded
      // output as input. Models a crash-restart cycle.
      const transport = new InMemoryTransport();
      const store = createInMemoryWorkflowExecutionStore();
      const definition: WorkflowDefinition = {
        id: "wf-recovery-rt",
        name: "two-step recovery",
        version: "1.0.0",
        steps: [
          {
            id: "a",
            capability: "cap",
            input: { compatibility_key: "io.v1" },
            output: { compatibility_key: "io.v1" },
            next: ["b"],
          },
          {
            id: "b",
            capability: "cap",
            input: { compatibility_key: "io.v1" },
            output: { compatibility_key: "io.v1" },
          },
        ],
      };

      // Phase 1: simulate a crash mid-execution by directly
      // writing a partially-completed snapshot to the store.
      // (Driving the orchestrator to crash in a test is racy;
      // writing the snapshot directly matches what would be on
      // disk after a real crash with step "a" complete.)
      await store.put({
        execution_id: "exec-rt-1",
        workflow_id: definition.id,
        workflow_version: definition.version,
        correlation_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        status: "running",
        current_steps: ["b"],
        completed_steps: {
          a: {
            step_id: "a",
            status: "completed",
            output: { fromA: "value-from-original-run" },
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
      });

      // Phase 2: fresh orchestrator, an agent for B, recovery.
      // Track per-capability dispatch counts so the "A was NOT
      // re-dispatched" property is asserted directly rather than
      // inferred from `bInput` equalling A's recorded output.
      let bInput: unknown;
      let agentCalls = 0;
      await agent(transport, "cap", async (input) => {
        agentCalls += 1;
        bInput = input;
        return { result: { fromB: input } };
      });
      const orch = createOrchestrator({
        publisher: transport,
        subscriber: transport,
        store,
        principal: "metafactory",
        source: "metafactory.cortex.composition",
        sovereignty,
        defaultWorkflowTimeoutMs: 5000,
        definitionLoader: (id, version) =>
          id === definition.id && version === definition.version ? definition : undefined,
      });
      const [resumed] = await orch.recover();
      expect(resumed.execution_id).toBe("exec-rt-1");
      expect(resumed.status).toBe("completed");
      // Direct assertion: B was the only agent dispatch on
      // resume. A's recorded output was reused from the store
      // (re-running A would push agentCalls to 2 and overwrite
      // B's input).
      expect(agentCalls).toBe(1);
      expect(bInput).toEqual({ fromA: "value-from-original-run" });
      // retry_count bumped exactly once on the resumed record.
      const snap = store.snapshot();
      const final = snap.find((s) => s.execution_id === "exec-rt-1")!;
      expect(final.retry_count).toBe(1);
      expect(final.status).toBe("completed");
      await orch.close();
      await transport.close();
    });
  });
});
