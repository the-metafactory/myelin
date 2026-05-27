import {
  bidAssignmentSubject,
  biddingLifecycleSubject,
  bidRequestSubject,
} from "../subjects";
import { isSegmentValidationError } from "../segment-validators";

export function deriveBidRequestSubject(principal: string, capability: string): string {
  try {
    return bidRequestSubject(principal, capability);
  } catch (err) {
    throw normalizeBiddingSubjectError(err);
  }
}

export function deriveAssignmentSubject(principal: string, did: string, capability: string): string {
  try {
    return bidAssignmentSubject(principal, did, capability);
  } catch (err) {
    throw normalizeBiddingSubjectError(err, did);
  }
}

/**
 * Bidding lifecycle events live under `local.{principal}.dispatch.bid.{event}`,
 * NOT `local.{principal}.dispatch.task.{event}`. The `dispatch.task.>` namespace
 * is owned by F-020 dispatch lifecycle (received/assigned/started/progress/
 * completed/failed/aborted) — sharing that namespace would cause subscribers
 * to `dispatch.task.>` to receive bidding events with incompatible payload
 * shapes. The `bid` segment isolates the bidding sub-protocol cleanly.
 */
export function deriveBidLifecycleSubject(
  principal: string,
  event: "bid-opened" | "bid-received" | "bid-closed" | "bid-retry" | "bid-assigned",
): string {
  try {
    return biddingLifecycleSubject(principal, event);
  } catch (err) {
    throw normalizeBiddingSubjectError(err);
  }
}

function normalizeBiddingSubjectError(err: unknown, did?: string): Error {
  const message = err instanceof Error ? err.message : String(err);
  if (message.startsWith("invalid DID:")) {
    return new Error(`bidding subject: invalid assistant DID '${did ?? message.slice("invalid DID:".length).trim()}'`);
  }
  if (isSegmentValidationError(err, "principal")) {
    return new Error(`bidding subject: invalid principal — ${message}`);
  }
  if (message.includes("capability")) {
    return new Error(`bidding subject: invalid capability — ${message}`);
  }
  return err instanceof Error ? err : new Error(message);
}
