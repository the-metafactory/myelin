import { createEnvelope } from "../../envelope";
import {
  dispatchTaskLifecycleWildcard,
  taskSubject,
} from "../../subjects";
import {
  ensureCorrelationId,
  generateCorrelationId,
} from "../../dispatch/correlation";
import { readPayloadIdentity } from "../../dispatch/payload-identity";
import type { MyelinEnvelope } from "../../types";
import { buildStepGraph, findEntrySteps, topologicalSort } from "../graph";
import { compileSchema, type CompiledValidator } from "../schema";
import type {
  StepError,
  StepResult,
  WorkflowExecution,
  WorkflowStep,
} from "../types";
import type {
  DispatchTaskCompletedPayload,
  DispatchTaskFailedPayload,
  ExecuteWorkflowInput,
  ExecuteWorkflowResult,
} from "../orchestrator";
import type {
  BranchResult,
  ChainCtx,
  FanInBarrier,
  FanInBranchStatus,
  OrchestratorContext,
  ResumeMarker,
  StepOutcome,
} from "./context";
import {
  checkpoint,
  emitLifecycle,
  mapNakToStepErrorCode,
  newExecution,
  resultOf,
  syncCurrentSteps,
} from "./state";
import {
  detectExcessiveDepth,
  detectExcessiveFanWidth,
  rejectUnsupportedStrategies,
} from "./validation";

export async function ensureSubscribed(ctx: OrchestratorContext): Promise<void> {
  if (ctx.lifecycleSub) return;
  if (!ctx.subscribingPromise) {
    const subject = dispatchTaskLifecycleWildcard(ctx.principal);
    // Callback signature is async to match the subscriber contract;
    // body is synchronous routing logic.
    // eslint-disable-next-line @typescript-eslint/require-await
    ctx.subscribingPromise = ctx.subscriber.subscribe(subject, async (env: MyelinEnvelope) => {
      const raw = env.payload;
      // Defensive narrow against parsed-untrusted-JSON: TS sees `payload` as
      // non-nullable here, but a malformed envelope at runtime can yield null.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        ctx.onMalformedResponse({ reason: "non-object-payload", envelope: env });
        return;
      }
      // ESLint's no-unnecessary-type-assertion auto-fix would drop this
      // cast, but downstream `payload as Dispatch*Payload` casts
      // require a `Record<string, unknown>` origin — not the bare
      // `object` that survives the typeof/null/Array.isArray narrow.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      const payload = raw as Record<string, unknown>;
      const task_id = typeof payload.task_id === "string" ? payload.task_id : undefined;
      if (!task_id) {
        ctx.onMalformedResponse({ reason: "missing-task-id", envelope: env });
        return;
      }
      const waiter = ctx.pending.get(task_id);
      if (!waiter) {
        ctx.onMalformedResponse({ reason: "unknown-task-id", envelope: env });
        return;
      }
      // Verify the response carries the SAME correlation_id the
      // orchestrator stamped on the outgoing dispatch. Mismatched
      // responses (spoofing, buggy agent) drop silently with a log
      // rather than resolving the waiter.
      if (env.correlation_id !== waiter.correlation_id) {
        ctx.onMalformedResponse({
          reason: "correlation-mismatch",
          envelope: env,
          expected_correlation_id: waiter.correlation_id,
        });
        return;
      }
      // R2 (vocabulary migration 2026-05, PR-10) — reject a response
      // payload carrying BOTH the deprecated `principal` and the
      // canonical `identity` actor-DID keys. Same trust-boundary
      // conflict-rejection contract as PR-6's envelope.ts and PR-7's
      // dispatch payload-identity reader. Surface via the existing
      // malformed-response observer so wire-format drift is visible.
      const identityRead = readPayloadIdentity(payload);
      if (identityRead.conflict) {
        ctx.onMalformedResponse({ reason: "payload-identity-conflict", envelope: env });
        return;
      }
      if (env.type === "dispatch.task.completed") {
        ctx.pending.delete(task_id);
        waiter.resolve({
          kind: "completed",
          payload: payload as unknown as DispatchTaskCompletedPayload,
        });
      } else if (env.type === "dispatch.task.failed") {
        ctx.pending.delete(task_id);
        waiter.resolve({
          kind: "failed",
          payload: payload as unknown as DispatchTaskFailedPayload,
        });
      } else {
        // Known task_id + matching correlation but the type is
        // neither completed nor failed (e.g. a future
        // `dispatch.task.acked` / `.progress` that the F-020
        // namespace grows later). Do NOT resolve the waiter — the
        // step is still in flight as far as F-16 is concerned, but
        // surface the discard through onMalformedResponse so
        // operators see wire-format drift before it manifests as
        // a workflow timeout.
        ctx.onMalformedResponse({ reason: "unknown-type", envelope: env });
      }
    });
  }
  ctx.lifecycleSub = await ctx.subscribingPromise;
}

