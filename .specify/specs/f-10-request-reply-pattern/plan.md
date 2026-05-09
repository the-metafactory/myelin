# Technical Plan: F-10 Request-Reply Pattern (Bidding)

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          BIDDING ROUND LIFECYCLE                             │
└─────────────────────────────────────────────────────────────────────────────┘

                            ┌──────────────────┐
                            │  Task Publisher  │
                            │  (Orchestrator)  │
                            └────────┬─────────┘
                                     │ 1. createBidRequest()
                                     ▼
            ┌────────────────────────────────────────────────────┐
            │  local.{org}.tasks.bid-request.{capability}        │
            │  (Core NATS — no JetStream, broadcast to all)      │
            └─────────────────────────┬──────────────────────────┘
                                      │
           ┌──────────────────────────┼──────────────────────────┐
           ▼                          ▼                          ▼
    ┌─────────────┐            ┌─────────────┐            ┌─────────────┐
    │   Agent A   │            │   Agent B   │            │   Agent C   │
    │  (Luna)     │            │  (Fern)     │            │  (Kai)      │
    │  load: 0.2  │            │  load: 0.7  │            │  load: 0.1  │
    └──────┬──────┘            └──────┬──────┘            └──────┬──────┘
           │ evaluateBid()            │ evaluateBid()            │ evaluateBid()
           │                          │                          │
           ▼                          ▼                          ▼
    ┌─────────────┐            ┌─────────────┐            ┌─────────────┐
    │ BidResponse │            │  DECLINE    │            │ BidResponse │
    │ (signed)    │            │  (no reply) │            │ (signed)    │
    └──────┬──────┘            └─────────────┘            └──────┬──────┘
           │                                                     │
           └─────────────────────────┬───────────────────────────┘
                                     │ 2. collectBids() + timeout
                                     ▼
                            ┌──────────────────┐
                            │  BidCollector    │
                            │  _INBOX.xxx.>    │
                            └────────┬─────────┘
                                     │ 3. selectWinner(strategy)
                                     ▼
                            ┌──────────────────┐
                            │ Strategy Engine  │
                            │ lowest-load      │
                            │ lowest-cost      │
                            │ highest-match    │
                            └────────┬─────────┘
                                     │ 4. publishAssignment()
                                     ▼
            ┌────────────────────────────────────────────────────┐
            │  local.{org}.tasks.@did-mf-kai.{capability}        │
            │  (JetStream — durable, exactly-once to winner)     │
            └─────────────────────────┬──────────────────────────┘
                                      │
                                      ▼
                            ┌──────────────────┐
                            │   Winner (Kai)   │
                            │   receives task  │
                            └──────────────────┘
```

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Bid broadcast | Core NATS pub/sub | NFR-4: No JetStream for bid round; ephemeral request/reply |
| Bid reply | NATS inbox pattern | Built-in request/reply; auto-cleanup |
| Bid signing | @noble/ed25519 | Already used in MY-400; <50μs overhead |
| Assignment delivery | JetStream | Durable; matches existing TASKS stream |
| Timeout | `setTimeout` + Promise | Simple; no external deps |
| Selection | Pure functions | Testable; enum-based strategy |

## Data Model

### Bid Request Schema

```typescript
// src/bidding/types.ts

import type { SignedBy } from '../identity/types';

/** Selection strategy for choosing bid winner */
export type SelectionStrategy = 'lowest-load' | 'lowest-cost' | 'highest-match';

/** Bid request broadcast to qualified agents */
export interface BidRequest {
  /** UUID correlating bids to originating task */
  task_id: string;
  
  /** Capability tags required to claim this task */
  requirements: string[];
  
  /** Task priority (higher = more urgent) */
  priority: number;
  
  /** Bid collection window in ms (default 2000) */
  bid_timeout_ms: number;
  
  /** How to pick the winner */
  selection_strategy: SelectionStrategy;
  
  /** NATS inbox for bid responses */
  reply_to: string;
  
  /** Human-readable task summary (no full payload—security) */
  task_summary?: string;
}

/** Signed bid response from an agent */
export interface BidResponse {
  /** Correlates to BidRequest.task_id */
  task_id: string;
  
