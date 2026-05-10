import type { BidRequest, SelectionStrategy } from "./types";
import { DEFAULT_BID_TIMEOUT_MS } from "./types";

export interface CreateBidRequestInput {
  task_id?: string;
  requirements: string[];
  priority?: number;
  bid_timeout_ms?: number;
  selection_strategy?: SelectionStrategy;
  reply_to: string;
  task_summary?: string;
}

export function createBidRequest(input: CreateBidRequestInput): BidRequest {
  if (!Array.isArray(input.requirements) || input.requirements.length === 0) {
    throw new Error("createBidRequest: requirements must be a non-empty array");
  }
  if (typeof input.reply_to !== "string" || input.reply_to.length === 0) {
    throw new Error("createBidRequest: reply_to is required");
  }
  const timeout = input.bid_timeout_ms ?? DEFAULT_BID_TIMEOUT_MS;
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error(`createBidRequest: bid_timeout_ms must be positive (got ${timeout})`);
  }
  const priority = input.priority ?? 5;
  if (!Number.isInteger(priority) || priority < 0) {
    throw new Error(`createBidRequest: priority must be a non-negative integer (got ${priority})`);
  }
  return {
    task_id: input.task_id ?? crypto.randomUUID(),
    requirements: [...input.requirements],
    priority,
    bid_timeout_ms: timeout,
    selection_strategy: input.selection_strategy ?? "lowest-load",
    reply_to: input.reply_to,
    ...(input.task_summary ? { task_summary: input.task_summary } : {}),
  };
}
