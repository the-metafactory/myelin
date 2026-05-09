# Implementation Tasks: F-10 Request-Reply Pattern (Bidding)

## Progress Tracking

| Task | Status | Notes |
|------|--------|-------|
| T-1.1 | ☐ | Bidding types |
| T-1.2 | ☐ | Extend envelope types |
| T-1.3 | ☐ | Subject helpers |
| T-2.1 | ☐ | Bid request creation |
| T-2.2 | ☐ | Bid response creation + signing |
| T-2.3 | ☐ | Bid response verification |
| T-3.1 | ☐ | Selection strategies |
| T-3.2 | ☐ | Lifecycle event helpers |
| T-4.1 | ☐ | Bid collector |
| T-4.2 | ☐ | Retry logic |
| T-5.1 | ☐ | Bidding publisher |
| T-5.2 | ☐ | Bidding agent |
| T-6.1 | ☐ | Integration tests |
| T-6.2 | ☐ | Module exports |

---

## Group 1: Foundation (Types + Schemas)

### T-1.1: Define bidding types [T]
- **File:** `src/bidding/types.ts`
- **Test:** `src/bidding/types.test.ts`
- **Dependencies:** none
- **Description:** Define core bidding types and Zod schemas:
  - `SelectionStrategy` type: `'lowest-load' | 'lowest-cost' | 'highest-match'`
  - `BidRequest` interface: task_id, requirements[], priority, bid_timeout_ms, selection_strategy, reply_to, task_summary?
  - `BidResponse` interface: task_id, bidder (DID), load, capability_match, cost?, constraints?, signed_by
  - `TaskAssignment` interface: task_id, winner, payload, bid_round metadata
  - Zod schemas for runtime validation
  - Export `DEFAULT_BID_TIMEOUT_MS = 2000`

### T-1.2: Extend envelope types for bidding [T]
- **File:** `src/types.ts` (modify existing)
- **Test:** `src/envelope.test.ts` (add cases)
- **Dependencies:** T-1.1
- **Description:** Extend MyelinEnvelope with bidding support:
  - Add `SovereigntyRequired` type: `'open' | 'selective' | 'strict' | 'bidding'`
  - Add optional `sovereignty_required` field to `MyelinEnvelope`
  - Add `BidRequestEnvelope`, `BidResponseEnvelope`, `AssignmentEnvelope` type aliases
  - Ensure backwards compatibility (field is optional)

### T-1.3: Subject namespace helpers [T] [P with T-1.2]
- **File:** `src/bidding/subjects.ts`
- **Test:** `src/bidding/subjects.test.ts`
- **Dependencies:** T-1.1
- **Description:** Functions to derive NATS subjects:
  - `deriveBidRequestSubject(org, capability)` → `local.{org}.tasks.bid-request.{capability}`
  - `deriveAssignmentSubject(org, principal, capability)` → `local.{org}.tasks.@{principal}.{capability}`
  - `deriveBidLifecycleSubject(org, event)` → `local.{org}.dispatch.task.{event}`
  - Validate inputs (no wildcards in org/capability)

---

## Group 2: Request/Response Primitives

### T-2.1: Bid request creation [T]
- **File:** `src/bidding/request.ts`
- **Test:** `src/bidding/request.test.ts`
- **Dependencies:** T-1.1, T-1.3
- **Description:** Functions to create and sign bid requests:
  - `createBidRequest(options)` → BidRequest (generates task_id if not provided)
  - `createBidRequestEnvelope(request, identity)` → signed MyelinEnvelope
  - Validate requirements array non-empty
  - Default timeout to `DEFAULT_BID_TIMEOUT_MS`
  - Default strategy to `'lowest-load'`

### T-2.2: Bid response creation + signing [T]
- **File:** `src/bidding/response.ts`
- **Test:** `src/bidding/response.test.ts`
- **Dependencies:** T-1.1, T-2.1
- **Description:** Functions to create and sign bid responses:
  - `createBidResponse(options)` → BidResponse (unsigned)
  - `signBidResponse(response, identity)` → BidResponse with signed_by
  - Uses existing `signEnvelope()` from identity layer
  - Validate load in [0.0, 1.0], capability_match in [0.0, 1.0]

