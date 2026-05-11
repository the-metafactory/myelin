import type { MyelinEnvelope, Sovereignty } from "../types";
import type { PrincipalRegistry } from "../identity/registry";
import { createEnvelope } from "../envelope";
import { collectBids, type BidSource, type BidDrop } from "./collector";
import { createBidLifecycleEvent } from "./lifecycle";
import { RetryContext } from "./retry";
import { deriveBidRequestSubject, deriveAssignmentSubject } from "./subjects";
import type { BidRequest, BidResponse, TaskAssignment } from "./types";
import { MAX_WINNER_RETRIES } from "./types";

/**
 * Function the publisher calls to put an envelope on the wire. Transport
 * choice (NATS, in-memory, test channel) is the caller's problem. The
 * publisher does NOT sign envelopes itself — per the bidding lifecycle
 * doctrine, transport owns signing (see src/bidding/lifecycle.ts).
 */
export type PublishFn = (subject: string, envelope: MyelinEnvelope) => Promise<void>;

export interface BiddingPublisherOptions {
  org: string;
  source: string;
  sovereignty: Sovereignty;
  publish: PublishFn;
  registry: PrincipalRegistry;
}

/**
 * Outcome the caller signals after each assignment publish:
 *   - `"ack"` — winner accepted, round terminates successfully.
 *   - `"nak"` — winner refused, publisher excludes them and retries
 *     with next-best (subject to {@link RunBiddingRoundInput.maxRetries}).
 */
export type WinnerAckResult = "ack" | "nak";

export type WinnerAck = (
  winner: BidResponse,
  attempt: number,
) => Promise<WinnerAckResult> | WinnerAckResult;

export interface RunBiddingRoundInput {
  capability: string;
  request: BidRequest;
  bidSource: BidSource;
  payload: Record<string, unknown>;
  correlationId?: string;
  signal?: AbortSignal;
  /**
   * Optional ack/nak signal. Called once per assignment with the winner
   * and the zero-based retry attempt (0 = initial selection). Resolve
   * to `"ack"` to terminate successfully; resolve to `"nak"` to exclude
   * this winner and select next-best.
   *
   * When omitted, the round terminates immediately after the first
   * assignment publish — same behavior as the pre-retry slice. Existing
   * callers do not need to change.
   */
  winnerAck?: WinnerAck;
  /**
   * Override the maximum number of post-initial nak retries. Defaults
   * to {@link MAX_WINNER_RETRIES} (2). A value of 0 disables retries.
   */
  maxRetries?: number;
}

/**
 * The kind of envelope each emitted event carries. Mirrors the spec
 * step ordering in plan.md §Bidding Round Lifecycle: bid-request is
 * the broadcast advertisement; bid-opened/received/retry/closed/assigned
 * are the lifecycle markers; assignment is the direct-address publish
 * that wakes the winner.
 */
export type PublishedEventKind =
  | "bid-request"
  | "bid-opened"
  | "bid-received"
  | "bid-retry"
  | "bid-closed"
  | "bid-assigned"
  | "assignment";

export interface PublishedEvent {
  kind: PublishedEventKind;
  subject: string;
  envelope: MyelinEnvelope;
}

export interface RunBiddingRoundResult {
  winner: BidResponse | null;
  bids: BidResponse[];
  drops: BidDrop[];
  selectionReason: string | null;
  participants: number;
  events: PublishedEvent[];
  /** Number of nak-driven re-selections performed. 0 = first winner kept. */
  retryCount: number;
  /** Bidders excluded due to nak, in nak order. */
  nakedWinners: string[];
}

export interface BiddingPublisher {
  runRound(input: RunBiddingRoundInput): Promise<RunBiddingRoundResult>;
}

/**
 * Bidding-round orchestrator with optional winner-nak retry.
 *
 * Flow (matches F-10 plan.md §Bidding Round Lifecycle):
 *
 *   1. Broadcast bid request on `local.{org}.tasks.bid-request.{capability}`.
 *   2. Emit `bid-opened` lifecycle event.
 *   3. Collect bids via {@link collectBids} for `request.bid_timeout_ms`,
 *      verifying signatures against `registry` and producing a verified
 *      bid pool.
 *   4. For each accepted bid, emit `bid-received`.
 *   5. Select an initial winner via {@link RetryContext.selectInitial}.
 *   6. Assignment loop:
 *        a. Publish a `TaskAssignment` envelope to the winner's
 *           direct-address subject.
 *        b. If `winnerAck` is supplied, await its decision. On `"nak"`:
 *           emit `bid-retry` (with `retry_attempt` + `bidder`), exclude
 *           the loser via {@link RetryContext.retryAfterNak}, and loop.
 *           Loop ends when the caller acks, `maxRetries` is reached, or
 *           no more eligible bidders remain.
 *        c. If `winnerAck` is omitted, the first winner is kept (legacy
 *           single-round behavior).
 *   7. Emit `bid-closed` with the final participant count.
 *   8. If a winner was confirmed, emit `bid-assigned`.
 *
 * Returns the confirmed winner (or `null`), the verified bid pool, the
 * drop log, the selection reason for the confirmed winner, the
 * participant count, an ordered list of every envelope the publisher
 * placed on the wire, the retry count, and the bidders excluded due
 * to nak.
 *
 * Deferred to follow-up PRs:
 *   - Publisher-side inbox subscription BEFORE bid-request broadcast
 *     (currently `collectBids` subscribes after broadcast — fast
 *     agents race the subscription).
 *   - Dead-letter routing on the no-bids / all-naked path.
 *   - Streaming `bid-received` emission during collection.
 */
