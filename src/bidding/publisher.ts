import type { MyelinEnvelope, Sovereignty } from "../types";
import type { PrincipalRegistry } from "../identity/registry";
import { createEnvelope } from "../envelope";
import { collectBids, type BidSource, type BidDrop } from "./collector";
import { createBidLifecycleEvent } from "./lifecycle";
import { deriveBidRequestSubject, deriveAssignmentSubject } from "./subjects";
import type { BidRequest, BidResponse, TaskAssignment } from "./types";

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

export interface RunBiddingRoundInput {
  capability: string;
  request: BidRequest;
  bidSource: BidSource;
  payload: Record<string, unknown>;
  correlationId?: string;
  signal?: AbortSignal;
}

/**
 * The kind of envelope each emitted event carries. Mirrors the spec
 * step ordering in plan.md §Bidding Round Lifecycle: bid-request is
 * the broadcast advertisement; bid-opened/received/closed/assigned
 * are the lifecycle markers; assignment is the direct-address
 * publish that wakes the winner.
 */
export type PublishedEventKind =
  | "bid-request"
  | "bid-opened"
  | "bid-received"
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
}

export interface BiddingPublisher {
  runRound(input: RunBiddingRoundInput): Promise<RunBiddingRoundResult>;
}

/**
 * Single-round bidding orchestrator.
 *
 * Flow (matches F-10 plan.md §Bidding Round Lifecycle):
 *
 *   1. Broadcast bid request on `local.{org}.tasks.bid-request.{capability}`.
 *   2. Emit `bid-opened` lifecycle event.
 *   3. Collect bids via {@link collectBids} for `request.bid_timeout_ms`,
 *      verifying signatures against `registry` and selecting a winner.
 *   4. For each accepted bid, emit `bid-received`.
 *   5. If a winner was selected, publish a `TaskAssignment` envelope to
 *      `local.{org}.tasks.@{winner}.{capability}`.
 *   6. Emit `bid-closed` with the final participant count.
 *   7. If a winner was selected, emit `bid-assigned`.
 *
 * Returns the winner, the verified bid pool, the drop log, the
 * selection reason, the participant count, and an ordered list of
 * every envelope the publisher placed on the wire — for test
 * inspection and downstream observability.
 *
 * Deferred to follow-up PRs:
 *   - Winner-nak retry via {@link RetryContext}. The hooks (excluded
 *     bidder set, retry-attempt counter) are in place; wiring nak
 *     signals back into the round needs the JetStream subscription
 *     side which lives outside this transport-agnostic slice.
 *   - Dead-letter routing on the no-bids path. Currently a no-bid
 *     round emits `bid-closed` and returns `winner: null`; the
 *     dead-letter publish + `dispatch.task.failed` emission is a
 *     separate concern wired in the dispatch-side follow-up.
 *   - Streaming `bid-received` emission (during collection rather
 *     than after). The thin-slice batch emit preserves event order
 *     but does not interleave `bid-received` with arrival.
 */
export function createBiddingPublisher(options: BiddingPublisherOptions): BiddingPublisher {
  const { org, source, sovereignty, publish, registry } = options;

  return {
    async runRound(input: RunBiddingRoundInput): Promise<RunBiddingRoundResult> {
      const { capability, request, bidSource, correlationId, signal } = input;
      // Deep-snapshot the caller's payload at entry. Without this, a
      // caller that mutates the payload object between invocation and
      // assignment-envelope construction (which happens AFTER awaiting
      // the bid collection deadline) would leak the mutated value onto
      // the wire. structuredClone gives us deep value-semantics for
      // JSON-shaped payloads, which is what the bidding protocol carries.
      const payload: Record<string, unknown> = structuredClone(input.payload);
      const events: PublishedEvent[] = [];

      const emit = async (
        kind: PublishedEventKind,
        subject: string,
        envelope: MyelinEnvelope,
      ): Promise<void> => {
        events.push({ kind, subject, envelope });
        await publish(subject, envelope);
      };

      const requestEnvelope = createEnvelope({
        source,
        type: "tasks.bid-request",
        sovereignty,
        payload: { ...request },
        ...(correlationId ? { correlation_id: correlationId } : {}),
      });
      await emit("bid-request", deriveBidRequestSubject(org, capability), requestEnvelope);

      const opened = createBidLifecycleEvent({
        org,
        source,
        sovereignty,
        type: "bid-opened",
        input: { task_id: request.task_id, participants: 0 },
        ...(correlationId ? { correlation_id: correlationId } : {}),
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
          ...(correlationId ? { correlation_id: correlationId } : {}),
        });
        await emit("bid-received", received.subject, received.envelope);
      }

      const winner = collection.outcome?.winner ?? null;
      const selectionReason = collection.outcome?.reason ?? null;
      const participants = collection.bids.length;

      if (winner) {
        const assignment: TaskAssignment = {
          task_id: request.task_id,
          winner: winner.bidder,
          payload: { ...payload },
          bid_round: {
            participants,
            selection_reason: selectionReason ?? "",
          },
        };
        const assignmentEnvelope = createEnvelope({
          source,
          type: "tasks.assignment",
          sovereignty,
          payload: { ...assignment },
          ...(correlationId ? { correlation_id: correlationId } : {}),
        });
        await emit(
          "assignment",
          deriveAssignmentSubject(org, winner.bidder, capability),
          assignmentEnvelope,
        );
      }

      const closed = createBidLifecycleEvent({
        org,
        source,
        sovereignty,
        type: "bid-closed",
        input: { task_id: request.task_id, participants },
        ...(correlationId ? { correlation_id: correlationId } : {}),
      });
      await emit("bid-closed", closed.subject, closed.envelope);

      if (winner) {
        const assignedInput = {
          task_id: request.task_id,
          winner: winner.bidder,
          ...(selectionReason ? { selection_reason: selectionReason } : {}),
        };
        const assigned = createBidLifecycleEvent({
          org,
          source,
          sovereignty,
          type: "bid-assigned",
          input: assignedInput,
          ...(correlationId ? { correlation_id: correlationId } : {}),
        });
        await emit("bid-assigned", assigned.subject, assigned.envelope);
      }

      return {
        winner,
        bids: collection.bids,
        drops: collection.drops,
        selectionReason,
        participants,
        events,
      };
    },
  };
}