export async function dispatchTask(
  ctx: OrchestratorContext,
  step: WorkflowStep,
  correlation_id: string,
  execution_id: string,
  stepInput: unknown,
): Promise<{ task_id: string; waiter: Promise<{ kind: "completed" | "failed"; payload: DispatchTaskCompletedPayload | DispatchTaskFailedPayload }> }> {
  const task_id = ctx.uuid();
  const subject = taskSubject(ctx.principal, step.capability);
  const envelope = createEnvelope({
    source: ctx.source,
    type: `tasks.${step.capability}`,
    sovereignty: ctx.sovereignty,
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
    ctx.pending.set(task_id, { resolve, reject, correlation_id });
  });
  try {
    await ctx.publisher.publish(subject, envelope);
  } catch (err) {
    ctx.pending.delete(task_id);
    throw err instanceof Error ? err : new Error(String(err));
  }
  return { task_id, waiter };
}

/**
 * Build the fan-in aggregation payload for a step. Outputs are
 * sorted by `step_id` alphabetically so the aggregation is
 * deterministic for downstream consumers (Echo cycle-2 W5 lesson:
 * unstable ordering creates correctness gaps).
 *
 * Each branch entry carries a `status` literal so the fan-in
 * agent can distinguish a normally-completed parent from a
 * parent that was skipped (via on_failure: skip-step / continue)
 * and whose `output` is the chain's pre-step input rather than a
 * computed result. Without this distinction the aggregation
 * payload conflates the two and downstream consumers cannot
 * detect partial-failure aggregations.
 */
export function aggregateFanIn(
  barrier: FanInBarrier,
): { branches: { step_id: string; status: FanInBranchStatus; output: unknown }[] } {
  const stepIds = Array.from(barrier.outputs.keys()).sort();
  return {
    branches: stepIds.map((step_id) => {
      // step_id came from `barrier.outputs.keys()` — `.get` is guaranteed.
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const entry = barrier.outputs.get(step_id)!;
      return { step_id, status: entry.status, output: entry.output };
    }),
  };
}

/**
 * Run a single step: emit started lifecycle, dispatch, await
 * response or timeout, validate output schema, apply failure
 * strategy. Returns one of three outcomes — advance with the
 * step's output, skip (under skip-step / continue), or abort.
 *
 * Does NOT call `failWorkflow` directly; that's the chain
 * walker's job once the cascade resolves.
 */