export function createBiddingPublisher(options: BiddingPublisherOptions): BiddingPublisher {
  const { org, source, sovereignty, publish, registry } = options;

  return {
    async runRound(input: RunBiddingRoundInput): Promise<RunBiddingRoundResult> {
      const { capability, request, bidSource, correlationId, signal, winnerAck, maxRetries } = input;
      const payload: Record<string, unknown> = structuredClone(input.payload);
      const events: PublishedEvent[] = [];
      const corrOpt = correlationId ? { correlation_id: correlationId } : {};

      const emit = async (
        kind: PublishedEventKind,
        subject: string,
        envelope: MyelinEnvelope,
      ): Promise<void> => {
        events.push({ kind, subject, envelope });
        await publish(subject, envelope);
      };

      const publishAssignment = async (winner: BidResponse, reason: string | null): Promise<void> => {
        const assignment: TaskAssignment = {
          task_id: request.task_id,
          winner: winner.bidder,
          payload,
          bid_round: {
            participants: collection.bids.length,
            selection_reason: reason ?? "",
          },
        };
        const assignmentEnvelope = createEnvelope({
          source,
          type: "tasks.assignment",
          sovereignty,
          payload: { ...assignment },
          ...corrOpt,
        });
        await emit(
          "assignment",
          deriveAssignmentSubject(org, winner.bidder, capability),
          assignmentEnvelope,
        );
      };

      const requestEnvelope = createEnvelope({
        source,
        type: "tasks.bid-request",
        sovereignty,
        payload: { ...request },
        ...corrOpt,
      });
      await emit("bid-request", deriveBidRequestSubject(org, capability), requestEnvelope);

      const opened = createBidLifecycleEvent({
        org,
        source,
        sovereignty,
        type: "bid-opened",
        input: { task_id: request.task_id, participants: 0 },
        ...corrOpt,
      });
      await emit("bid-opened", opened.subject, opened.envelope);

      const collection = await collectBids({
        source: bidSource,
        registry,
        taskId: request.task_id,
        selectionStrategy: request.selection_strategy,
        deadlineMs: request.bid_timeout_ms,
        ...(signal ? { signal } : {}),
      });

      for (const bid of collection.bids) {
        const received = createBidLifecycleEvent({
          org,
          source,
          sovereignty,
          type: "bid-received",
          input: { task_id: request.task_id, bidder: bid.bidder },
          ...corrOpt,
        });
        await emit("bid-received", received.subject, received.envelope);
      }

      const retry = new RetryContext({
        bids: collection.bids,
        strategy: request.selection_strategy,
        maxRetries: maxRetries ?? MAX_WINNER_RETRIES,
      });

      let outcome = retry.selectInitial();
      let confirmedWinner: BidResponse | null = null;
      let confirmedReason: string | null = null;
      const nakedWinners: string[] = [];

      while (outcome) {
        await publishAssignment(outcome.winner, outcome.reason);

        // Without a winnerAck signal the caller has no nak channel —
        // keep the first winner and exit the loop. This preserves the
        // pre-retry slice's behavior so existing callers don't break.
        if (!winnerAck) {
          confirmedWinner = outcome.winner;
          confirmedReason = outcome.reason;
          break;
        }

        const ack = await winnerAck(outcome.winner, retry.attemptCount());
        if (ack === "ack") {
          confirmedWinner = outcome.winner;
          confirmedReason = outcome.reason;
          break;
        }

        // Nak path: record, emit bid-retry, re-select.
        const loser = outcome.winner.bidder;
        nakedWinners.push(loser);

        const retried = createBidLifecycleEvent({
          org,
          source,
          sovereignty,
          type: "bid-retry",
          input: {
            task_id: request.task_id,
            bidder: loser,
            retry_attempt: retry.attemptCount() + 1,
          },
          ...corrOpt,
        });
        await emit("bid-retry", retried.subject, retried.envelope);

        outcome = retry.retryAfterNak(loser);
        // outcome === null means either maxRetries reached or every
        // remaining bidder is excluded. Either way, loop falls through
        // to bid-closed without bid-assigned.
      }

      const closed = createBidLifecycleEvent({
        org,
        source,
        sovereignty,
        type: "bid-closed",
        input: { task_id: request.task_id, participants: collection.bids.length },
        ...corrOpt,
      });
      await emit("bid-closed", closed.subject, closed.envelope);

      if (confirmedWinner) {
        const assignedInput = {
          task_id: request.task_id,
          winner: confirmedWinner.bidder,
          ...(confirmedReason ? { selection_reason: confirmedReason } : {}),
        };
        const assigned = createBidLifecycleEvent({
          org,
          source,
          sovereignty,
          type: "bid-assigned",
          input: assignedInput,
          ...corrOpt,
        });
        await emit("bid-assigned", assigned.subject, assigned.envelope);
      }

      return {
        winner: confirmedWinner,
        bids: collection.bids,
        drops: collection.drops,
        selectionReason: confirmedReason,
        participants: collection.bids.length,
        events,
        retryCount: retry.attemptCount(),
        nakedWinners,
      };
    },
  };
}
