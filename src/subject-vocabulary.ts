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
