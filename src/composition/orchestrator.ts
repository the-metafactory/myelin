import { createEnvelope } from "../envelope";
import {
  ensureCorrelationId,
  generateCorrelationId,
} from "../dispatch/correlation";
import type {
  MyelinEnvelope,
  Sovereignty,
} from "../types";
import type {
  TransportPublisher,
  TransportSubscriber,
  Subscription,
} from "../transport/types";
import { buildStepGraph, topologicalSort } from "./graph";
import {
  createWorkflowLifecycleEvent,
} from "./lifecycle";
import { compileSchema, type CompiledValidator, type JSONSchema } from "./schema";
import type {
  ExecutionStatus,
  FailureStrategy,
  StepError,
  StepErrorCode,
  StepResult,
  WorkflowDefinition,
  WorkflowExecution,
  WorkflowLifecycleEventType,
  WorkflowStep,
} from "./types";
import type { WorkflowExecutionStore } from "./execution-store";

/**
 * F-16 T-6.1 + T-6.2: workflow orchestrator core + step dispatch.
 *
 * This PR ships the linear-only execution path. Fan-out (a step
 * with multiple `next`) and fan-in are explicitly rejected at
 * load time and remain to land in T-7.x. Per-step timeouts (T-6.3)
 * and recovery (T-8.1) are also separate follow-ups; this PR ships
 * a workflow-level deadline that prevents indefinite hangs.
 *
 * ## Wire shape
 *
 * - Step dispatch: publish a `MyelinEnvelope` with
 *   `type: "tasks.{capability}"` on subject
 *   `local.{org}.tasks.{capability}`. The envelope shares the
 *   workflow's `correlation_id`; payload carries `{ workflow_context,
 *   input }`. F-019 routing handles the rest (capability consumers
 *   pick up the task and the dispatching agent ack-completes via
 *   `dispatch.task.completed`).
 * - Response collection: subscribe once at orchestrator creation
 *   to `local.{org}.dispatch.task.completed` and `.failed`. Route
 *   incoming events by `payload.task_id` to the awaiting executor.
 *   Multiple concurrent workflow executions share the single
 *   subscriber; per-task routing keeps them independent.
 * - Workflow lifecycle: emit `workflow.started`,
 *   `workflow.step.started`, `workflow.step.completed`,
 *   `workflow.step.failed`, `workflow.completed`, `workflow.failed`
 *   via the existing `createWorkflowLifecycleEvent` helper. Subjects
 *   live under `local.{org}.dispatch.workflow.{state}`.
 *
 * ## State store
 *
 * Every state transition (workflow started, step started, step
 * completed/failed, workflow completed/failed) writes the full
 * `WorkflowExecution` to the bound store. The recovery flow
 * (T-8.1) reads `listRunning()` on boot to rehydrate orchestrators.
 * Slow stores backpressure the execution path — operators should
 * prefer the NATS KV impl in production.
 *
 * ## Step error mapping
 *
 * Dispatch failures surface through the F-020 `dispatch.task.failed`
 * lifecycle event. The orchestrator maps F-22 structured nak reasons
 * to `StepError.code` per the table:
 *
 *   nak_reason  → StepErrorCode
 *   "cant-do"   → "nak-cant-do"
 *   "wont-do"   → "nak-wont-do"
 *   "not-now"   → "nak-not-now"
 *   (absent)    → "agent-error"
 *
 * Output schema validation failures emit `"schema-mismatch"`. The
 * dead-letter path (`"dead-letter"`) is consumed in T-8.1 once the
 * recovery flow can re-publish from `TASKS_DEAD`.
 *
 * ## Provenance caveat — `agent_principal` is self-reported
 *
 * `StepResult.agent_principal` records the value the responding
 * agent claimed in its `dispatch.task.completed` / `.failed`
 * payload. The orchestrator does NOT verify this against the
 * envelope signature chain — that is the identity layer's job
 * (`verifyEnvelopeIdentity` in `src/identity/verify.ts`, chain
 * shipped in myelin#31). Production deployments that need a
 * forge-resistant audit trail SHOULD wrap their `publisher` /
 * `subscriber` with a transport that enforces signature verification
 * before payloads reach the orchestrator. The
 * `onMalformedResponse` callback observes wire-format failures but
 * not identity-spoofing.
 *
 * ## Per-step latency floor
 *
 * Each step incurs (at minimum): 1 store.put for `step.started`,
 * 1 publish for `workflow.step.started`, 1 publish for the task
 * dispatch, the agent's own work + a RTT for its response, 1 store.put
 * for `step.completed`, 1 publish for `workflow.step.completed`. With
 * a remote store (NATS KV in production) that is ~4 sequential RTTs
 * of overhead per step. Acceptable for typical workflows (sub-10
 * steps); document this ceiling before fan-out lands in T-7.x where
 * the per-step cost multiplies across branches.
 */

