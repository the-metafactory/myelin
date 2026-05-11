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
  /**
   * Fired once after the bid source has subscribed but before the
   * deadline timer starts. Lets the caller (notably BiddingPublisher)
   * emit the bid-request broadcast AFTER the inbox is bound,
   * eliminating the race where fast agents reply before the
   * subscription is active. The returned promise is awaited — if it
   * throws, the subscription is torn down and the error propagates.
   */
  onSubscribed?: () => Promise<void> | void;
  /**
   * Fired once per accepted (verified, deduped, non-excluded) bid as
   * it arrives, in arrival order, BEFORE the deadline elapses. Lets
   * the caller stream `bid-received` lifecycle envelopes per-bid
   * rather than batching them after collection. Dropped bids never
   * trigger this hook — only bids that land in `result.bids`.
   *
   * Errors from this hook are caught and pushed onto `drops` so a
   * faulty consumer cannot crash the bidding loop. The accepted bid
   * stays in `result.bids` regardless of hook outcome.
   */
  onBidAccepted?: (bid: BidResponse) => Promise<void> | void;
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
    try {
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
      // Claim the bidder BEFORE awaiting verification: concurrent handler
      // invocations from the same bidder would otherwise both pass the
      // `has` check, both verify, and both be accepted. A failed-verification
      // bid still blocks the bidder for this round — a bad signature is not
      // a free retry.
      seenBidders.add(bid.bidder);
      const verification = await verifyBidResponse(bid, registry);
      if (closed) {
        drops.push({ bidder: bid.bidder, reason: "arrived after deadline" });
        return;
      }
      if (!verification.valid) {
        drops.push({ bidder: bid.bidder, reason: `verification failed: ${verification.reason}` });
        return;
      }
      accepted.push(bid);
      // Stream the acceptance to the caller (publisher emits
      // `bid-received` here). Hook errors are isolated — the bid
      // stays accepted, but the failure surfaces as a drop entry so
      // a faulty observer is visible without crashing the loop.
      if (input.onBidAccepted) {
        try {
          await input.onBidAccepted(bid);
        } catch (err) {
          drops.push({
            bidder: bid.bidder,
            reason: `onBidAccepted hook error: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }
    } catch (err) {
      // The source delivers bids fire-and-forget; if verifyBidResponse (or
      // anything else in this handler) throws on a crafted/adversarial bid,
      // the rejection must surface as a drop entry — not an unhandled
      // promise rejection that leaves the bid silently invisible.
      drops.push({
        bidder: bid?.bidder,
        reason: `handler error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  const subscription = await source(handler);

  try {
    // Subscribe-then-publish hook: callers wire the bid-request
    // broadcast here so it lands only after the inbox is bound.
    // Errors from this hook tear down the subscription cleanly via
    // the surrounding try/finally.
    if (input.onSubscribed) {
      await input.onSubscribed();
    }

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

  // `accepted` is already filtered against `excluded` at handler-entry time
  // (lines 84-86), so we deliberately pass an empty exclusion set here —
  // the invariant ("accepted bids are clean") is explicit at the call site.
  const outcome = selectWinner(accepted, selectionStrategy);
  return { bids: accepted, drops, outcome };
}
