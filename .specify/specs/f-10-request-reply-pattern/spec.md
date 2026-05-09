# Specification: F-10 — Request-Reply Pattern

## Context

> Generated in batch mode from decomposition on 2026-05-09
> Tracks: myelin#42, reconciles myelin#10 (previously scoped bidding out)
> Source: docs/design-agent-task-routing.md §Pattern 2 + §Pattern 4 Sovereignty Modes + Implementation step 10

## Problem Statement

**Core Problem**: JetStream pull consumers provide exactly-one delivery but no selection optimization. NATS picks the next available agent, not the best agent. For high-value tasks (deploy, release, security-critical operations), the requester needs to evaluate competing offers before committing.

**Current State**: Pattern 4 (JetStream + Capability Registry) handles most task routing via pull + nak sovereignty. But `sovereignty_required: bidding` in the envelope has no implementation path — agents cannot respond with bids, requesters cannot collect and evaluate offers.

**Gap**: When task envelope specifies `sovereignty_required: "bidding"`, the system has no mechanism to:
1. Broadcast a bid request to qualified agents
2. Collect signed bid responses with load/capability/cost signals
3. Select a winner based on configurable criteria
4. Assign the task to the winner atomically
5. Handle timeout and race conditions between bid acceptance and task start

**Urgency**: As agent pool grows, selection quality matters more. Deploy tasks routed to overloaded agents cause cascading delays. Without bidding, operators cannot express "I want the best-fit agent, not just any available agent."

**Impact if Unsolved**: Suboptimal agent selection for high-value tasks, no cost-based routing possible, sovereignty mode `bidding` remains dead code.

## Users & Stakeholders

| Consumer | Need | Verification Level |
|----------|------|-------------------|
| Task publishers | Route high-value tasks to optimal agent | Selection criteria (load, cost, capability match) |
| Bidding agents | Compete for desirable tasks by advertising fitness | Signed bids with verifiable identity |
| Orchestrators (M7) | Observe bidding rounds for audit/economics | Lifecycle events with bid metadata |
| Operators | Configure timeout, selection strategy, fallback behavior | Configuration surface |

## User Scenarios

### Scenario 1: High-Value Deploy Task with Load-Based Selection

- **Given** three agents (Luna, Fern, Kai) with `deploy.cloudflare` capability registered in AGENT_CAPABILITIES KV
- **And** Luna has load 0.2, Fern has load 0.7, Kai has load 0.1
- **When** an operator publishes a deploy task with `sovereignty_required: "bidding"`
- **Then** a bid-request is broadcast on `tasks.bid-request.deploy.cloudflare`
- **And** all three agents receive the request and evaluate their fitness
- **And** Luna and Kai reply with signed bids (Fern at 0.7 load declines to bid)
- **And** the selection step picks Kai (lowest load)
- **And** the task is assigned on `tasks.@kai.deploy.cloudflare`
- **And** lifecycle events `dispatch.task.bid-opened`, `dispatch.task.bid-received` (x2), `dispatch.task.assigned` are emitted

### Scenario 2: No Bids Received (Timeout Fallback)

- **Given** a deploy task with `sovereignty_required: "bidding"` and `bid_timeout_ms: 2000`
- **And** no agents with matching capability are online
- **When** the bid window expires with zero bids
- **Then** the task is routed to dead-letter with reason `no-bids`
- **And** lifecycle event `dispatch.task.failed` is emitted with `reason: "no-bids-received"`

### Scenario 3: Race Condition Between Bid and Task Start

- **Given** agent Kai wins the bid with load 0.1
- **But** between bid acceptance and task delivery, Kai's load increases to 0.9 (another task claimed)
- **When** the assignment envelope arrives at Kai
- **Then** Kai may nak with `not-now` (load exceeded)
- **And** the system either retries next-best bidder or routes to dead-letter (configurable)

### Scenario 4: Cost-Based Selection for Paid Compute

- **Given** agents with different `cost_per_token` values in their capability registration
- **And** task envelope includes `selection_strategy: "lowest-cost"`
- **When** bids are collected
- **Then** selection favors the lowest `cost` bid regardless of load
- **And** this enables future economics layer integration

## Functional Requirements

| ID | Requirement | Priority | Source |
|----|-------------|----------|--------|
| FR-1 | Bid-request published on `tasks.bid-request.{capability}` when envelope has `sovereignty_required: "bidding"` | High | Pattern 2 |
| FR-2 | Bid-request is broadcast (no queue group) so all qualified agents receive it | High | Pattern 2 Step 1 |
| FR-3 | Bid response contains: agent principal, load, capability match quality, optional cost, signature | High | Pattern 2 Step 2 |
| FR-4 | Bid responses are signed with agent's Ed25519 key (FR builds on MY-400 identity) | High | Implementation step 4 |
| FR-5 | Configurable bid collection timeout (default 2000ms, envelope-overridable) | High | Pattern 2 |
| FR-6 | Selection step emits assignment on `tasks.@{winner}.{capability}` (direct-address subject) | High | Pattern 2 Step 4 |
| FR-7 | Selection strategy configurable: `lowest-load` (default), `lowest-cost`, `highest-capability-match` | Medium | Economics prep |
| FR-8 | Dead-letter routing when no bids received within timeout | High | Pattern 4 step 9 |
| FR-9 | Lifecycle events emitted: `bid-opened`, `bid-received`, `bid-closed`, `assigned` | High | Event-driven lifecycle |
| FR-10 | Race-condition contract: winner nak triggers configurable behavior (retry-next / dead-letter) | Medium | Pattern 2 weaknesses |

