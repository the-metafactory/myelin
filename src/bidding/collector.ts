import type { PrincipalRegistry } from "../identity/registry";
import type { BidResponse, SelectionStrategy } from "./types";
import { verifyBidResponse } from "./response";
import { selectWinner, type SelectionOutcome } from "./selection";

/**
 * BidSource abstracts how bid responses reach the collector. It is
 * intentionally transport-agnostic: callers wire a NATS subscriber on
 * the per-request reply inbox, an in-memory channel for tests, or
 * anything that can deliver {@link BidResponse} payloads through the
 * supplied handler. Returning an unsubscribe handle is mandatory —
 * the collector tears down the subscription on deadline or abort.
 */
export type BidSource = (
  handler: (bid: BidResponse) => Promise<void> | void,
) => Promise<{ unsubscribe(): Promise<void> }>;

export interface BidDrop {
  bidder?: string;
  reason: string;
}

export interface CollectBidsInput {
  source: BidSource;
  registry: PrincipalRegistry;
  taskId: string;
  selectionStrategy: SelectionStrategy;
  deadlineMs: number;
  excluded?: ReadonlySet<string>;
  signal?: AbortSignal;
}

export interface BidCollectionResult {
  bids: BidResponse[];
  drops: BidDrop[];
  outcome: SelectionOutcome | null;
}

/**
 * Collect bids on a single bidding round and choose a winner.
 *
 * Subscribes via {@link BidSource}, accumulates bids for `taskId` until
 * `deadlineMs` elapses (or `signal` aborts), then runs `selectWinner`
 * with `selectionStrategy` over the verified bids minus `excluded`.
 *
 * Drop rules applied in order, with the reason recorded in `result.drops`:
 *   1. Bid arrived after the deadline / abort — discarded.
 *   2. `bid.task_id` does not match `taskId` — discarded (no leak across rounds).
 *   3. `bid.bidder` is in `excluded` — discarded (retry exclusion honored).
 *   4. `bid.bidder` already produced a bid this round — discarded (first kept).
 *   5. `verifyBidResponse` returned `valid: false` — discarded with verifier reason.
 *
 * Verified bids are kept in arrival order. Selection is delegated to
 * `selectWinner`, so strategy-specific tie-breaking matches the rest of
 * the bidding module.
 */
export async function collectBids(input: CollectBidsInput): Promise<BidCollectionResult> {
  const { source, registry, taskId, selectionStrategy, deadlineMs, signal } = input;
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) {
    throw new Error(`collectBids: deadlineMs must be positive (got ${deadlineMs})`);
  }
  if (typeof taskId !== "string" || taskId.length === 0) {
    throw new Error("collectBids: taskId must be a non-empty string");
  }

  const excluded = new Set(input.excluded ?? []);
  const accepted: BidResponse[] = [];
  const drops: BidDrop[] = [];
  const seenBidders = new Set<string>();
  let closed = false;

  const handler = async (bid: BidResponse): Promise<void> => {
    if (closed) {
      drops.push({ bidder: bid?.bidder, reason: "arrived after deadline" });
      return;
    }
    if (bid.task_id !== taskId) {
      drops.push({ bidder: bid.bidder, reason: `task_id mismatch (${bid.task_id} ≠ ${taskId})` });
      return;
    }
    if (excluded.has(bid.bidder)) {
      drops.push({ bidder: bid.bidder, reason: "bidder is in excluded set" });
      return;
    }
    if (seenBidders.has(bid.bidder)) {
      drops.push({ bidder: bid.bidder, reason: "duplicate bid from bidder (first kept)" });
      return;
    }
    const verification = await verifyBidResponse(bid, registry);
    if (closed) {
      drops.push({ bidder: bid.bidder, reason: "arrived after deadline" });
      return;
    }
    if (!verification.valid) {
      drops.push({ bidder: bid.bidder, reason: `verification failed: ${verification.reason}` });
      return;
    }
    seenBidders.add(bid.bidder);
    accepted.push(bid);
  };

  const subscription = await source(handler);

  try {
    if (signal?.aborted) {
      // honor pre-aborted signal — no wait
    } else {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        }, deadlineMs);
        const onAbort = (): void => {
          clearTimeout(timer);
          resolve();
        };
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    }
  } finally {
    closed = true;
    await subscription.unsubscribe();
  }

  const outcome = selectWinner(accepted, selectionStrategy, excluded);
  return { bids: accepted, drops, outcome };
}