### T-2.3: Bid response verification [T] [P with T-2.2]
- **File:** `src/bidding/response.ts` (add to existing)
- **Test:** `src/bidding/response.test.ts` (add cases)
- **Dependencies:** T-1.1, T-2.2
- **Description:** Verify bid response signatures:
  - `verifyBidResponse(response, registry)` → VerificationResult
  - Uses existing `verifyEnvelopeIdentity()` from identity layer
  - Reject if bidder DID doesn't match signed_by.principal
  - Tests: valid signature, tampered payload, unknown principal

---

## Group 3: Selection + Lifecycle

### T-3.1: Selection strategies [T]
- **File:** `src/bidding/selection.ts`
- **Test:** `src/bidding/selection.test.ts`
- **Dependencies:** T-1.1
- **Description:** Pure functions for bid selection:
  - `selectWinner(bids: BidResponse[], strategy: SelectionStrategy)` → BidResponse | null
  - Strategy `lowest-load`: return bid with min load
  - Strategy `lowest-cost`: return bid with min cost (skip bids without cost)
  - Strategy `highest-match`: return bid with max capability_match
  - Tie-breaker: first bid in array wins (stable sort)
  - Return null if bids array empty
  - Tests: each strategy, ties, empty input, single bid, mixed costs

### T-3.2: Lifecycle event helpers [T] [P with T-3.1]
- **File:** `src/bidding/lifecycle.ts`
- **Test:** `src/bidding/lifecycle.test.ts`
- **Dependencies:** T-1.1, T-1.3
- **Description:** Emit bid lifecycle events:
  - `createBidLifecycleEvent(type, taskId, metadata)` → MyelinEnvelope
  - Event types: `'bid-opened'`, `'bid-received'`, `'bid-closed'`, `'bid-retry'`, `'assigned'`
  - Metadata varies by type (participants count, winner DID, etc.)
  - Sign with publisher identity

---

## Group 4: Collection + Retry

### T-4.1: Bid collector [T]
- **File:** `src/bidding/collector.ts`
- **Test:** `src/bidding/collector.test.ts`
- **Dependencies:** T-1.1, T-2.3, T-3.1
- **Description:** Collect bids from NATS inbox:
  - `BidCollector` class with `collect(transport, inbox, timeoutMs, registry)` → Promise<BidResponse[]>
  - Subscribe to reply inbox
  - Verify each bid signature on arrival (reject invalid)
  - Accumulate valid bids until timeout
  - Return collected bids (empty array if none)
  - Clean up subscription on timeout/error
  - Tests: timeout behavior, signature verification, partial collection, cleanup

### T-4.2: Winner-nak retry logic [T]
- **File:** `src/bidding/retry.ts`
- **Test:** `src/bidding/retry.test.ts`
- **Dependencies:** T-1.1, T-3.1
- **Description:** Retry selection on winner nak:
  - `RetryContext` class: tracks bid pool, attempt count, excluded DIDs
  - `selectNextBest(context)` → BidResponse | null
  - Exclude previous winner from pool
  - Max 2 retries (configurable)
  - Return null when retries exhausted or pool empty
  - Tests: retry next-best, exhaust retries, single bid (no retry possible)

---

## Group 5: Publisher + Agent

### T-5.1: Bidding publisher [T]
- **File:** `src/bidding/publisher.ts`
- **Test:** `src/bidding/publisher.test.ts`
- **Dependencies:** T-2.1, T-3.2, T-4.1, T-4.2
- **Description:** Full bidding publisher implementation:
  - `BiddingPublisherOptions`: transport, defaultTimeoutMs, registry, identity
  - `createBiddingPublisher(options)` → BiddingPublisher
  - `publishWithBidding(envelope, options)`:
    1. Create NATS inbox
    2. Broadcast bid request
    3. Emit `bid-opened` lifecycle
    4. Collect bids via BidCollector
    5. Emit `bid-received` for each bid
    6. Select winner via strategy
    7. If no bids: route to dead-letter, emit `failed`
    8. Publish assignment to winner's direct-address subject
    9. Emit `bid-closed` + `assigned`
    10. Return PublishWithBiddingResult
  - Handle winner nak via retry logic
  - Tests: happy path, no-bids timeout, selection strategies