## Bid Protocol Schema

### Bid Request Envelope Extension

```typescript
interface BidRequest {
  task_id: string;                      // Correlates bids to task
  requirements: string[];               // Capability requirements
  priority: number;                     // Task priority (affects urgency)
  bid_timeout_ms: number;               // Collection window (default 2000)
  selection_strategy?: SelectionStrategy;
  reply_to: string;                     // Inbox for bid responses
}

type SelectionStrategy = "lowest-load" | "lowest-cost" | "highest-match";
```

### Bid Response Schema

```typescript
interface BidResponse {
  task_id: string;
  bidder: string;                       // Principal DID: "did:mf:kai"
  load: number;                         // Current load 0.0-1.0
  capability_match: number;             // Match quality 0.0-1.0
  cost?: number;                        // Optional cost-per-unit
  constraints?: string[];               // Any execution constraints
  signed_by: SignedBy;                  // Ed25519 signature (per MY-400)
}
```

### Assignment Envelope

```typescript
interface TaskAssignment {
  task_id: string;
  winner: string;                       // Principal DID of selected agent
  payload: unknown;                     // Original task payload
  bid_round: {
    participants: number;               // How many agents bid
    selection_reason: string;           // Why this agent won
  };
}
```

## Non-Functional Requirements

| ID | Requirement | Source |
|----|-------------|--------|
| NFR-1 | Bidding round latency < 3s end-to-end (timeout + selection + publish) | Performance budget |
| NFR-2 | Bid collection handles 50+ simultaneous bidders without message loss | Scale target |
| NFR-3 | Signed bids verifiable without network calls (local principal registry) | MY-400 dependency |
| NFR-4 | Bidding does not require JetStream — runs on core NATS request/reply | Transport simplicity |
| NFR-5 | Backwards compatible: tasks without `sovereignty_required: "bidding"` route via standard pull consumer | Migration |

## Subject Namespace Extension

Following `specs/namespace.md` conventions:

```
local.{org}.tasks.bid-request.{capability}       — bid request broadcast
local.{org}.tasks.bid-response._INBOX.>          — bid reply inbox (NATS-generated)
local.{org}.tasks.@{principal}.{capability}      — direct assignment to winner
local.{org}.dispatch.task.bid-opened             — lifecycle: bidding started
local.{org}.dispatch.task.bid-received           — lifecycle: bid collected
local.{org}.dispatch.task.bid-closed             — lifecycle: bidding complete
```

## Success Criteria

**Definition of Done:**

- [ ] Task envelope with `sovereignty_required: "bidding"` triggers bid protocol
- [ ] Bid-request broadcast on correct subject, no queue group
- [ ] Agents can respond with signed bids
- [ ] Configurable timeout with default 2000ms
- [ ] Selection step picks winner based on strategy
- [ ] Assignment published on direct-address subject
- [ ] No-bid timeout routes to dead-letter
- [ ] Lifecycle events emitted for observability
- [ ] Tests: bid round happy path, timeout, race-condition nak

## Scope

### In Scope

- Bid-request broadcast mechanism
- Bid response schema and signing (builds on MY-400)
- Bid collection with configurable timeout
- Selection strategies: lowest-load, lowest-cost, highest-match
- Assignment via direct-address subject
- Lifecycle events for bid protocol
- Dead-letter routing on no-bids
- Race-condition contract (winner nak behavior)

### Explicitly Out of Scope

- Economics/billing integration (just collect cost signals for now)
- Reputation system (future: track win/completion rates)
- Multi-round auctions (single bid window only)
- JetStream persistence for bids (ephemeral request/reply)
- Agent capability negotiation (use registered capabilities)

## Dependencies

| Dependency | Status | Impact |
|------------|--------|--------|
| MY-400 (Layer 4 Identity) | Spec complete | Signed bids require Ed25519 + principal registry |
| Pattern 4 infrastructure | Implemented | KV capability registry, consumer lifecycle |
| Envelope schema | Existing | Extend with `sovereignty_required: "bidding"` |

## Assumptions

- Ed25519 signing from MY-400 is available before this ships
- NATS core request/reply is sufficient (no JetStream required for bid round)
- Selection runs in the publisher (or a designated selection agent), not in the bus
- Agents self-filter on bid requests — don't bid if capability doesn't match
- Bid timeout is publisher-side; agents have no timeout obligation

## Decisions (Resolved 2026-05-09)

- **Min bid count:** 1 bid + timeout window. Single capable agent valid; timeout closes round. Small pools work.
- **Selection strategies:** Hardcoded enum: `lowest-load | lowest-cost | highest-match`. Caller picks via envelope field. Predictable, no plugin surface.
- **Winner-nak retry:** Retry next-best from existing bid pool, max 2 retries before dead-letter. Re-uses fresh bids; avoids full re-bid latency.
- **Bid-request payload:** Requirements + caller-supplied `task_summary` only — no full payload. Full payload delivered only to winner via direct-address subject. Prevents leakage to non-winners.

---
*Batch-generated: 2026-05-09*
*Mode: non-interactive (decomposition requirements)*
