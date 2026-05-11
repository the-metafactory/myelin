/**
 * F-10: bidding sub-protocol — request/reply task routing.
 *
 * The bidding module implements the four-piece round lifecycle from
 * `.specify/specs/f-10-request-reply-pattern/plan.md`:
 *
 *   1. **Publisher** (`createBiddingPublisher`) broadcasts a signed bid
 *      request, collects verified responses on a reply inbox, selects a
 *      winner, and publishes a direct-address assignment.
 *   2. **Agent** (`createBiddingAgent`) subscribes per capability,
 *      evaluates each request via a caller-supplied `BidEvaluator`, and
 *      replies with a signed `BidResponse`.
 *   3. **Collector** (`collectBids`) is the verification + selection
 *      core used by the publisher; transport-agnostic via `BidSource`.
 *   4. **Lifecycle** (`createBidLifecycleEvent`) constructs the five
 *      unsigned envelopes (`bid-opened` / `bid-received` / `bid-closed`
 *      / `bid-retry` / `bid-assigned`) on `local.{org}.dispatch.bid.>`.
 *
 * Supporting primitives:
 *   - `createBidRequest` (typed constructor + defaults)
 *   - `signBidResponse` / `verifyBidResponse` (Ed25519 + canonical JCS)
 *   - `selectWinner` (lowest-load / lowest-cost / highest-match)
 *   - `RetryContext` (winner-nak exclusion + attempt counter)
 *   - subject derivation: `deriveBidRequestSubject` /
 *     `deriveAssignmentSubject` / `deriveBidLifecycleSubject`
 *
 * **Reading order for new contributors:** types → request → response →
 * selection → lifecycle → collector → publisher → agent → integration
 * tests under `tests/integration/bidding-round.test.ts`.
 *
 * Subject namespaces this module owns (do not overlap):
 *   - `local.{org}.tasks.bid-request.{capability}` — broadcast request
 *   - `local.{org}.tasks.@{principal}.{capability}` — direct-address
 *     assignment (F-019 task subject grammar)
 *   - `local.{org}.dispatch.bid.>` — bidding lifecycle (NOT
 *     `dispatch.task.>` — F-020 owns that)
 */
export type {
  SelectionStrategy,
  BidRequest,
  BidResponse,
  TaskAssignment,
  BidLifecycleEventType,
  BidLifecycleEventInput,
} from "./types";
export { DEFAULT_BID_TIMEOUT_MS, MAX_WINNER_RETRIES } from "./types";

export {
  deriveBidRequestSubject,
  deriveAssignmentSubject,
  deriveBidLifecycleSubject,
} from "./subjects";

export { createBidRequest, type CreateBidRequestInput } from "./request";

export {
  signBidResponse,
  verifyBidResponse,
  type CreateBidResponseInput,
  type BidVerificationResult,
} from "./response";

export { selectWinner, type SelectionOutcome } from "./selection";

export { RetryContext, type RetryContextOptions } from "./retry";

export {
  createBidLifecycleEvent,
  type CreateBidLifecycleEventOptions,
} from "./lifecycle";

export {
  collectBids,
  type BidSource,
  type BidDrop,
  type CollectBidsInput,
  type BidCollectionResult,
} from "./collector";

export {
  createBiddingPublisher,
  type PublishFn,
  type BiddingPublisher,
  type BiddingPublisherOptions,
  type RunBiddingRoundInput,
  type RunBiddingRoundResult,
  type PublishedEvent,
  type PublishedEventKind,
} from "./publisher";

export {
  createBiddingAgent,
  type BidEvaluator,
  type BiddingAgent,
  type BiddingAgentOptions,
  type AgentObservation,
  type AgentObservationKind,
  type AgentTransportSubscribe,
  type AgentTransportPublish,
} from "./agent";
