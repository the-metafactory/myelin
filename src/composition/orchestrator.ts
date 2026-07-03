import type { MyelinEnvelope, Sovereignty } from "../types";
import type {
  TransportPublisher,
  TransportSubscriber,
} from "../transport/types";
import type {
  ExecutionStatus,
  StepError,
  StepResult,
  WorkflowDefinition,
} from "./types";
import type { WorkflowExecutionStore } from "./execution-store";
import type { OrchestratorContext } from "./orchestrator/context";
import { DEFAULT_WORKFLOW_TIMEOUT_MS } from "./orchestrator/context";
import { executeWithResume } from "./orchestrator/execute";
import { recover as runRecovery } from "./orchestrator/recovery";

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
 *   `local.{principal}.tasks.{capability}`. The envelope shares the
 *   workflow's `correlation_id`; payload carries `{ workflow_context,
 *   input }`. F-019 routing handles the rest (capability consumers
 *   pick up the task and the dispatching agent ack-completes via
 *   `dispatch.task.completed`).
 * - Response collection: subscribe once at orchestrator creation
 *   to `local.{principal}.dispatch.task.completed` and `.failed`. Route
 *   incoming events by `payload.task_id` to the awaiting executor.
 *   Multiple concurrent workflow executions share the single
 *   subscriber; per-task routing keeps them independent.
 * - Workflow lifecycle: emit `workflow.started`,
 *   `workflow.step.started`, `workflow.step.completed`,
 *   `workflow.step.failed`, `workflow.completed`, `workflow.failed`
 *   via the existing `createWorkflowLifecycleEvent` helper. Subjects
 *   live under `local.{principal}.dispatch.workflow.{state}`.
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
 * ## Provenance caveat — `agent_identity` is self-reported
 *
 * `StepResult.agent_identity` records the value the responding
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
 *
 * ## Implementation layout (F-16 E4 split, 2026-07)
 *
 * Composition root — public API + wiring. Internals live under
 * `./orchestrator/`: `context.ts` (shared `OrchestratorContext`),
 * `state.ts`, `execute.ts` (`executeWithResume`), `recovery.ts`.
 */

/**
 * R2 (vocabulary migration 2026-05, PR-10) — the actor-DID payload key
 * renamed `principal` → `identity` (mirroring the canonical dispatch
 * lifecycle payloads in `src/dispatch/types.ts`). The transition keeps
 * BOTH key declarations so a pre-migration `dispatch.task.completed` /
 * `.failed` payload still type-checks at the read site; the orchestrator
 * resolves the active DID via {@link readPayloadIdentity}, which rejects
 * a payload carrying both keys (`dual_field_conflict`).
 */
export interface DispatchTaskCompletedPayload {
  task_id: string;
  correlation_id?: string;
  result?: unknown;
  identity?: string;
  /** @deprecated Renamed to `identity` (vocabulary migration 2026-05, R2). */
  principal?: string;
}

export interface DispatchTaskFailedPayload {
  task_id: string;
  correlation_id?: string;
  nak_reason?: string;
  error?: string;
  identity?: string;
  /** @deprecated Renamed to `identity` (vocabulary migration 2026-05, R2). */
  principal?: string;
}

export interface OrchestratorOptions {
  publisher: TransportPublisher;
  subscriber: TransportSubscriber;
  store: WorkflowExecutionStore;
  /** Principal slug. Subjects derive from this. */
  principal: string;
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
      | "unknown-type"
      | "payload-identity-conflict";
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
   *
   * ## Observability
   *
   * Each recovery sweep generates a fresh `sweep_id` (UUID) that
   * is logged at INFO on entry and exit
   * (`[F-16] recovery sweep starting|complete: sweep_id=...`),
   * and carried on every `workflow.recovered` and per-snapshot
   * `workflow.resumed` / `workflow.failed` lifecycle event for
   * downstream observability tooling.
   *
   * ## Concurrent execute() during recovery
   *
   * `execute()` and `recover()` use disjoint internal paths
   * (the recovery marker is plumbed as a private parameter, not
   * shared closure state). A caller can safely invoke
   * `execute()` while a recovery sweep is in flight; each call
   * proceeds with its own correlation_id and never inherits the
   * sweep's marker.
   */
  recover(): Promise<ExecuteWorkflowResult[]>;
  close(): Promise<void>;
}

export function createOrchestrator(options: OrchestratorOptions): WorkflowOrchestrator {
  const { publisher, subscriber, store, principal, source, sovereignty } = options;
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
  const maxFanOutWidth = rawWidth;
  const rawDepth = options.maxFanOutDepth ?? 32;
  if (!Number.isInteger(rawDepth) || rawDepth < 1) {
    throw new Error(
      `F-16 orchestrator: maxFanOutDepth must be a positive integer; got ${String(rawDepth)}`,
    );
  }
  const maxFanOutDepth = rawDepth;

  const ctx: OrchestratorContext = {
    publisher,
    subscriber,
    store,
    principal,
    source,
    sovereignty,
    now,
    uuid,
    workflowTimeoutMs,
    onMalformedResponse,
    maxFanOutWidth,
    maxFanOutDepth,
    definitionLoader: options.definitionLoader,
    // Memoize compiled validators per WorkflowDefinition. Ajv
    // compilation is expensive (generates JavaScript from the schema)
    // and definitions are immutable per (id, version). WeakMap keying
    // on the definition object lets the GC reclaim the cache when the
    // definition is dropped.
    pending: new Map(),
    validatorCache: new WeakMap(),
    lifecycleSub: null,
    // In-flight subscribe Promise. The `if (lifecycleSub) return`
    // guard alone has a TOCTOU window — two concurrent execute()
    // calls both arriving before the first subscribe() resolves
    // would both call `subscriber.subscribe()` and end up with two
    // active subscriptions on the same wildcard subject. Sharing the
    // in-flight Promise collapses concurrent attempts into one.
    subscribingPromise: null,
    closed: false,
    // T-8.1: `recoveredOnce` is the mechanical single-call gate
    // on recover(). It flips inside recover() AFTER ensureSubscribed
    // succeeds (so subscribe-time failures are retryable). The
    // recovery marker is plumbed through `executeWithResume` as a
    // private parameter rather than shared closure state so there is
    // no concurrent-execute race window even during a long sweep.
    recoveredOnce: false,
  };

  const theOrchestrator: WorkflowOrchestrator = {
    execute(input) {
      return executeWithResume(ctx, input, null);
    },

    recover() {
      return runRecovery(ctx);
    },

    async close() {
      if (ctx.closed) return;
      ctx.closed = true;
      if (ctx.lifecycleSub) {
        await ctx.lifecycleSub.unsubscribe();
        ctx.lifecycleSub = null;
      }
      for (const waiter of ctx.pending.values()) {
        waiter.reject(new Error("orchestrator closed"));
      }
      ctx.pending.clear();
    },
  };

  return theOrchestrator;
}