export async function runStep(step: WorkflowStep, stepInput: unknown, ctx: ChainCtx): Promise<StepOutcome> {
  const { exec, definition, validators, deadline, correlation_id, octx } = ctx;
  const { store, pending, now } = octx;

  // T-8.1 recovery short-circuit. If this step is already in
  // `exec.completed_steps` from a prior run (recovery seeded
  // them via the ResumeMarker on newExecution), reuse the
  // recorded result rather than re-dispatching. "completed"
  // returns `advance` with the persisted output; "skipped"
  // returns `skip`. This makes re-execution after a crash
  // O(in-flight-step-count) rather than O(workflow-size) and
  // avoids paying the agent dispatch cost for work already
  // done.
  // A missing key is undefined at runtime (now enforced by
  // noUncheckedIndexedAccess) — keep the guard.
  const priorResult = exec.completed_steps[step.id];
  if (priorResult) {
    switch (priorResult.status) {
      case "completed": {
        // Schema-drift gate (cycle-1 carry-forward). The prior
        // recorded output was validated against the definition
        // active at the time of its dispatch; a recovery that
        // resumes against a NEW definition whose data_schema
        // tightened could otherwise silently accept output the
        // current contract rejects. Re-validate against the
        // current validator (built from the new definition);
        // a mismatch surfaces as `schema-mismatch` and runs
        // through the same failure-strategy path as a fresh
        // dispatch's schema mismatch would.
        const validator = validators.get(step.id);
        if (validator) {
          const check = validator(priorResult.output);
          if (!check.valid) {
            const err: StepError = {
              code: "schema-mismatch",
              message:
                "F-16 recovery: prior step output no longer matches the workflow definition's data_schema (schema drift across recovery boundary)",
              details: check.errors,
            };
            const ts = now().toISOString();
            const failedResult: StepResult = {
              step_id: step.id,
              status: "failed",
              started_at: priorResult.started_at ?? ts,
              completed_at: ts,
              duration_ms: 0,
              error: err,
            };
            const decision = await applyFailureStrategy(
              octx,
              exec,
              step,
              definition,
              failedResult,
              correlation_id,
            );
            if (decision === "abort") return { kind: "abort", error: err };
            return { kind: "skip" };
          }
        }
        return { kind: "advance", output: priorResult.output };
      }
      case "skipped":
        return { kind: "skip" };
      case "failed":
      case "pending":
      case "running":
        // Re-dispatch. A step recorded in completed_steps with a
        // non-terminal status is a crash victim (`running`), never
        // actually started (`pending`), or had a prior failure
        // worth retrying on resume (`failed`). All three fall
        // through to a fresh dispatch — the prior record stays in
        // place until the new dispatch overwrites it.
        break;
      default: {
        // Exhaustiveness gate: a future StepStatus literal added
        // upstream must be classified here explicitly, not
        // silently re-dispatched.
        const _exhaustive: never = priorResult.status;
        throw new Error(`F-16 orchestrator: unhandled prior StepResult.status '${String(_exhaustive)}' on step '${step.id}'`);
      }
    }
  }

  // Order: emit step.started FIRST with a snapshot that does
  // not yet include this step, then add to inFlight and
  // re-checkpoint. Under fan-out this prevents the observability
  // inversion where a subscriber receives `step.started(a)` but
  // the accompanying snapshot already contains both `a` and `b`
  // because both branches added to the shared set before either
  // emitted. Each step's started-event sees the
  // pre-this-step-started snapshot.
  // Snapshot this step's wall-clock start LOCALLY so concurrent
  // sibling branches checkpointing exec.last_checkpoint_at can't
  // clobber our duration measurement.
  const startedAt = now().toISOString();
  await emitLifecycle(octx, "workflow.step.started", correlation_id, definition.id, step);
  ctx.inFlight.add(step.id);
  syncCurrentSteps(exec, ctx.inFlight);
  await store.put(checkpoint(octx, exec));

  const workflowRemaining = deadline - now().getTime();
  if (workflowRemaining <= 0) {
    ctx.inFlight.delete(step.id);
    syncCurrentSteps(exec, ctx.inFlight);
    const err: StepError = { code: "timeout", message: "workflow deadline exceeded" };
    return { kind: "abort", error: err };
  }

  const stepBudget = step.timeout_ms !== undefined
    ? Math.min(step.timeout_ms, workflowRemaining)
    : workflowRemaining;
  const stepTimedOutFromStep =
    step.timeout_ms !== undefined && step.timeout_ms <= workflowRemaining;

  const { task_id, waiter } = await dispatchTask(octx, step, correlation_id, exec.execution_id, stepInput);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const winner = await Promise.race([
    waiter.then((v) => ({ kind: "result" as const, value: v })),
    new Promise<{ kind: "deadline" }>((resolve) => {
      timer = setTimeout(() => { resolve({ kind: "deadline" }); }, stepBudget);
    }),
  ]);
  if (timer) clearTimeout(timer);

  // Mark this step out-of-flight in the shared set, then sync
  // to exec.current_steps for downstream lifecycle visibility.
  ctx.inFlight.delete(step.id);
  syncCurrentSteps(exec, ctx.inFlight);

  const completedAt = now().toISOString();
  const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

  if (winner.kind === "deadline") {
    pending.delete(task_id);
    const workflowExhausted = deadline - now().getTime() <= 0;
    const isStepTimeout = stepTimedOutFromStep && !workflowExhausted;
    const err: StepError = isStepTimeout
      ? {
          code: "timeout",
          message: `step '${step.id}' exceeded timeout_ms (${step.timeout_ms}ms)`,
          details: { step_id: step.id, timeout_ms: step.timeout_ms },
        }
      : { code: "timeout", message: "workflow deadline exceeded during step dispatch" };
    const stepResult: StepResult = {
      step_id: step.id,
      status: "failed",
      started_at: startedAt,
      completed_at: completedAt,
      duration_ms: durationMs,
      error: err,
    };
    if (!isStepTimeout) {
      exec.completed_steps[step.id] = stepResult;
      await store.put(checkpoint(octx, exec));
      await emitLifecycle(octx, "workflow.step.failed", correlation_id, definition.id, step, err.message);
      return { kind: "abort", error: err };
    }
    const decision = await applyFailureStrategy(octx, exec, step, definition, stepResult, correlation_id);
    if (decision === "abort") return { kind: "abort", error: err };
    return { kind: "skip" };
  }

  if (winner.value.kind === "failed") {
    const failed = winner.value.payload as DispatchTaskFailedPayload;
    const err: StepError = {
      code: mapNakToStepErrorCode(failed.nak_reason),
      message: failed.error ?? failed.nak_reason ?? "agent reported failure",
      ...(failed.nak_reason ? { details: { nak_reason: failed.nak_reason } } : {}),
    };
    // R2 (vocabulary migration 2026-05, PR-10) — read the actor DID via
    // the dual-schema reader. Conflicts (both keys present) have already
    // been rejected at the envelope-receive boundary above.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const failedIdentity = failed.identity ?? failed.principal;
    const result: StepResult = {
      step_id: step.id,
      status: "failed",
      ...(failedIdentity ? { agent_identity: failedIdentity } : {}),
      started_at: startedAt,
      completed_at: completedAt,
      duration_ms: durationMs,
      error: err,
    };
    const decision = await applyFailureStrategy(octx, exec, step, definition, result, correlation_id);
    if (decision === "abort") return { kind: "abort", error: err };
    return { kind: "skip" };
  }

  const completed = winner.value.payload as DispatchTaskCompletedPayload;
  const output = completed.result;
  // R2 (vocabulary migration 2026-05, PR-10) — read the actor DID via
  // the dual-schema reader. Conflicts already rejected upstream.
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  const completedIdentity = completed.identity ?? completed.principal;

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
        ...(completedIdentity ? { agent_identity: completedIdentity } : {}),
        started_at: startedAt,
        completed_at: completedAt,
        duration_ms: durationMs,
        error: err,
      };
      const decision = await applyFailureStrategy(octx, exec, step, definition, result, correlation_id);
      if (decision === "abort") return { kind: "abort", error: err };
      return { kind: "skip" };
    }
  }

  const result: StepResult = {
    step_id: step.id,
    status: "completed",
    output,
    ...(completedIdentity ? { agent_identity: completedIdentity } : {}),
    started_at: startedAt,
    completed_at: completedAt,
    duration_ms: durationMs,
  };
  exec.completed_steps[step.id] = result;
  await store.put(checkpoint(octx, exec));
  await emitLifecycle(octx, "workflow.step.completed", correlation_id, definition.id, step);
  return { kind: "advance", output };
}

