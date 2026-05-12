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
import { buildStepGraph, findEntrySteps, topologicalSort } from "./graph";
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
  /**
   * Maximum fan-out width per step. A workflow that fans out to
   * more children than this fails fast at execute time with a
   * `validation-failed` error. Default 16. Production deployments
   * can tighten via this option; pathological definitions (a step
   * with `next: [c1..c1000]`) cannot exhaust transport / agent
   * capacity in a single tick. Validated at construction.
   */
  maxFanOutWidth?: number;
  /**
   * Maximum workflow path depth — the longest root-to-leaf path
   * through ANY step (linear or fan-out). Default 32. Caps the
   * worst-case number of live `runChain` closure frames during
   * execution; protects against pathological deep trees blowing
   * memory. Validated at construction.
   *
   * Note: linear chains contribute to this depth budget too. A
   * 50-step linear workflow consumes 50 of the budget. The name
   * `maxFanOutDepth` is historical; the cap is the workflow's
   * total path length regardless of whether each step fans out.
   */
  maxFanOutDepth?: number;
  /**
   * T-8.1 recovery: callback to resolve a `WorkflowDefinition`
   * from `(workflow_id, workflow_version)`. The orchestrator's
   * `WorkflowExecution` records only the IDs; on `recover()`,
   * the loader is called to materialize each running execution's
   * definition before resumption. When the loader returns
   * `null`/`undefined` (definition unknown), the corresponding
   * execution is aborted with `validation-failed`.
   *
   * If unset, `recover()` rejects with a clear error. Provide on
   * boot via the same channel through which the rest of the
   * workflow registry lives (compile-time imports, a definitions
   * directory, etc).
   */
  definitionLoader?: (
    workflow_id: string,
    workflow_version: string,
  ) => WorkflowDefinition | undefined | Promise<WorkflowDefinition | undefined>;
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
  /**
   * T-8.1: reload running workflow executions from the store and
   * resume them. Call **once** at orchestrator boot. Each
   * rehydrated execution increments `retry_count`, refreshes
   * `last_checkpoint_at`, and resumes from the saved state. Steps
   * already in `completed_steps` short-circuit on their recorded
   * outputs (the agent must be idempotent if a step might also be
   * mid-dispatch on another orchestrator instance).
   *
   * ## Single-active-instance constraint (REQUIRED)
   *
   * recover() assumes **exactly one orchestrator process is
   * touching the WorkflowExecutionStore at any given time**. There
   * is currently no lease, lock, or fencing token in front of the
   * store: two orchestrators recovering the same running execution
   * in parallel will both re-dispatch its in-flight steps, the
   * agents will both reply, and the store record will be clobbered
   * by whichever finishes last.
   *
   * Operators are responsible for enforcing single-instance
   * deployment of the orchestrator (e.g. K8s `replicas: 1` with a
   * leader-election shim, or systemd unit with restart-on-failure).
   * F-16 may add explicit store-side leasing in a follow-up; until
   * then, treat multi-instance orchestrator deployments as
   * unsupported.
   *
   * ## Single-call gate (mechanical)
   *
   * recover() rejects on the second invocation against the same
   * orchestrator instance, even if the first call succeeded and
   * returned. This is a process-local guard against the much
   * subtler bug of one process recovering twice (which races its
   * own first-call's in-flight resumed executions). Build a fresh
   * orchestrator if you need to attempt another recovery sweep.
   *
   * The `definitionLoader` orchestrator option is required for
   * this method to function; without it, recover() rejects with
   * `validation-failed`. Returns the list of resumption results
   * in the same shape as `execute`. Per-snapshot failures
   * (missing definition, loader throw, unexpected error inside
   * the resumed execute()) are surfaced as failed
   * ExecuteWorkflowResult entries rather than aborting the sweep.
   */
  recover(): Promise<ExecuteWorkflowResult[]>;
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
    resume?: ResumeMarker | null,
  ): WorkflowExecution {
    const ts = now().toISOString();
    return {
      execution_id: resume?.execution_id ?? uuid(),
      workflow_id: definition.id,
      workflow_version: definition.version,
      correlation_id,
      status: "running",
      current_steps: [],
      completed_steps: resume?.completed_steps ?? {},
      // pending_fan_in is pulled through ResumeMarker as
      // forward-compat for the persisted-barrier follow-up.
      // Today the in-memory barriers are lost on crash; once
      // they're persisted, the snapshot's pending_fan_in carries
      // through resumption rather than being silently reset.
      pending_fan_in: resume?.pending_fan_in ?? {},
      input,
      // Preserve the original execution's wall-clock start on
      // recovery so audit trails and duration accounting remain
      // anchored to the run's true beginning, not the moment
      // recovery happened to fire.
      started_at: resume?.started_at ?? ts,
      last_checkpoint_at: ts,
      retry_count: resume?.retry_count ?? 0,
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

  // T-7.2: fan-in barrier. Each fan-in step (parents.length > 1)
  // gets one barrier on first arrival. Subsequent parents record
  // their output and exit early. The LAST parent to arrive runs
  // the fan-in step with the aggregated input per plan.md §Q2.
  type FanInBranchStatus = "completed" | "skipped";
  type FanInBranchEntry = { output: unknown; status: FanInBranchStatus };
  type FanInBarrier = {
    expected: number;
    /** parent_step_id → { output, status } */
    outputs: Map<string, FanInBranchEntry>;
  };

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
  function aggregateFanIn(
    barrier: FanInBarrier,
  ): { branches: Array<{ step_id: string; status: FanInBranchStatus; output: unknown }> } {
    const stepIds = Array.from(barrier.outputs.keys()).sort();
    return {
      branches: stepIds.map((step_id) => {
        const entry = barrier.outputs.get(step_id)!;
        return { step_id, status: entry.status, output: entry.output };
      }),
    };
  }

  /**
   * Cap on per-step fan-out width. JSON Schema doesn't bound
   * `step.next.length`; without a defense a pathological workflow
   * could fire `Promise.all` over hundreds of parallel agent
   * dispatches in one tick. Validated at construction —
   * `NaN`/`Infinity`/`0`/negative are rejected fail-fast rather
   * than silently disabling the cap (or rejecting every fan-out).
   */
  const rawWidth = options.maxFanOutWidth ?? 16;
  if (!Number.isInteger(rawWidth) || rawWidth < 1) {
    throw new Error(
      `F-16 orchestrator: maxFanOutWidth must be a positive integer; got ${String(rawWidth)}`,
    );
  }
  const MAX_FANOUT_WIDTH = rawWidth;
  const rawDepth = options.maxFanOutDepth ?? 32;
  if (!Number.isInteger(rawDepth) || rawDepth < 1) {
    throw new Error(
      `F-16 orchestrator: maxFanOutDepth must be a positive integer; got ${String(rawDepth)}`,
    );
  }
  const MAX_FANOUT_DEPTH = rawDepth;
  function detectExcessiveFanWidth(
    graph: ReturnType<typeof buildStepGraph>,
  ): StepError | null {
    for (const [stepId, children] of graph.children) {
      if (children.length > MAX_FANOUT_WIDTH) {
        return {
          code: "validation-failed",
          message: `F-16 orchestrator: step '${stepId}' fans out to ${children.length} children, exceeds MAX_FANOUT_WIDTH=${MAX_FANOUT_WIDTH}`,
        };
      }
    }
    // Symmetric fan-in cap: a step with N parents pulls N entries
    // into the barrier's outputs Map + aggregated payload. The
    // fan-out cap is the implicit natural ceiling in practice, but
    // a step with many parents could still be assembled from
    // deeper graphs. Cap matches MAX_FANOUT_WIDTH by convention.
    for (const [stepId, parents] of graph.parents) {
      if (parents.length > MAX_FANOUT_WIDTH) {
        return {
          code: "validation-failed",
          message: `F-16 orchestrator: step '${stepId}' has ${parents.length} parents (fan-in), exceeds MAX_FANOUT_WIDTH=${MAX_FANOUT_WIDTH}`,
        };
      }
    }
    return null;
  }

  /**
   * Compute the max depth via DFS from each entry. Iterative
   * (explicit stack) so deep trees don't blow the call stack
   * during validation. Returns a `StepError` when the depth
   * exceeds `MAX_FANOUT_DEPTH` so deep pathological trees never
   * reach runtime — the recursive runChain would consume O(depth)
   * live closures otherwise.
   *
   * Termination: relies on the acyclic invariant established by
   * `topologicalSort` running before this validator. Workflows
   * are DAGs (fan-in is supported), so a node reachable by
   * multiple paths can be re-pushed at different depths. The
   * `seenDepth` map records the deepest depth observed for each
   * node and skips re-pushes that don't strictly increase it —
   * soundness for DAGs (the deeper path is what matters for the
   * cap), bounded cost O(V·D), and no dependency on push/pop
   * order. A first-visit-wins `Set<string>` would silently
   * under-count on diamond shapes (different push orders observe
   * different first-visit depths).
   *
   * Diamond observability: the deepest-path-wins behaviour is
   * exercised through any diamond shape (A → [B,C] → D where the
   * longer path through one branch determines D's depth). The
   * existing fan-in DAG tests cover this; a dedicated regression
   * test could land if a future refactor regresses the Map<id,
   * maxDepth> approach.
   */
  function detectExcessiveDepth(
    graph: ReturnType<typeof buildStepGraph>,
    entries: string[],
  ): StepError | null {
    const seenDepth = new Map<string, number>();
    for (const entry of entries) {
      const stack: Array<{ id: string; depth: number }> = [{ id: entry, depth: 1 }];
      while (stack.length > 0) {
        const { id, depth } = stack.pop()!;
        const prev = seenDepth.get(id);
        if (prev !== undefined && prev >= depth) continue;
        seenDepth.set(id, depth);
        if (depth > MAX_FANOUT_DEPTH) {
          return {
            code: "validation-failed",
            message: `F-16 orchestrator: workflow depth ${depth} exceeds MAX_FANOUT_DEPTH=${MAX_FANOUT_DEPTH} (at step '${id}')`,
          };
        }
        for (const child of graph.children.get(id) ?? []) {
          stack.push({ id: child, depth: depth + 1 });
        }
      }
    }
    return null;
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

  type ChainCtx = {
    exec: WorkflowExecution;
    definition: WorkflowDefinition;
    validators: Map<string, CompiledValidator>;
    deadline: number;
    correlation_id: string;
    graph: ReturnType<typeof buildStepGraph>;
    /**
     * Per-execution Set tracking in-flight step IDs. Lives on
     * ChainCtx (not the orchestrator closure) so concurrent
     * `execute()` calls don't cross-contaminate each other's
     * `current_steps` snapshots. Set mutation is await-interleaving
     * safe within a single execution.
     */
    inFlight: Set<string>;
    /**
     * Per-execution fan-in barriers, keyed by the fan-in step ID.
     * Lazily created on first parent arrival. Cleared when the
     * fan-in step itself executes (last arrival).
     *
     * NOT PERSISTED. A process crash mid-fan-in loses partial
     * barrier state; T-8.1 recovery cannot resume a fan-in in
     * flight. The recovery path treats any execution with an
     * outstanding fan-in barrier as needing a full re-run from
     * the workflow root. `pending_fan_in` persistence on
     * `WorkflowExecution` is a documented follow-up.
     */
    barriers: Map<string, FanInBarrier>;
  };

  type BranchResult =
    | { kind: "completed"; output: unknown; hadFanOut: boolean }
    | { kind: "failed"; error: StepError; atStep: WorkflowStep };

  function syncCurrentSteps(execution: WorkflowExecution, inFlight: Set<string>): void {
    execution.current_steps = Array.from(inFlight);
  }

  type StepOutcome =
    | { kind: "advance"; output: unknown }
    | { kind: "skip" }
    | { kind: "abort"; error: StepError };

  /**
   * Run a single step: emit started lifecycle, dispatch, await
   * response or timeout, validate output schema, apply failure
   * strategy. Returns one of three outcomes — advance with the
   * step's output, skip (under skip-step / continue), or abort.
   *
   * Does NOT call `failWorkflow` directly; that's the chain
   * walker's job once the cascade resolves.
   */
  async function runStep(step: WorkflowStep, stepInput: unknown, ctx: ChainCtx): Promise<StepOutcome> {
    const { exec, definition, validators, deadline, correlation_id } = ctx;

    // T-8.1 recovery short-circuit. If this step is already in
    // `exec.completed_steps` from a prior run (recovery seeded
    // them via the ResumeMarker on newExecution), reuse the
    // recorded result rather than re-dispatching. "completed"
    // returns `advance` with the persisted output; "skipped"
    // returns `skip`. This makes re-execution after a crash
    // O(in-flight-step-count) rather than O(workflow-size) and
    // avoids paying the agent dispatch cost for work already
    // done.
    const priorResult = exec.completed_steps[step.id];
    if (priorResult) {
      switch (priorResult.status) {
        case "completed":
          return { kind: "advance", output: priorResult.output };
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
    await emitLifecycle("workflow.step.started", correlation_id, definition.id, step);
    ctx.inFlight.add(step.id);
    syncCurrentSteps(exec, ctx.inFlight);
    await store.put(checkpoint(exec));

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

    const { task_id, waiter } = await dispatchTask(step, correlation_id, exec.execution_id, stepInput);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const winner = await Promise.race([
      waiter.then((v) => ({ kind: "result" as const, value: v })),
      new Promise<{ kind: "deadline" }>((resolve) => {
        timer = setTimeout(() => resolve({ kind: "deadline" }), stepBudget);
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
        await store.put(checkpoint(exec));
        await emitLifecycle("workflow.step.failed", correlation_id, definition.id, step, err.message);
        return { kind: "abort", error: err };
      }
      const decision = await applyFailureStrategy(exec, step, definition, stepResult, correlation_id);
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
      const result: StepResult = {
        step_id: step.id,
        status: "failed",
        ...(failed.principal ? { agent_principal: failed.principal } : {}),
        started_at: startedAt,
        completed_at: completedAt,
        duration_ms: durationMs,
        error: err,
      };
      const decision = await applyFailureStrategy(exec, step, definition, result, correlation_id);
      if (decision === "abort") return { kind: "abort", error: err };
      return { kind: "skip" };
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
        const decision = await applyFailureStrategy(exec, step, definition, result, correlation_id);
        if (decision === "abort") return { kind: "abort", error: err };
        return { kind: "skip" };
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
  async function runChain(
    startStepId: string,
    branchInput: unknown,
    ctx: ChainCtx,
    arrivedFrom?: string,
  ): Promise<BranchResult> {
    let currentInput = branchInput;
    let currentStepId: string | undefined = startStepId;
    let prevStepId: string | undefined = arrivedFrom;
    let lastOutcomeKind: FanInBranchStatus = "completed";
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
        currentStepId = step.next[0]!;
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

  // T-8.1 recovery marker. Keyed by `execution_id` (NOT
  // correlation_id — correlation_id is shared by a logical
  // request thread and is not unique per execution; using it as
  // key would let an external execute() call carrying the same
  // correlation_id pick up a recovery marker by coincidence and
  // produce an aliased second execution). The marker also
  // preserves the snapshot's original `started_at` (audit trail)
  // and `pending_fan_in` (forward-compat for the future barrier
  // persistence work).
  type ResumeMarker = {
    execution_id: string;
    retry_count: number;
    started_at: string;
    completed_steps: Record<string, StepResult>;
    pending_fan_in: Record<string, string[]>;
  };
  // Recover()-only entry; execute() callers don't touch this.
  let activeResume: ResumeMarker | null = null;
  let recoveredOnce = false;

  const theOrchestrator: WorkflowOrchestrator = {
    async execute({ definition, input, correlation_id: corrInput }) {
      if (closed) throw new Error("orchestrator is closed");
      rejectUnsupportedStrategies(definition);
      await ensureSubscribed();

      const correlation_id = corrInput
        ? ensureCorrelationId({ correlation_id: corrInput }).correlation_id!
        : generateCorrelationId();
      // T-8.1: `activeResume` is set by recover() inside a
      // try/finally before invoking execute() through the
      // private resume path. External execute() callers always
      // see it as `null` because recover() owns the marker and
      // clears it before returning.
      const resume = activeResume;

      const exec = newExecution(definition, correlation_id, input, resume);
      await store.put(exec);

      // T-8.1: resumed executions emit `workflow.resumed` (a
      // distinct lifecycle literal) rather than re-emitting
      // `workflow.started` for an execution_id the event stream
      // already saw start in the prior process. Observers using
      // started/completed pairs to materialize state see exactly
      // one started per execution_id across its full lifetime.
      await emitLifecycle(
        resume ? "workflow.resumed" : "workflow.started",
        correlation_id,
        definition.id,
      );

      const failPreExec = async (err: StepError): Promise<ExecuteWorkflowResult> => {
        exec.status = "failed";
        exec.error = err;
        exec.completed_at = now().toISOString();
        await store.put(checkpoint(exec));
        await emitLifecycle("workflow.failed", correlation_id, definition.id, undefined, err.message);
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

      const fanOutErr = detectExcessiveFanWidth(graph);
      if (fanOutErr) return failPreExec(fanOutErr);

      let validators = validatorCache.get(definition);
      if (!validators) {
        validators = new Map<string, CompiledValidator>();
        for (const step of definition.steps) {
          const stepSchema = step.output.data_schema;
          if (stepSchema) validators.set(step.id, compileSchema(stepSchema as JSONSchema));
        }
        validatorCache.set(definition, validators);
      }

      const deadline = now().getTime() + workflowTimeoutMs;

      // Workflows are DAGs rooted at a single entry: fan-out
      // (next.length > 1) spawns parallel sub-chains via
      // Promise.all in runChain; fan-in (parents.length > 1)
      // converges via barriers on ChainCtx. The workflow
      // completes when ALL sub-chains finish; fails if ANY
      // sub-chain fails under abort.
      const entries = findEntrySteps(graph);
      if (entries.length === 0) {
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
      const depthErr = detectExcessiveDepth(graph, entries);
      if (depthErr) return failPreExec(depthErr);

      const ctx: ChainCtx = {
        exec,
        definition,
        validators,
        deadline,
        correlation_id,
        graph,
        inFlight: new Set<string>(),
        barriers: new Map(),
      };

      const branchResult = await runChain(entries[0]!, input, ctx);

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

    async recover() {
      if (closed) throw new Error("orchestrator is closed");
      // Pre-checks first so a caller who forgets `definitionLoader`
      // doesn't burn their one recover() attempt on a config bug.
      if (!options.definitionLoader) {
        const err = new Error(
          "F-16 orchestrator: recover() requires options.definitionLoader to resolve WorkflowDefinitions by (id, version)",
        ) as Error & { code: string };
        err.code = "validation-failed";
        throw err;
      }
      // Single-call gate. recover() is the post-restart bootstrap
      // hook, not a runtime tool: a second invocation against the
      // same orchestrator would race the first's in-flight resumed
      // executions for the same execution_ids. The single-active-
      // instance constraint (one orchestrator per process at a
      // time) is already documented on WorkflowOrchestrator.recover;
      // this gate enforces it mechanically. Build a fresh
      // orchestrator if you need to recover again.
      if (recoveredOnce) {
        const err = new Error(
          "F-16 orchestrator: recover() has already been called on this orchestrator instance; create a new orchestrator to attempt another recovery sweep",
        ) as Error & { code: string };
        err.code = "validation-failed";
        throw err;
      }
      recoveredOnce = true;
      await ensureSubscribed();
      const running = await store.listRunning();
      if (running.length === 0) return [];

      const loader = options.definitionLoader;
      // Sequential rather than Promise.all/allSettled: the
      // closure-level `activeResume` marker is the channel by which
      // execute() learns it is resuming. Running rehydrations
      // sequentially keeps that channel race-free without
      // threading the marker through execute()'s public type.
      // Per-snapshot try/catch ensures one bad definition or
      // loader fault never stalls the rest of the sweep — the
      // failing run is recorded as a synthetic failed result.
      const results: ExecuteWorkflowResult[] = [];
      for (const snapshot of running) {
        try {
          let definition: WorkflowDefinition | undefined;
          try {
            definition = await loader(snapshot.workflow_id, snapshot.workflow_version);
          } catch (loaderErr) {
            definition = undefined;
            // Loader fault is treated as a missing definition for
            // the orphan path below; the loader error surfaces in
            // the synthetic failure record's `error.message`.
            const err: StepError = {
              code: "validation-failed",
              message: `F-16 recovery: definitionLoader threw for workflow_id='${snapshot.workflow_id}' version='${snapshot.workflow_version}': ${
                loaderErr instanceof Error ? loaderErr.message : String(loaderErr)
              }`,
            };
            await emitLifecycle(
              "workflow.recovered",
              snapshot.correlation_id,
              snapshot.workflow_id,
            );
            snapshot.status = "failed";
            snapshot.error = err;
            snapshot.completed_at = now().toISOString();
            snapshot.retry_count += 1;
            await store.put(checkpoint(snapshot));
            await emitLifecycle(
              "workflow.failed",
              snapshot.correlation_id,
              snapshot.workflow_id,
              undefined,
              err.message,
            );
            results.push(resultOf(snapshot));
            continue;
          }
          if (!definition) {
            const err: StepError = {
              code: "validation-failed",
              message: `F-16 recovery: no definition for workflow_id='${snapshot.workflow_id}' version='${snapshot.workflow_version}'`,
            };
            // workflow.recovered fires BEFORE workflow.failed in
            // the orphan path so observers see the recovery
            // attempt as a distinct event from a plain failure —
            // they can correlate the failure with restart context
            // rather than guessing.
            await emitLifecycle(
              "workflow.recovered",
              snapshot.correlation_id,
              snapshot.workflow_id,
            );
            snapshot.status = "failed";
            snapshot.error = err;
            snapshot.completed_at = now().toISOString();
            snapshot.retry_count += 1;
            await store.put(checkpoint(snapshot));
            await emitLifecycle(
              "workflow.failed",
              snapshot.correlation_id,
              snapshot.workflow_id,
              undefined,
              err.message,
            );
            results.push(resultOf(snapshot));
            continue;
          }
          // Seed the resume marker keyed on execution_id (via
          // closure) so execute() picks it up at the synchronous
          // prefix of its body. structuredClone the
          // completed_steps map so any mutation execute() makes
          // (extending completed_steps with newly run steps) is
          // isolated from the persisted snapshot record the
          // store handed us. retry_count is incremented here so
          // every recovery sweep visibly bumps it in the new
          // execution record.
          activeResume = {
            execution_id: snapshot.execution_id,
            retry_count: snapshot.retry_count + 1,
            started_at: snapshot.started_at,
            completed_steps: structuredClone(snapshot.completed_steps),
            pending_fan_in: structuredClone(snapshot.pending_fan_in),
          };
          try {
            results.push(
              await theOrchestrator.execute({
                definition,
                input: snapshot.input,
                correlation_id: snapshot.correlation_id,
              }),
            );
          } finally {
            activeResume = null;
          }
        } catch (perSnapshotErr) {
          // Any unexpected failure inside the resumed execute()
          // call surfaces as a synthetic failure rather than
          // aborting the whole recovery sweep. The snapshot is
          // left in `running` for a future operator-initiated
          // resweep (after fixing whatever caused the throw).
          results.push({
            execution_id: snapshot.execution_id,
            correlation_id: snapshot.correlation_id,
            status: "failed",
            error: {
              code: "validation-failed",
              message: `F-16 recovery: unexpected error resuming execution_id='${snapshot.execution_id}': ${
                perSnapshotErr instanceof Error ? perSnapshotErr.message : String(perSnapshotErr)
              }`,
            },
            results: { ...snapshot.completed_steps },
          });
        }
      }
      return results;
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

  return theOrchestrator;
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
