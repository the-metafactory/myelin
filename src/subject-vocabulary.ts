export const EXECUTION_RUN_FINISHED_TYPE = "execution.run.finished";
export type ExecutionRunEventType = typeof EXECUTION_RUN_FINISHED_TYPE;

export const RUN_KINDS = ["flow", "node", "algorithm", "dispatch", "job"] as const;
export type RunKind = (typeof RUN_KINDS)[number];

export const RUN_OUTCOMES = ["succeeded", "failed", "cancelled", "blocked"] as const;
export type RunOutcome = (typeof RUN_OUTCOMES)[number];

export const VIGIL_ATTENTION_RESOLVED_TYPE = "vigil.attention.resolved";
export type VigilAttentionEventType = typeof VIGIL_ATTENTION_RESOLVED_TYPE;

export const ATTENTION_RESOLUTIONS = ["approved", "dismissed", "expired", "superseded", "read", "archived"] as const;
export type AttentionResolution = (typeof ATTENTION_RESOLUTIONS)[number];

export type LifecycleState =
  | "received"
  | "assigned"
  | "started"
  | "progress"
  | "completed"
  | "failed"
  | "aborted"
  | "rejected";

export type DispatchLifecycleEventType = `dispatch.task.${LifecycleState}`;

export const DISPATCH_TASK_STATE_TO_TYPE: Record<LifecycleState, DispatchLifecycleEventType> = {
  received: "dispatch.task.received",
  assigned: "dispatch.task.assigned",
  started: "dispatch.task.started",
  progress: "dispatch.task.progress",
  completed: "dispatch.task.completed",
  failed: "dispatch.task.failed",
  aborted: "dispatch.task.aborted",
  rejected: "dispatch.task.rejected",
};

export type BidLifecycleEventType =
  | "bid-opened"
  | "bid-received"
  | "bid-closed"
  | "bid-retry"
  | "bid-assigned";

export type WorkflowLifecycleEventType =
  | "workflow.started"
  | "workflow.resumed"
  | "workflow.recovered"
  | "workflow.step.started"
  | "workflow.step.completed"
  | "workflow.step.failed"
  | "workflow.step.skipped"
  | "workflow.completed"
  | "workflow.failed";
