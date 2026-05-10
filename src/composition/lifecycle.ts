/**
 * F-16: workflow lifecycle subject helpers + event constructor.
 *
 * Subjects sit under `local.{org}.dispatch.workflow.{event}` — distinct
 * from F-020 dispatch.task.> and F-10 dispatch.bid.> namespaces so
 * wildcard subscribers don't cross-receive.
 */
import type { MyelinEnvelope, Sovereignty } from "../types";
import { createEnvelope } from "../envelope";
import type { WorkflowLifecycleEventType, WorkflowLifecyclePayload } from "./types";

const ORG_RE = /^[a-z][a-z0-9-]{0,62}[a-z0-9]$/;

function assertOrg(org: string): void {
  if (!ORG_RE.test(org)) {
    throw new Error(`workflow subject: invalid org '${org}'`);
  }
}

export function deriveWorkflowLifecycleSubject(
  org: string,
  event: WorkflowLifecycleEventType,
): string {
  assertOrg(org);
  // event is "workflow.started", "workflow.step.started", etc.
  // Subject becomes local.{org}.dispatch.{event} since each event
  // already starts with "workflow." segment.
  return `local.${org}.dispatch.${event}`;
}

export interface CreateWorkflowLifecycleEventOptions {
  org: string;
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
 */
export function createWorkflowLifecycleEvent(
  options: CreateWorkflowLifecycleEventOptions,
): { subject: string; envelope: MyelinEnvelope } {
  const subject = deriveWorkflowLifecycleSubject(options.org, options.type);
  const envelope = createEnvelope({
    source: options.source,
    type: options.type,
    sovereignty: options.sovereignty,
    payload: { ...options.input },
    ...(options.correlation_id ? { correlation_id: options.correlation_id } : {}),
  });
  return { subject, envelope };
}