/**
 * Walk a sub-chain from `startStepId` until a terminal step.
 *
 * Behavior (T-7.2):
 * - **Linear:** advance step-by-step via `while`. Each step's
 *   outcome is "advance" (output forwarded), "skip" (input
 *   preserved), or "abort" (chain fails).
 * - **Fan-out:** at a step with multiple children, spawn each
 *   child as a parallel sub-chain via `Promise.all`. Each
 *   sub-chain's `runChain` is `.catch`-wrapped so infrastructure
 *   throws map onto BranchResult and Promise.all settles cleanly.
 * - **Fan-in:** at a step with multiple parents, the FIRST
 *   parent to arrive initializes a
 *   `FanInBarrier` on `ctx.barriers`. Subsequent parents record
 *   their contribution and exit early. The LAST parent to
 *   arrive aggregates `{ branches: [{ step_id, status, output }] }`
 *   sorted by step_id (per plan.md §Q2) and runs the fan-in step
 *   with that input. Single-thread JS semantics make the
 *   check-then-set atomic across concurrent siblings.
 *
 * Aggregation: each branch entry carries `status: "completed" |
 * "skipped"` so downstream agents can detect partial-failure
 * aggregations. A skipped parent's `output` is the input the
 * chain was carrying when the step was skipped (not a computed
 * result — the step never ran).
 *
 * Workflow-output convention: `hadFanOut` flag bubbles up
 * transitively so execute() leaves `exec.output` undefined on
 * any workflow whose chain encountered fan-out (or fan-in via a
 * fan-out parent's chain). Linear-only workflows surface their
 * terminal step's output.
 */