### T-5.2: Bidding agent [T]
- **File:** `src/bidding/agent.ts`
- **Test:** `src/bidding/agent.test.ts`
- **Dependencies:** T-1.1, T-1.3, T-2.2
- **Description:** Agent-side bid participation:
  - `BidEvaluator` interface: getLoad(), evaluateMatch(requirements), getCost?(), shouldBid(request)
  - `BiddingAgentOptions`: transport, identity, evaluator, capabilities[]
  - `createBiddingAgent(options)` → BiddingAgent
  - `start()`: subscribe to `tasks.bid-request.{capability}` for each capability (no queue group)
  - On request: evaluate via BidEvaluator, if shouldBid() → sign and reply to inbox
  - `stop()`: unsubscribe all
  - Tests: receives request, evaluates, responds; declines when shouldBid() false

---

## Group 6: Integration + Exports

### T-6.1: Integration tests [T]
- **File:** `src/bidding/integration.test.ts`
- **Test:** (self)
- **Dependencies:** T-5.1, T-5.2
- **Description:** End-to-end bidding protocol tests:
  - **Test 1**: Publisher broadcasts, 3 agents with different loads bid, lowest-load wins, receives assignment
  - **Test 2**: No agents online, timeout expires, task dead-lettered, lifecycle events emitted
  - **Test 3**: Winner naks (simulated), next-best selected, assignment re-published
  - **Test 4**: Single bidder, wins by default after timeout
  - Use in-memory transport for isolation
  - Verify all lifecycle events emitted correctly

### T-6.2: Module exports [T] [P with T-6.1]
- **File:** `src/bidding/index.ts`
- **Test:** (compile check)
- **Dependencies:** T-5.1, T-5.2
- **Description:** Export public API:
  - Types: SelectionStrategy, BidRequest, BidResponse, TaskAssignment, BidEvaluator
  - Functions: createBiddingPublisher, createBiddingAgent
  - Constants: DEFAULT_BID_TIMEOUT_MS
  - Update `src/index.ts` to export bidding module

---

## Execution Order

```
Phase 1 (parallel):
├── T-1.1 (types - no deps)
└── T-1.3 (subjects - no deps after T-1.1 types defined)

Phase 2 (after T-1.1):
├── T-1.2 (envelope extension)
├── T-2.1 (bid request)
├── T-3.1 (selection)
└── T-3.2 (lifecycle)

Phase 3 (after T-2.1):
├── T-2.2 (bid response)
└── T-2.3 (verification, parallel with T-2.2)

Phase 4 (after T-2.3, T-3.1):
├── T-4.1 (collector)
└── T-4.2 (retry)

Phase 5 (after T-4.1, T-4.2):
├── T-5.1 (publisher)
└── T-5.2 (agent)

Phase 6 (after T-5.1, T-5.2):
├── T-6.1 (integration tests)
└── T-6.2 (exports, parallel with T-6.1)
```

---

## Dependency Graph

```
T-1.1 ──┬─→ T-1.2 ──→ (envelope compat)
        │
        ├─→ T-1.3 ──→ T-2.1 ──┬─→ T-2.2 ──→ T-2.3 ──→ T-4.1 ──→ T-5.1 ──→ T-6.1
        │                     │                                  │         │
        │                     └─→ T-3.2 ─────────────────────────┘         │
        │                                                                   │
        └─→ T-3.1 ──────────────────────────→ T-4.2 ──→ T-5.1              │
                                                        │                   │
                                                        └─→ T-5.2 ──→ T-6.1│
                                                                           │
                                                                    T-6.2 ←┘
```

---

## Notes

- **MY-400 dependency satisfied**: `src/identity/` has sign, verify, registry
- **Transport layer ready**: `src/transport/nats.ts` exists, may need request/reply helpers
- **In-memory transport**: Use for tests (already in `src/transport/in-memory.ts`)
- **No JetStream for bid round**: Use core NATS pub/sub + inbox pattern
- **Assignment uses JetStream**: Existing TASKS stream pattern from F-019

---

*Generated: 2026-05-09*
