import type { MyelinEnvelope, Sovereignty } from "../../types";
import type {
  TransportPublisher,
  TransportSubscriber,
  Subscription,
} from "../../transport/types";
import type { CompiledValidator } from "../schema";
import type { StepGraph } from "../graph";
import type {
  StepError,
  StepResult,
  WorkflowDefinition,
  WorkflowExecution,
  WorkflowStep,
} from "../types";
import type { WorkflowExecutionStore } from "../execution-store";
import type {
  DispatchTaskCompletedPayload,
  DispatchTaskFailedPayload,
} from "../orchestrator";

/**
 * Internal to the `orchestrator/` directory. NOT part of the package
 * surface — the public API remains `createOrchestrator` +
 * `WorkflowOrchestrator` and friends re-exported from
 * `../orchestrator.ts`.
 *
 * F-16 E4 (2026-07 remediation): `createOrchestrator` was a single
 * ~1600-line closure capturing shared state across 15 inner functions.
 * The split hoists that captured state onto this context object so the
 * inner functions become plain module-level functions taking `ctx`.
 * The three formerly-mutable closure locals (`closed`, `lifecycleSub`,
 * `subscribingPromise`) plus `recoveredOnce` live here as MUTABLE
 * properties; every read/write moved to `ctx.<field>` verbatim so the
 * split is behavior-preserving.
 */
export interface OrchestratorContext {
  publisher: TransportPublisher;
  subscriber: TransportSubscriber;
  store: WorkflowExecutionStore;
  principal: string;
  source: string;
  sovereignty: Sovereignty;
  now: () => Date;
  uuid: () => string;
  workflowTimeoutMs: number;
  onMalformedResponse: (info: MalformedResponseInfo) => void;
  /** Validated at construction; positive integer. */
  maxFanOutWidth: number;
  /** Validated at construction; positive integer. */
  maxFanOutDepth: number;
  definitionLoader?: (
    workflow_id: string,
    workflow_version: string,
  ) => WorkflowDefinition | undefined | Promise<WorkflowDefinition | undefined>;
  /** Shared across concurrent executions; keyed by task_id. */
  pending: Map<string, Pending>;
  /** Memoized compiled validators per WorkflowDefinition. */
  validatorCache: WeakMap<WorkflowDefinition, Map<string, CompiledValidator>>;
  // ── mutable state (formerly closure locals) ──
  lifecycleSub: Subscription | null;
  subscribingPromise: Promise<Subscription> | null;
  closed: boolean;
  recoveredOnce: boolean;
}

export interface MalformedResponseInfo {
  reason:
    | "missing-task-id"
    | "non-object-payload"
    | "unknown-task-id"
    | "correlation-mismatch"
    | "unknown-type"
    | "payload-identity-conflict";
  envelope: MyelinEnvelope;
  expected_correlation_id?: string;
}

export interface Pending {
  resolve: (payload: {
    kind: "completed" | "failed";
    payload: DispatchTaskCompletedPayload | DispatchTaskFailedPayload;
  }) => void;
  reject: (err: Error) => void;
  /**
   * The correlation_id the orchestrator stamped on the outgoing
   * dispatch. Responses with a mismatched correlation_id are
   * silent-dropped (logged via onMalformedResponse) rather than
   * resolving this waiter — defends against an attacker (or buggy
   * agent) who knows a task_id but not the workflow's correlation.
   */
  correlation_id: string;
}

/**
 * T-8.1 recovery marker. Threaded through the orchestrator's
 * private `executeWithResume` entry point by `recover()` (never
 * by external callers via the public `execute()`). Keys on
 * `execution_id` so a snapshot rehydrates with its original
 * identity rather than minting fresh. Carries `started_at`
 * (audit trail) and `pending_fan_in` (forward-compat for the
 * future barrier-persistence work) so the resumed execution
 * record is anchored to the original run, not the recovery
 * moment.
 *
 * Lifted to module scope (cycle-2 nit) so its role as a
 * first-class recovery contract is visible from the call sites
 * that use it, rather than being a local declaration tucked
 * inside the orchestrator closure.
 */
export interface ResumeMarker {
  execution_id: string;
  retry_count: number;
  started_at: string;
  completed_steps: Record<string, StepResult>;
  pending_fan_in: Record<string, string[]>;
}

// T-7.2: fan-in barrier. Each fan-in step (parents.length > 1)
// gets one barrier on first arrival. Subsequent parents record
// their output and exit early. The LAST parent to arrive runs
// the fan-in step with the aggregated input per plan.md §Q2.
export type FanInBranchStatus = "completed" | "skipped";
export interface FanInBranchEntry {
  output: unknown;
  status: FanInBranchStatus;
}
export interface FanInBarrier {
  expected: number;
  /** parent_step_id → { output, status } */
  outputs: Map<string, FanInBranchEntry>;
}

export interface ChainCtx {
  /** The orchestrator-level shared context. */
  octx: OrchestratorContext;
  exec: WorkflowExecution;
  definition: WorkflowDefinition;
  validators: Map<string, CompiledValidator>;
  deadline: number;
  correlation_id: string;
  graph: StepGraph;
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
}

export type BranchResult =
  | { kind: "completed"; output: unknown; hadFanOut: boolean }
  | { kind: "failed"; error: StepError; atStep: WorkflowStep };

export type StepOutcome =
  | { kind: "advance"; output: unknown }
  | { kind: "skip" }
  | { kind: "abort"; error: StepError };

export const DEFAULT_WORKFLOW_TIMEOUT_MS = 30 * 60 * 1000;