export async function runChain(
  startStepId: string,
  branchInput: unknown,
  ctx: ChainCtx,
  arrivedFrom?: string,
): Promise<BranchResult> {
  let currentInput = branchInput;
  let currentStepId: string | undefined = startStepId;
  let prevStepId: string | undefined = arrivedFrom;
  let lastOutcomeKind: "completed" | "skipped" = "completed";
  let hadFanOut = false;
  while (currentStepId) {
    const step = ctx.graph.steps.get(currentStepId);
    if (!step) {
      throw new Error(
        `F-16 orchestrator: runChain reached unresolved step id '${currentStepId}' — buildStepGraph drift`,
      );
    }

    // Fan-in barrier — see function-level JSDoc.
    const parents = ctx.graph.parents.get(currentStepId) ?? [];
    if (parents.length > 1) {
      // Invariant: any step with multiple parents must be reached
      // FROM a parent, so prevStepId is always defined. Fail
      // fast rather than silent-deadlocking if the invariant is
      // ever violated upstream — a defensive `if (prevStepId)`
      // here would let one parent's contribution disappear and
      // the barrier would never reach `expected`.
      if (prevStepId === undefined) {
        throw new Error(
          `F-16 orchestrator: runChain reached fan-in step '${currentStepId}' without prevStepId — invariant violation`,
        );
      }
      let barrier = ctx.barriers.get(currentStepId);
      if (!barrier) {
        barrier = { expected: parents.length, outputs: new Map() };
        ctx.barriers.set(currentStepId, barrier);
      }
      barrier.outputs.set(prevStepId, { output: currentInput, status: lastOutcomeKind });
      if (barrier.outputs.size < barrier.expected) {
        // Not the last — record contribution and exit this branch.
        // The last-arriving sibling will run the fan-in step.
        return { kind: "completed", output: currentInput, hadFanOut };
      }
      // Last arrival — aggregate and proceed.
      currentInput = aggregateFanIn(barrier);
      ctx.barriers.delete(currentStepId);
    }

    const outcome = await runStep(step, currentInput, ctx);
    if (outcome.kind === "abort") {
      return { kind: "failed", error: outcome.error, atStep: step };
    }
    if (outcome.kind === "advance") {
      currentInput = outcome.output;
      lastOutcomeKind = "completed";
    } else {
      // skip: currentInput preserved (previous step's value).
      lastOutcomeKind = "skipped";
    }

    if (!step.next || step.next.length === 0) {
      return { kind: "completed", output: currentInput, hadFanOut };
    }
    prevStepId = currentStepId;
    if (step.next.length === 1) {
      currentStepId = step.next[0];
      continue;
    }
    // Fan-out. Wrap every child's runChain in a `.catch` so an
    // infrastructure rejection (publish failure, store.put
    // rejection) from one branch can't leave sibling rejections
    // unhandled when Promise.all short-circuits. Map any caught
    // error onto the BranchResult union so Promise.all always
    // settles cleanly.
    hadFanOut = true;
    // prevStepId was set to currentStepId in the line above the
    // single-next `continue` — by the time we reach here, it
    // points to the fan-out parent step (the step whose `next`
    // we're about to enumerate).
    const fanOutParentId = currentStepId;
    const subResults = await Promise.all(
      step.next.map((childId) => {
        // Capture the actual child step for accurate
        // failure-site attribution. The fan-out parent is NOT
        // the right `atStep` for an infrastructure throw inside
        // a descendant.
        const childStep = ctx.graph.steps.get(childId) ?? step;
        return runChain(childId, currentInput, ctx, fanOutParentId).catch(
          (err: unknown): BranchResult => ({
            kind: "failed",
            error: {
              // Infrastructure-class failures (publish reject,
              // store throw, etc.) map to "agent-error" until
              // F-17 introduces a "transport-error" /
              // "store-error" StepErrorCode. The taxonomy is
              // imperfect; documented in `runChain` JSDoc.
              code: "agent-error",
              message: err instanceof Error ? err.message : String(err),
            },
            atStep: childStep,
          }),
        );
      }),
    );
    for (const r of subResults) {
      if (r.kind === "failed") return r;
      if (r.hadFanOut) hadFanOut = true;
    }
    return { kind: "completed", output: currentInput, hadFanOut };
  }
  return { kind: "completed", output: currentInput, hadFanOut };
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
export async function applyFailureStrategy(
  octx: OrchestratorContext,
  exec: WorkflowExecution,
  step: WorkflowStep,
  definition: ChainCtx["definition"],
  failedResult: StepResult,
  correlation_id: string,
): Promise<"abort" | "skip"> {
  const strategy = step.on_failure ?? definition.on_failure ?? "abort";
  if (strategy === "abort") {
    exec.completed_steps[step.id] = failedResult;
    await octx.store.put(checkpoint(octx, exec));
    await emitLifecycle(octx, "workflow.step.failed", correlation_id, definition.id, step, failedResult.error?.message);
    return "abort";
  }
  // "skip-step" / "continue"
  exec.completed_steps[step.id] = { ...failedResult, status: "skipped" };
  await octx.store.put(checkpoint(octx, exec));
  await emitLifecycle(
    octx,
    "workflow.step.skipped",
    correlation_id,
    definition.id,
    step,
    failedResult.error?.message,
  );
  return "skip";
}

/**
 * Private execution entry point. Public `execute()` calls this
 * with `resume = null`; `recover()` calls it with a populated
 * ResumeMarker. Threading the marker as a parameter rather than
 * a closure variable eliminates the race window where an
 * external `execute()` invocation during a recovery sweep could
 * inadvertently inherit the marker and produce an aliased
 * second execution under the snapshot's execution_id.
 */
export async function executeWithResume(
  octx: OrchestratorContext,
  { definition, input, correlation_id: corrInput }: ExecuteWorkflowInput,
  resume: ResumeMarker | null,
  sweep_id?: string,
): Promise<ExecuteWorkflowResult> {
  if (octx.closed) throw new Error("orchestrator is closed");
  rejectUnsupportedStrategies(definition);
  await ensureSubscribed(octx);

  const correlation_id = corrInput
    ? ensureCorrelationId({ correlation_id: corrInput }).correlation_id
    : generateCorrelationId();

  const exec = newExecution(octx, definition, correlation_id, input, resume);
  await octx.store.put(exec);

  // T-8.1: resumed executions emit `workflow.resumed` (a
  // distinct lifecycle literal) rather than re-emitting
  // `workflow.started` for an execution_id the event stream
  // already saw start in the prior process. Observers using
  // started/completed pairs to materialize state see exactly
  // one started per execution_id across its full lifetime.
  // retry_count + sweep_id flow through the lifecycle payload
  // on resumed events so downstream observers can correlate
  // back to the recovery sweep that emitted them (cycle-2 N-9).
  await emitLifecycle(
    octx,
    resume ? "workflow.resumed" : "workflow.started",
    correlation_id,
    definition.id,
    undefined,
    undefined,
    resume ? { retry_count: resume.retry_count, sweep_id } : undefined,
  );

  const failPreExec = async (err: StepError): Promise<ExecuteWorkflowResult> => {
    exec.status = "failed";
    exec.error = err;
    exec.completed_at = octx.now().toISOString();
    await octx.store.put(checkpoint(octx, exec));
    await emitLifecycle(octx, "workflow.failed", correlation_id, definition.id, undefined, err.message);
    return resultOf(exec);
  };

  const graph = buildStepGraph(definition);
  const order = topologicalSort(graph);
  if (!order) {
    return failPreExec({
      code: "validation-failed",
      message: "workflow definition has a cycle",
    });
  }

  const fanOutErr = detectExcessiveFanWidth(octx, graph);
  if (fanOutErr) return failPreExec(fanOutErr);

  let validators = octx.validatorCache.get(definition);
  if (!validators) {
    validators = new Map<string, CompiledValidator>();
    for (const step of definition.steps) {
      const stepSchema = step.output.data_schema;
      if (stepSchema) validators.set(step.id, compileSchema(stepSchema));
    }
    octx.validatorCache.set(definition, validators);
  }

  const deadline = octx.now().getTime() + octx.workflowTimeoutMs;

  // Workflows are DAGs rooted at a single entry: fan-out
  // (next.length > 1) spawns parallel sub-chains via
  // Promise.all in runChain; fan-in (parents.length > 1)
  // converges via barriers on ChainCtx. The workflow
  // completes when ALL sub-chains finish; fails if ANY
  // sub-chain fails under abort.
  const entries = findEntrySteps(graph);
  // Destructure-and-guard doubles as the empty-check (entry is undefined
  // iff entries is empty) and narrows `entry` to a defined value below.
  const entry = entries[0];
  if (entry === undefined) {
    return failPreExec({
      code: "validation-failed",
      message: "workflow definition has no entry step (every step has a parent)",
    });
  }
  if (entries.length > 1) {
    return failPreExec({
      code: "validation-failed",
      message: `workflow definition has multiple entry steps (${entries.join(", ")}); single-rooted definitions are the v1 contract`,
    });
  }
  const depthErr = detectExcessiveDepth(octx, graph, entries);
  if (depthErr) return failPreExec(depthErr);

  const ctx: ChainCtx = {
    octx,
    exec,
    definition,
    validators,
    deadline,
    correlation_id,
    graph,
    inFlight: new Set<string>(),
    barriers: new Map(),
  };

  // entries.length === 1 here (empty and >1 both returned above)
  const branchResult = await runChain(entry, input, ctx);

  if (branchResult.kind === "failed") {
    await failWorkflow(exec, branchResult.error, branchResult.atStep);
    return resultOf(exec);
  }

  exec.current_steps = [];
  exec.status = "completed";
  // For purely linear workflows the chain's terminal output is
  // the workflow output. For workflows that fan out, branches
  // diverge — sub-chain aggregation lives at fan-in steps via
  // the `{ branches: [...] }` payload, but a WORKFLOW-level
  // aggregated output is a separate concern that this PR
  // doesn't address. Leaving `exec.output` undefined avoids
  // misleading callers: the pre-fork value held by the
  // fan-out parent is NOT the workflow's terminal output, and
  // a fan-in convergence's output is consumed by whatever
  // step the workflow happens to end at, not promoted up.
  // Callers needing a workflow-level result should add a
  // terminal merge step.
  if (!branchResult.hadFanOut && branchResult.output !== undefined) {
    exec.output = branchResult.output;
  }
  exec.completed_at = octx.now().toISOString();
  await octx.store.put(checkpoint(octx, exec));
  await emitLifecycle(octx, "workflow.completed", correlation_id, definition.id);
  return resultOf(exec);

  async function failWorkflow(
    execution: WorkflowExecution,
    err: StepError,
    atStep: WorkflowStep,
  ): Promise<void> {
    execution.status = "failed";
    execution.error = err;
    execution.completed_at = octx.now().toISOString();
    execution.current_steps = [];
    await octx.store.put(checkpoint(octx, execution));
    await emitLifecycle(octx, "workflow.failed", correlation_id, definition.id, atStep, err.message);
  }
}