export type DispatchTaskCompletedPayload = {
  task_id: string;
  correlation_id?: string;
  result?: unknown;
  principal?: string;
};

export type DispatchTaskFailedPayload = {
  task_id: string;
  correlation_id?: string;
  nak_reason?: string;
  error?: string;
  principal?: string;
};

export interface OrchestratorOptions {
  publisher: TransportPublisher;
  subscriber: TransportSubscriber;
  store: WorkflowExecutionStore;
  /** Org slug. Subjects derive from this. */
  org: string;
  /** Source field for orchestrator-emitted envelopes. */
  source: string;
  /** Sovereignty block stamped on orchestrator-emitted envelopes. */
  sovereignty: Sovereignty;
  /** Workflow-level timeout. Defaults to 30 minutes. */
  defaultWorkflowTimeoutMs?: number;
  /** Clock override for deterministic tests. */
  now?: () => Date;
  /**
   * UUID factory override for deterministic tests. MUST return a
   * globally unique value across the LIFETIME of the orchestrator,
   * not just per `execute()` call. The orchestrator holds a single
   * `Map<task_id, Pending>` shared across concurrent executions; a
   * fixed-value override (`() => "constant"`) silently breaks
   * routing as soon as two `execute()` calls overlap because the
   * second `pending.set` overwrites the first. Default is
   * `crypto.randomUUID()` which satisfies the contract.
   */
  uuid?: () => string;
  /**
   * Observer for malformed `dispatch.task.*` responses (missing
   * `task_id`, non-object payload, etc.). Defaults to
   * `console.error`. Production deployments should bind a
   * structured logger or alert-router so a wire-format drift
   * surfaces visibly rather than hanging the workflow silently.
   */
  onMalformedResponse?: (info: {
    reason:
      | "missing-task-id"
      | "non-object-payload"
      | "unknown-task-id"
      | "correlation-mismatch"
      | "unknown-type";
    envelope: MyelinEnvelope;
    expected_correlation_id?: string;
  }) => void;
}

export interface ExecuteWorkflowInput {
  definition: WorkflowDefinition;
  input: unknown;
  /** Override the auto-generated correlation_id. Must be UUID v4. */
  correlation_id?: string;
}

export interface ExecuteWorkflowResult {
  execution_id: string;
  correlation_id: string;
  status: ExecutionStatus;
  output?: unknown;
  error?: StepError;
  results: Record<string, StepResult>;
}

export interface WorkflowOrchestrator {
  execute(input: ExecuteWorkflowInput): Promise<ExecuteWorkflowResult>;
  close(): Promise<void>;
}

type Pending = {
  resolve: (payload: { kind: "completed" | "failed"; payload: DispatchTaskCompletedPayload | DispatchTaskFailedPayload }) => void;
  reject: (err: Error) => void;
  /**
   * The correlation_id the orchestrator stamped on the outgoing
   * dispatch. Responses with a mismatched correlation_id are
   * silent-dropped (logged via onMalformedResponse) rather than
   * resolving this waiter — defends against an attacker (or buggy
   * agent) who knows a task_id but not the workflow's correlation.
   */
  correlation_id: string;
};

const DEFAULT_WORKFLOW_TIMEOUT_MS = 30 * 60 * 1000;

function mapNakToStepErrorCode(nak?: string): StepErrorCode {
  switch (nak) {
    case "cant-do":
      return "nak-cant-do";
    case "wont-do":
      return "nak-wont-do";
    case "not-now":
      return "nak-not-now";
    default:
      return "agent-error";
  }
}