  /** Principal DID of bidding agent (did:mf:kai) */
  bidder: string;
  
  /** Current agent load 0.0–1.0 */
  load: number;
  
  /** Capability match quality 0.0–1.0 */
  capability_match: number;
  
  /** Optional cost-per-unit for economics routing */
  cost?: number;
  
  /** Any execution constraints */
  constraints?: string[];
  
  /** Ed25519 signature (per MY-400) */
  signed_by: SignedBy;
}

/** Task assignment to winning bidder */
export interface TaskAssignment {
  /** Original task ID */
  task_id: string;
  
  /** Principal DID of selected agent */
  winner: string;
  
  /** Full task payload (only winner sees this) */
  payload: Record<string, unknown>;
  
  /** Bid round metadata for observability */
  bid_round: {
    /** Number of agents who submitted bids */
    participants: number;
    /** Human-readable selection reason */
    selection_reason: string;
    /** All DIDs who bid (for audit) */
    bidder_dids: string[];
  };
}
```

### Extended Envelope Types

```typescript
// src/types.ts — extend existing MyelinEnvelope

// Add to sovereignty_required union (from F-021):
export type SovereigntyRequired = 'open' | 'selective' | 'strict' | 'bidding';

// BidRequest is wrapped in envelope for signing/transport
export interface BidRequestEnvelope extends MyelinEnvelope {
  type: 'task.bid-request';
  payload: BidRequest;
}

// BidResponse is signed and sent to reply inbox
export interface BidResponseEnvelope extends MyelinEnvelope {
  type: 'task.bid-response';
  payload: Omit<BidResponse, 'signed_by'>;  // signed_by at envelope level
}

// Assignment is full MyelinEnvelope
export interface AssignmentEnvelope extends MyelinEnvelope {
  type: 'task.assignment';
  payload: TaskAssignment;
}
```

## API Contracts

### Publisher API

```typescript
// src/bidding/publisher.ts

export interface BiddingPublisherOptions {
  /** Transport for NATS operations */
  transport: NATSTransport;
  
  /** Default timeout if not specified in envelope */
  defaultTimeoutMs?: number;
  
  /** Principal registry for bid verification */
  registry: PrincipalRegistry;
  
  /** Signing identity for requests */
  identity: SigningIdentity;
}

export interface PublishWithBiddingResult {
  /** Winning bidder DID */
  winner: string;
  
  /** Number of bids received */
  bidCount: number;
  
  /** Why this bidder won */
  selectionReason: string;
  
  /** Assignment envelope that was published */
  assignment: AssignmentEnvelope;
}

export interface BiddingPublisher {
  /**
   * Publish task with bidding protocol.
   * 1. Broadcast bid request
   * 2. Collect and verify bids
   * 3. Select winner
   * 4. Publish assignment to winner
   * 5. Return result
   */
  publishWithBidding(
    envelope: MyelinEnvelope & { sovereignty_required: 'bidding' },
    options?: {
      timeoutMs?: number;
      selectionStrategy?: SelectionStrategy;
      taskSummary?: string;
    }
  ): Promise<PublishWithBiddingResult>;
  
  close(): Promise<void>;
}

export function createBiddingPublisher(
  options: BiddingPublisherOptions
): BiddingPublisher;
```

### Agent API

```typescript
// src/bidding/agent.ts

export interface BidEvaluator {
  /** Agent's current load (0.0–1.0) */
  getLoad(): number;
  
  /** How well agent matches requirements (0.0–1.0) */
  evaluateMatch(requirements: string[]): number;
  
  /** Optional cost per token/unit */
  getCost?(): number;
  
  /** Whether agent should bid on this task */
  shouldBid(request: BidRequest): boolean;
}

export interface BiddingAgentOptions {
  /** Transport for NATS operations */
  transport: NATSTransport;
  
  /** Agent's signing identity */
  identity: SigningIdentity;
  
  /** Bid evaluation logic */
  evaluator: BidEvaluator;
  
  /** Capabilities this agent registers for */
  capabilities: string[];
}

