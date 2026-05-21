import type { SignedBy } from "../identity/types";

export type SelectionStrategy = "lowest-load" | "lowest-cost" | "highest-match";

export const DEFAULT_BID_TIMEOUT_MS = 2000;
export const MAX_WINNER_RETRIES = 2;

export interface BidRequest {
  task_id: string;
  requirements: string[];
  priority: number;
  bid_timeout_ms: number;
  selection_strategy: SelectionStrategy;
  reply_to: string;
  task_summary?: string;
}

export interface BidResponse {
  task_id: string;
  bidder: string;
  load: number;
  capability_match: number;
  cost?: number;
  constraints?: string[];
  signed_by: SignedBy;
}

export interface TaskAssignment {
  task_id: string;
  winner: string;
  payload: Record<string, unknown>;
  bid_round: {
    participants: number;
    selection_reason: string;
  };
}

// `bid-assigned` (not `assigned`) so the bidding lifecycle namespace
// `local.{principal}.dispatch.bid.>` does not overlap with F-020 dispatch
// lifecycle's `local.{principal}.dispatch.task.>` (which has its own
// `assigned` state).
export type BidLifecycleEventType =
  | "bid-opened"
  | "bid-received"
  | "bid-closed"
  | "bid-retry"
  | "bid-assigned";

export interface BidLifecycleEventInput {
  task_id: string;
  participants?: number;
  winner?: string;
  bidder?: string;
  selection_reason?: string;
  retry_attempt?: number;
}