export function createOrchestrator(options: OrchestratorOptions): WorkflowOrchestrator {
  const { publisher, subscriber, store, org, source, sovereignty } = options;
  const now = options.now ?? (() => new Date());
  const uuid = options.uuid ?? (() => crypto.randomUUID());
  const workflowTimeoutMs = options.defaultWorkflowTimeoutMs ?? DEFAULT_WORKFLOW_TIMEOUT_MS;
  const onMalformedResponse =
    options.onMalformedResponse ??
    ((info) => {
      console.error(
        `[orchestrator] dropped malformed dispatch response: reason=${info.reason} envelope_id=${info.envelope.id} type=${info.envelope.type} source=${info.envelope.source}`,
      );
    });

  const pending = new Map<string, Pending>();
  // Memoize compiled validators per WorkflowDefinition. Ajv
  // compilation is expensive (generates JavaScript from the schema)
  // and definitions are immutable per (id, version). WeakMap keying
  // on the definition object lets the GC reclaim the cache when the
  // definition is dropped.
  const validatorCache = new WeakMap<WorkflowDefinition, Map<string, CompiledValidator>>();
  let lifecycleSub: Subscription | null = null;
  // In-flight subscribe Promise. The `if (lifecycleSub) return`
  // guard alone has a TOCTOU window — two concurrent execute()
  // calls both arriving before the first subscribe() resolves
  // would both call `subscriber.subscribe()` and end up with two
  // active subscriptions on the same wildcard subject. Sharing the
  // in-flight Promise collapses concurrent attempts into one.
  let subscribingPromise: Promise<Subscription> | null = null;
  let closed = false;

  async function ensureSubscribed(): Promise<void> {
    if (lifecycleSub) return;
    if (!subscribingPromise) {
      const subject = `local.${org}.dispatch.task.>`;
      subscribingPromise = subscriber.subscribe(subject, async (env: MyelinEnvelope) => {
      const raw = env.payload;
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        onMalformedResponse({ reason: "non-object-payload", envelope: env });
        return;
      }
      const payload = raw as Record<string, unknown>;
      const task_id = typeof payload.task_id === "string" ? (payload.task_id as string) : undefined;
      if (!task_id) {
        onMalformedResponse({ reason: "missing-task-id", envelope: env });
        return;
      }
      const waiter = pending.get(task_id);
      if (!waiter) {
        onMalformedResponse({ reason: "unknown-task-id", envelope: env });
        return;
      }
      // Verify the response carries the SAME correlation_id the
      // orchestrator stamped on the outgoing dispatch. Mismatched
      // responses (spoofing, buggy agent) drop silently with a log
      // rather than resolving the waiter.
      if (env.correlation_id !== waiter.correlation_id) {
        onMalformedResponse({
          reason: "correlation-mismatch",
          envelope: env,
          expected_correlation_id: waiter.correlation_id,
        });
        return;
      }
      if (env.type === "dispatch.task.completed") {
        pending.delete(task_id);
        waiter.resolve({ kind: "completed", payload: payload as DispatchTaskCompletedPayload });
      } else if (env.type === "dispatch.task.failed") {
        pending.delete(task_id);
        waiter.resolve({ kind: "failed", payload: payload as DispatchTaskFailedPayload });
      } else {
        // Known task_id + matching correlation but the type is
        // neither completed nor failed (e.g. a future
        // `dispatch.task.acked` / `.progress` that the F-020
        // namespace grows later). Do NOT resolve the waiter — the
        // step is still in flight as far as F-16 is concerned, but
        // surface the discard through onMalformedResponse so
        // operators see wire-format drift before it manifests as
        // a workflow timeout.
        onMalformedResponse({ reason: "unknown-type", envelope: env });
      }
      });
    }
    lifecycleSub = await subscribingPromise;
  }

  function emitLifecycle(
    type: WorkflowLifecycleEventType,
    correlation_id: string,
    workflow_id: string,
    step?: { id: string; capability: string },
    reason?: string,
  ): Promise<void> {
    const { subject, envelope } = createWorkflowLifecycleEvent({
      org,
      source,
      sovereignty,
      type,
      correlation_id,
      input: {
        workflow_id,
        correlation_id,
        ...(step ? { step_id: step.id, capability: step.capability } : {}),
        ...(reason ? { reason } : {}),
      },
    });
    return publisher.publish(subject, envelope);
  }

  function newExecution(
    definition: WorkflowDefinition,
    correlation_id: string,
    input: unknown,
  ): WorkflowExecution {
    const ts = now().toISOString();
    return {
      execution_id: uuid(),
      workflow_id: definition.id,
      workflow_version: definition.version,
      correlation_id,
      status: "running",
      current_steps: [],
      completed_steps: {},
      pending_fan_in: {},
      input,
      started_at: ts,
      last_checkpoint_at: ts,
      retry_count: 0,
    };
  }

  function checkpoint(exec: WorkflowExecution): WorkflowExecution {
    exec.last_checkpoint_at = now().toISOString();
    return exec;
  }

  async function dispatchTask(
    step: WorkflowStep,
    correlation_id: string,
    execution_id: string,
    stepInput: unknown,
  ): Promise<{ task_id: string; waiter: Promise<{ kind: "completed" | "failed"; payload: DispatchTaskCompletedPayload | DispatchTaskFailedPayload }> }> {
    const task_id = uuid();
    const subject = `local.${org}.tasks.${step.capability}`;
    const envelope = createEnvelope({
      source,
      type: `tasks.${step.capability}`,
      sovereignty,
      payload: {
        task_id,
        workflow_context: {
          execution_id,
          step_id: step.id,
        },
        input: stepInput,
      },
      correlation_id,
    });
    // pending.set must happen BEFORE publish — the response could
    // arrive faster than the await resolves (in-memory transports do
    // synchronous fanout), and the handler must find the task_id in
    // the map. On publish failure we delete the pending entry to
    // prevent leak; the waiter Promise is never returned to any
    // caller and never has `.then`/`.catch` attached, so it sits
    // dormant until GC — no unhandled rejection.
    const waiter = new Promise<{
      kind: "completed" | "failed";
      payload: DispatchTaskCompletedPayload | DispatchTaskFailedPayload;
    }>((resolve, reject) => {
      pending.set(task_id, { resolve, reject, correlation_id });
    });
    try {
      await publisher.publish(subject, envelope);
    } catch (err) {
      pending.delete(task_id);
      throw err instanceof Error ? err : new Error(String(err));
    }
    return { task_id, waiter };
  }

  function rejectFanOut(definition: WorkflowDefinition): void {
    for (const step of definition.steps) {
      if (step.next && step.next.length > 1) {
        throw new Error(
          `F-16 orchestrator T-6.x: step '${step.id}' has fan-out (${step.next.length} children); fan-out is deferred to T-7.x`,
        );
      }
    }
  }

  function rejectUnsupportedStrategies(definition: WorkflowDefinition): void {
    // T-6.3 honors "abort", "skip-step", and "continue". "retry" is a
    // declared FailureStrategy literal but unimplemented per plan.md
    // §Q3; reject at load time rather than silently coercing to
    // skip-step.
    const strategies: Array<FailureStrategy | undefined> = [definition.on_failure];
    for (const step of definition.steps) strategies.push(step.on_failure);
    for (const s of strategies) {
      if (s === undefined) continue;
      if (s !== "abort" && s !== "skip-step" && s !== "continue") {
        throw new Error(
          `F-16 orchestrator T-6.3: on_failure '${s}' is not implemented in this PR; supported: abort | skip-step | continue`,
        );
      }
    }
  }

  /**
   * Resolves the failure strategy for a step and emits the right
   * lifecycle event. Returns whether the executor should abort the
   * workflow or skip and continue. Centralizes the
   * timeout/nak/schema-mismatch failure handling so future strategy
   * variants land in one place.
   *
   * Order of operations matters:
   *   1. Resolve strategy from step → definition → default.
   *   2. Apply the in-memory state change first (status mutation,
   *      completed_at, etc.).
   *   3. Checkpoint to the store BEFORE the lifecycle emit so the
   *      observable order is store-then-event — preventing the
   *      observability inversion Echo cycle 1 flagged where step
   *      events fire as "failed" but the store holds "skipped".
   *   4. Emit the appropriate lifecycle (failed/skipped).
   */
  async function applyFailureStrategy(
    exec: WorkflowExecution,
    step: WorkflowStep,
    definition: WorkflowDefinition,
    failedResult: StepResult,
    correlation_id: string,
  ): Promise<"abort" | "skip"> {
    const strategy = step.on_failure ?? definition.on_failure ?? "abort";
    if (strategy === "abort") {
      exec.completed_steps[step.id] = failedResult;
      await store.put(checkpoint(exec));
      await emitLifecycle("workflow.step.failed", correlation_id, definition.id, step, failedResult.error?.message);
      return "abort";
    }
    // "skip-step" / "continue"
    exec.completed_steps[step.id] = { ...failedResult, status: "skipped" };
    await store.put(checkpoint(exec));
    await emitLifecycle(
      "workflow.step.skipped",
      correlation_id,
      definition.id,
      step,
      failedResult.error?.message,
    );
    return "skip";
  }

  return {
    async execute({ definition, input, correlation_id: corrInput }) {
      if (closed) throw new Error("orchestrator is closed");
      rejectFanOut(definition);
      rejectUnsupportedStrategies(definition);
      await ensureSubscribed();

      const correlation_id = corrInput
        ? ensureCorrelationId({ correlation_id: corrInput }).correlation_id!
        : generateCorrelationId();

      const exec = newExecution(definition, correlation_id, input);
      await store.put(exec);

      await emitLifecycle("workflow.started", correlation_id, definition.id);

      // Linear-only: topological sort yields execution order;
      // we ignore any branching topology (rejectFanOut already
      // guarded against multi-`next` steps).
      const graph = buildStepGraph(definition);
      const order = topologicalSort(graph);
      if (!order) {
        const err: StepError = {
          code: "validation-failed",
          message: "workflow definition has a cycle",
        };
        exec.status = "failed";
        exec.error = err;
        exec.completed_at = now().toISOString();
        await store.put(checkpoint(exec));
        await emitLifecycle("workflow.failed", correlation_id, definition.id, undefined, err.message);
        return resultOf(exec);
      }

      let validators = validatorCache.get(definition);
      if (!validators) {
        validators = new Map<string, CompiledValidator>();
        for (const step of definition.steps) {
          const stepSchema = step.output.data_schema;
          if (stepSchema) validators.set(step.id, compileSchema(stepSchema as JSONSchema));
        }
        validatorCache.set(definition, validators);
      }

      let stepInput: unknown = input;
      const deadline = now().getTime() + workflowTimeoutMs;

      for (const stepId of order) {
        const step = graph.steps.get(stepId)!;
        exec.current_steps = [stepId];
        await store.put(checkpoint(exec));
        await emitLifecycle("workflow.step.started", correlation_id, definition.id, step);

        const workflowRemaining = deadline - now().getTime();
        if (workflowRemaining <= 0) {
          const err: StepError = { code: "timeout", message: "workflow deadline exceeded" };
          await failWorkflow(exec, err, step);
          return resultOf(exec);
        }

        // T-6.3: per-step timeout takes the MIN of the step's
        // declared budget and the workflow's remaining budget so
        // a long step.timeout_ms can't escape a tight workflow
        // budget, and a long workflow can still enforce a tight
        // step ceiling. Steps with no `timeout_ms` use the
        // workflow remaining as their effective budget.
        const stepBudget = step.timeout_ms !== undefined
          ? Math.min(step.timeout_ms, workflowRemaining)
          : workflowRemaining;
        const stepTimedOutFromStep =
          step.timeout_ms !== undefined && step.timeout_ms <= workflowRemaining;

        const { task_id, waiter } = await dispatchTask(step, correlation_id, exec.execution_id, stepInput);

        let timer: ReturnType<typeof setTimeout> | undefined;
        const winner = await Promise.race([
          waiter.then((v) => ({ kind: "result" as const, value: v })),
          new Promise<{ kind: "deadline" }>((resolve) => {
            timer = setTimeout(() => resolve({ kind: "deadline" }), stepBudget);
          }),
        ]);
        if (timer) clearTimeout(timer);

        if (winner.kind === "deadline") {
          pending.delete(task_id);
          // Re-check the workflow deadline INSIDE the deadline
          // branch. The pre-await `stepTimedOutFromStep` snapshot
          // could mis-classify a near-boundary timeout as
          // step-level when the dispatch latency consumed the
          // workflow's remaining slack. Workflow deadline always
          // wins → abort regardless of step.on_failure.
          const workflowExhausted = deadline - now().getTime() <= 0;
          const isStepTimeout = stepTimedOutFromStep && !workflowExhausted;
          const err: StepError = isStepTimeout
            ? {
                code: "timeout",
                message: `step '${step.id}' exceeded timeout_ms (${step.timeout_ms}ms)`,
                details: { step_id: step.id, timeout_ms: step.timeout_ms },
              }
            : { code: "timeout", message: "workflow deadline exceeded during step dispatch" };
          const startedAt = exec.last_checkpoint_at;
          const completedAt = now().toISOString();
          const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();
          const stepResult: StepResult = {
            step_id: step.id,
            status: "failed",
            started_at: startedAt,
            completed_at: completedAt,
            duration_ms: durationMs,
            error: err,
          };
          if (!isStepTimeout) {
            // Workflow-level timeout: always abort. Apply
            // store-before-event ordering to match the helper:
            // mutate exec, checkpoint, THEN emit step.failed +
            // fail workflow. Observers never see the event before
            // the store reflects the state.
            exec.completed_steps[step.id] = stepResult;
            await store.put(checkpoint(exec));
            await emitLifecycle("workflow.step.failed", correlation_id, definition.id, step, err.message);
            await failWorkflow(exec, err, step);
            return resultOf(exec);
          }
          const decision = await applyFailureStrategy(
            exec,
            step,
            definition,
            stepResult,
            correlation_id,
          );
          if (decision === "abort") {
            await failWorkflow(exec, err, step);
            return resultOf(exec);
          }
          continue;
        }

        const startedAt = exec.last_checkpoint_at;
        const completedAt = now().toISOString();
        const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

        if (winner.value.kind === "failed") {
          const failed = winner.value.payload as DispatchTaskFailedPayload;
          const err: StepError = {
            code: mapNakToStepErrorCode(failed.nak_reason),
            message: failed.error ?? failed.nak_reason ?? "agent reported failure",
            ...(failed.nak_reason ? { details: { nak_reason: failed.nak_reason } } : {}),
          };
          const result: StepResult = {
            step_id: step.id,
            status: "failed",
            ...(failed.principal ? { agent_principal: failed.principal } : {}),
            started_at: startedAt,
            completed_at: completedAt,
            duration_ms: durationMs,
            error: err,
          };
          const decision = await applyFailureStrategy(
            exec,
            step,
            definition,
            result,
            correlation_id,
          );
          if (decision === "abort") {
            await failWorkflow(exec, err, step);
            return resultOf(exec);
          }
          continue;
        }

        const completed = winner.value.payload as DispatchTaskCompletedPayload;
        const output = completed.result;

        const validator = validators.get(step.id);
        if (validator) {
          const check = validator(output);
          if (!check.valid) {
            const err: StepError = {
              code: "schema-mismatch",
              message: "step output did not match declared output_schema",
              details: check.errors,
            };
            const result: StepResult = {
              step_id: step.id,
              status: "failed",
              ...(completed.principal ? { agent_principal: completed.principal } : {}),
              started_at: startedAt,
              completed_at: completedAt,
              duration_ms: durationMs,
              error: err,
            };
            const decision = await applyFailureStrategy(
              exec,
              step,
              definition,
              result,
              correlation_id,
            );
            if (decision === "abort") {
              await failWorkflow(exec, err, step);
              return resultOf(exec);
            }
            continue;
          }
        }

        const result: StepResult = {
          step_id: step.id,
          status: "completed",
          output,
          ...(completed.principal ? { agent_principal: completed.principal } : {}),
          started_at: startedAt,
          completed_at: completedAt,
          duration_ms: durationMs,
        };
        exec.completed_steps[step.id] = result;
        await store.put(checkpoint(exec));
        await emitLifecycle("workflow.step.completed", correlation_id, definition.id, step);

        stepInput = output;
      }

      exec.current_steps = [];
      exec.status = "completed";
      exec.output = stepInput;
      exec.completed_at = now().toISOString();
      await store.put(checkpoint(exec));
      await emitLifecycle("workflow.completed", correlation_id, definition.id);
      return resultOf(exec);

      async function failWorkflow(
        execution: WorkflowExecution,
        err: StepError,
        atStep: WorkflowStep,
      ): Promise<void> {
        execution.status = "failed";
        execution.error = err;
        execution.completed_at = now().toISOString();
        execution.current_steps = [];
        await store.put(checkpoint(execution));
        await emitLifecycle("workflow.failed", correlation_id, definition.id, atStep, err.message);
      }
    },

    async close() {
      if (closed) return;
      closed = true;
      if (lifecycleSub) {
        await lifecycleSub.unsubscribe();
        lifecycleSub = null;
      }
      for (const waiter of pending.values()) {
        waiter.reject(new Error("orchestrator closed"));
      }
      pending.clear();
    },
  };
}

function resultOf(exec: WorkflowExecution): ExecuteWorkflowResult {
  return {
    execution_id: exec.execution_id,
    correlation_id: exec.correlation_id,
    status: exec.status,
    ...(exec.output !== undefined ? { output: exec.output } : {}),
    ...(exec.error ? { error: exec.error } : {}),
    results: { ...exec.completed_steps },
  };
}
