export type LifecycleState =
  | "received"
  | "assigned"
  | "started"
  | "progress"
  | "completed"
  | "failed"
  | "aborted"
  | "rejected";

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