export interface BiddingAgent {
  /** Start listening for bid requests */
  start(): Promise<void>;
  
  /** Stop listening */
  stop(): Promise<void>;
}

export function createBiddingAgent(
  options: BiddingAgentOptions
): BiddingAgent;
```

## Subject Namespace

Per spec + F-019 conventions:

| Subject | Purpose | Transport |
|---------|---------|-----------|
| `local.{org}.tasks.bid-request.{capability}` | Bid request broadcast | Core NATS |
| `_INBOX.{random}.>` | Bid responses (NATS-generated) | Core NATS |
| `local.{org}.tasks.@{principal}.{capability}` | Assignment to winner | JetStream |
| `local.{org}.dispatch.task.bid-opened` | Lifecycle: bidding started | JetStream |
| `local.{org}.dispatch.task.bid-received` | Lifecycle: bid collected | JetStream |
| `local.{org}.dispatch.task.bid-closed` | Lifecycle: bidding complete | JetStream |

## Implementation Phases

### Phase 1: Types + Bid Request (Day 1)

Files: `src/bidding/types.ts`, `src/bidding/request.ts`

1. Define `BidRequest`, `BidResponse`, `TaskAssignment` types
2. Define `SelectionStrategy` enum
3. Implement `createBidRequest()` helper
4. Implement `signBidRequest()` (wraps in envelope, signs)
5. Tests: type validation, request creation

### Phase 2: Bid Response + Signing (Day 1-2)

Files: `src/bidding/response.ts`

1. Implement `createBidResponse()` helper
2. Implement `signBidResponse()` using existing `signEnvelope()`
3. Implement `verifyBidResponse()` using existing `verifyEnvelopeIdentity()`
4. Tests: sign→verify round-trip, reject unsigned, reject tampered

### Phase 3: Selection Strategies (Day 2)

Files: `src/bidding/selection.ts`

1. Implement `selectWinner(bids, strategy)` pure function
2. Strategy `lowest-load`: min(bid.load)
3. Strategy `lowest-cost`: min(bid.cost ?? Infinity)
4. Strategy `highest-match`: max(bid.capability_match)
5. Tie-breaker: first bid received (deterministic)
6. Tests: each strategy, tie-breaking, empty bids

### Phase 4: Bid Collector (Day 2-3)

Files: `src/bidding/collector.ts`

1. Implement `BidCollector` class
2. Subscribe to reply inbox
3. Verify each bid signature on arrival
4. Reject invalid/unsigned bids (log warning)
5. Accumulate valid bids until timeout
6. Return sorted bids by strategy
7. Tests: collection with timeout, signature verification, partial collection

### Phase 5: Publisher Integration (Day 3)

Files: `src/bidding/publisher.ts`

1. Implement `BiddingPublisher` class
2. Integration: envelope → bid-request → collect → select → assign
3. Emit lifecycle events (bid-opened, bid-closed)
4. Handle no-bids → dead-letter routing
5. Tests: full happy path, no-bids timeout, selection strategies

### Phase 6: Agent Integration (Day 3-4)

Files: `src/bidding/agent.ts`

1. Implement `BiddingAgent` class
2. Subscribe to `tasks.bid-request.{capability}` (non-queue, all agents receive)
3. Evaluate via `BidEvaluator` interface
4. Sign and send bid response to `reply_to`
5. Tests: agent receives request, evaluates, responds

### Phase 7: Winner-Nak Retry (Day 4)

Files: `src/bidding/retry.ts`

1. Implement retry logic for winner-nak scenario
2. On winner nak: select next-best from existing bid pool
3. Max 2 retries before dead-letter
4. Emit `dispatch.task.bid-retry` lifecycle event
5. Tests: retry on nak, exhaust retries → dead-letter

### Phase 8: Integration Tests + Docs (Day 4-5)

Files: `src/bidding/integration.test.ts`, `docs/bidding-protocol.md`

1. E2E test: publisher → 3 agents → winner receives task
2. E2E test: no bids → dead-letter
3. E2E test: winner nak → next-best selected
4. Document protocol for agent implementers

## File Structure

```
src/
├── bidding/
│   ├── index.ts              # Re-exports public API
│   ├── types.ts              # BidRequest, BidResponse, TaskAssignment, SelectionStrategy
│   ├── request.ts            # createBidRequest(), deriveBidSubject()
│   ├── response.ts           # createBidResponse(), signBidResponse(), verifyBidResponse()
│   ├── selection.ts          # selectWinner(), strategy implementations
│   ├── collector.ts          # BidCollector class
│   ├── publisher.ts          # BiddingPublisher class
│   ├── agent.ts              # BiddingAgent class, BidEvaluator interface
│   ├── retry.ts              # Winner-nak retry logic
│   ├── lifecycle.ts          # emitBidLifecycleEvent()
│   │
│   ├── request.test.ts
│   ├── response.test.ts
│   ├── selection.test.ts
│   ├── collector.test.ts
│   ├── publisher.test.ts
│   ├── agent.test.ts
│   ├── retry.test.ts
│   └── integration.test.ts   # E2E tests
│
├── transport/
│   ├── nats.ts               # Add request/reply helpers
│   └── ...
│
├── types.ts                  # Add SovereigntyRequired: 'bidding'
└── index.ts                  # Export bidding module
```

## Dependencies

| Dependency | Status | Required For |
|------------|--------|--------------|
| MY-400 (Identity) | ✅ Implemented | Signed bids, principal registry |
| @noble/ed25519 | ✅ In package.json | Bid signing |
| NATS core request/reply | ✅ Available | Bid broadcast + collection |
| JetStream TASKS stream | ✅ Spec complete (F-019) | Assignment delivery |
| F-021 Task Envelope | ✅ Spec complete | `sovereignty_required: 'bidding'` |
| F-020 Dispatch Lifecycle | ✅ Spec complete | Bid lifecycle events |
| F-022 Structured Nak | ✅ Spec complete | Winner-nak retry logic |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| NATS inbox timeout not honored | High | Use explicit `setTimeout`; clean up inbox subscription on timeout |
| Bid signature verification slow under load | Medium | Verification is ~50μs; batch verify if >50 bids (unlikely) |
| Clock skew between bidders | Low | `signed_by.at` tolerance already 5min (MY-400); bids are ephemeral |
| Race: winner nak arrives before assignment | Medium | Assignment publish is sync; nak handled by retry logic |
| All agents overloaded (no bids) | Medium | Explicit no-bids dead-letter path; lifecycle event for alerting |
| Bid spoofing (fake low load) | Low | Signed bids verify identity; misbehaving agents detectable via metrics |

## Test Strategy

### Unit Tests

| Module | Key Tests |
|--------|-----------|
| `types.ts` | Schema validation, required fields, enum bounds |
| `request.ts` | Create request, derive subject, sign request |
| `response.ts` | Create response, sign, verify, reject tampered |
| `selection.ts` | Each strategy, ties, empty input, single bid |
| `collector.ts` | Timeout, signature verification, partial collect |
| `retry.ts` | Retry next-best, exhaust max retries, dead-letter |

### Integration Tests

1. **Happy path**: Publisher broadcasts, 3 agents bid, lowest-load wins, receives assignment
2. **No bids**: Timeout expires, task dead-lettered, lifecycle events emitted
3. **Winner nak**: Winner rejects, next-best selected, assignment re-published
4. **Retry exhaustion**: Winner nak × 2, third fails → dead-letter
5. **Single bidder**: 1 bid + timeout, that bidder wins

### Load Tests (Future)

- 50 concurrent bidders, verify <3s total latency
- 100 bid requests/sec, verify no message loss

## Success Metrics

| Metric | Target | Source |
|--------|--------|--------|
| Bidding round latency | <3s end-to-end | NFR-1 |
| Bid collection capacity | 50+ bidders | NFR-2 |
| Bid verification | Local, no network | NFR-3 (principal registry) |
| JetStream independence | Bid round on core NATS | NFR-4 |
| Backwards compatible | Non-bidding tasks unaffected | NFR-5 |

---

*Generated: 2026-05-09*
*Source: F-10 Request-Reply Pattern Specification*
