/**
 * F-16: workflow lifecycle subject helpers + event constructor.
 *
 * Subjects sit under `local.{principal}.dispatch.workflow.{event}` —
 * distinct from F-020 dispatch.task.> and F-10 dispatch.bid.> namespaces
 * so wildcard subscribers don't cross-receive.
 */
import type { MyelinEnvelope, Sovereignty } from "../types";
import { createEnvelope } from "../envelope";
import { workflowLifecycleSubject } from "../subjects";
import { isSegmentValidationError } from "../segment-validators";
import type { WorkflowLifecycleEventType, WorkflowLifecyclePayload } from "./types";

export function deriveWorkflowLifecycleSubject(
  principal: string,
  event: WorkflowLifecycleEventType,
): string {
  try {
    // event is "workflow.started", "workflow.step.started", etc.
    // Subject becomes local.{principal}.dispatch.{event} since each event
    // already starts with "workflow." segment.
    return workflowLifecycleSubject(principal, event);
  } catch (err) {
    if (isSegmentValidationError(err, "principal")) {
      throw new Error(`workflow subject: invalid principal '${principal}'`, { cause: err });
    }
    throw err;
  }
}

export interface CreateWorkflowLifecycleEventOptions {
  principal: string;
  source: string;
  sovereignty: Sovereignty;
  type: WorkflowLifecycleEventType;
  input: WorkflowLifecyclePayload;
  correlation_id?: string;
}

/**
 * Construct an unsigned workflow lifecycle envelope. Per the
 * dispatch/lifecycle.ts pattern, signing is the transport's job;
 * helpers like this never call signEnvelope. The
 * payload.correlation_id should match the workflow run's
 * correlation_id; the optional `correlation_id` option threads it
 * onto the envelope itself for trace reconstruction.
 *
 * myelin#183 — `principal` is the canonical option name. The earlier
 * transition-window `org` alias is dropped in this release.
 */
export function createWorkflowLifecycleEvent(
  options: CreateWorkflowLifecycleEventOptions,
): { subject: string; envelope: MyelinEnvelope } {
  const subject = deriveWorkflowLifecycleSubject(options.principal, options.type);
  const envelope = createEnvelope({
    source: options.source,
    type: options.type,
    sovereignty: options.sovereignty,
    payload: { ...options.input },
    ...(options.correlation_id ? { correlation_id: options.correlation_id } : {}),
  });
  return { subject, envelope };
}
