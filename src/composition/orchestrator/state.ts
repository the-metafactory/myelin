import { createWorkflowLifecycleEvent } from "../lifecycle";
import type {
  StepErrorCode,
  WorkflowDefinition,
  WorkflowExecution,
  WorkflowLifecycleEventType,
} from "../types";
import type { ExecuteWorkflowResult } from "../orchestrator";
import type { OrchestratorContext, ResumeMarker } from "./context";

export function mapNakToStepErrorCode(nak?: string): StepErrorCode {
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

export function emitLifecycle(
  ctx: OrchestratorContext,
  type: WorkflowLifecycleEventType,
  correlation_id: string,
  workflow_id: string,
  step?: { id: string; capability: string },
  reason?: string,
  extra?: { retry_count?: number; sweep_id?: string },
): Promise<void> {
  const { subject, envelope } = createWorkflowLifecycleEvent({
    principal: ctx.principal,
    source: ctx.source,
    sovereignty: ctx.sovereignty,
    type,
    correlation_id,
    input: {
      workflow_id,
      correlation_id,
      ...(step ? { step_id: step.id, capability: step.capability } : {}),
      ...(reason ? { reason } : {}),
      ...(extra?.retry_count !== undefined ? { retry_count: extra.retry_count } : {}),
      ...(extra?.sweep_id ? { sweep_id: extra.sweep_id } : {}),
    },
  });
  return ctx.publisher.publish(subject, envelope);
}

export function newExecution(
  ctx: OrchestratorContext,
  definition: WorkflowDefinition,
  correlation_id: string,
  input: unknown,
  resume?: ResumeMarker | null,
): WorkflowExecution {
  const ts = ctx.now().toISOString();
  return {
    execution_id: resume?.execution_id ?? ctx.uuid(),
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

export function checkpoint(
  ctx: OrchestratorContext,
  exec: WorkflowExecution,
): WorkflowExecution {
  exec.last_checkpoint_at = ctx.now().toISOString();
  return exec;
}

export function syncCurrentSteps(
  execution: WorkflowExecution,
  inFlight: Set<string>,
): void {
  execution.current_steps = Array.from(inFlight);
}

export function resultOf(exec: WorkflowExecution): ExecuteWorkflowResult {
  return {
    execution_id: exec.execution_id,
    correlation_id: exec.correlation_id,
    status: exec.status,
    ...(exec.output !== undefined ? { output: exec.output } : {}),
    ...(exec.error ? { error: exec.error } : {}),
    results: { ...exec.completed_steps },
  };
}
