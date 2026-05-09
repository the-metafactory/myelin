# Specification: Dead Letter Queue Transport Wrapper

## Overview

Transport-layer dead letter routing for capability-routed tasks. When tasks exhaust retries or hit compliance blocks, they route to a dead-letter subject for operator review/escalation instead of silently disappearing. Subject pattern: `local.{org}.tasks.dead-letter.{capability}`.

Two entry paths:
1. **Exhaustion path**: `max_deliver` reached — task bounced through all available agents without success
2. **Fast path**: `compliance-block` nak — immediate dead-letter (no retry against same policy)

Pairs with F-022 (structured nak reasons) which defines the nak reason codes this feature consumes.

## User Scenarios

### Scenario 1: Task exhausts max_deliver retries

- **Given** a task published to `local.acme.tasks.code-review.typescript`
- **And** consumer configured with `max_deliver: 3`
- **When** three agents nak the task (reasons: `cant-do`, `not-now`, `cant-do`)
- **Then** task routes to `local.acme.tasks.dead-letter.code-review`
- **And** dead-letter envelope includes original envelope, nak reason chain, delivery count, originating consumer

### Scenario 2: Compliance block triggers fast path

- **Given** a task requiring security-sensitive capabilities
- **And** agent evaluates task against M7 attestation policy
- **When** agent naks with `compliance-block` (e.g., tool not on Approved Register)
- **Then** task immediately routes to `local.acme.tasks.dead-letter.security-scan`
- **And** no retry attempts against other agents in same consumer group

### Scenario 3: Dead letter queue monitoring

- **Given** an operator subscribed to `local.acme.tasks.dead-letter.>`
- **When** unclaimable tasks accumulate
- **Then** operator sees clear diagnostic: which tasks failed, why (nak chain), how many attempts
- **And** can manually re-publish after fixing root cause

### Scenario 4: Mixed nak reasons before exhaustion

- **Given** a task delivered to three agents
- **When** agent 1 naks `not-now` (at capacity), agent 2 naks `wont-do` (policy refusal), agent 3 naks `cant-do` (missing capability)
- **Then** dead-letter envelope contains full nak chain: `["not-now", "wont-do", "cant-do"]`
- **And** operator can diagnose whether issue is capacity vs capability vs policy

## Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1 | Route tasks to `local.{org}.tasks.dead-letter.{capability}` when `max_deliver` exhausted | High |
| FR-2 | Route `compliance-block` naks immediately to dead-letter (skip remaining retries) | High |
| FR-3 | Dead-letter envelope includes: original envelope, nak reason chain array, delivery count, originating consumer name | High |
| FR-4 | Preserve original `correlation_id` for tracing through dead-letter | High |
| FR-5 | Dead-letter subject derived from original task subject's capability segment | Medium |
| FR-6 | Emit `dispatch.task.failed` lifecycle event when routing to dead-letter | Medium |
| FR-7 | Separate `TASKS_DEAD` JetStream stream, 30-day retention (vs 7d on TASKS); subject filter `local.*.tasks.dead-letter.>` | High |
| FR-8 | Ship `republishDeadLetter(envelope)` helper that strips `extensions.dead_letter` and re-emits to original capability subject | Medium |
| FR-9 | Nak chain capture bounded at `max_deliver` (default 3) | Low |

## Non-Functional Requirements

| ID | Requirement | Metric |
|----|-------------|--------|
| NFR-1 | Dead-letter routing must not block consumer processing | < 10ms additional latency |
| NFR-2 | Dead-letter stream retains longer than TASKS stream | 30 days vs 7 days default |
| NFR-3 | Dead-letter envelope size overhead | < 1KB additional metadata |

## Technical Context

### Subject Convention

Per `docs/design-agent-task-routing.md` §Namespace extension:
```
local.{org}.tasks.{capability}.{subcapability}   — task routing
local.{org}.tasks.dead-letter.{capability}        — unclaimable tasks
```

### Nak Reason Codes (from F-022)

| Reason | Dead-letter behavior |
|--------|---------------------|
| `cant-do` | Normal retry until exhaustion |
| `wont-do` | Normal retry until exhaustion |
| `not-now` | Normal retry until exhaustion |
| `compliance-block` | **Fast path**: immediate dead-letter |

### Dead-Letter Envelope Extension

```typescript
interface DeadLetterEnvelope extends MyelinEnvelope {
  extensions: {
    dead_letter: {
      original_subject: string;
      originating_consumer: string;
      delivery_count: number;
      nak_chain: NakReason[];  // from F-022
      final_nak_reason: NakReason;
      dead_lettered_at: string; // ISO timestamp
    };
  };
}
```

### Integration Points

- **F-022 (Structured Nak Reasons)**: Provides nak reason type discriminators
- **F-019 (TASKS Stream)**: Dead-letter handler subscribes to main TASKS consumer
- **F-020 (Dispatch Lifecycle)**: Emits `dispatch.task.failed` on dead-letter

## Success Criteria

- [ ] Tasks reaching `max_deliver` appear on dead-letter subject within 100ms
- [ ] `compliance-block` nak skips retries — dead-letter on first occurrence
- [ ] Dead-letter envelope contains all diagnostic fields (nak chain, counts, consumer)
- [ ] Existing TASKS stream consumers unaffected (no breaking changes)
- [ ] Integration test: `compliance-block` surfaces in dead-letter on first attempt
- [ ] Dead-letter stream queryable via standard JetStream consumer

## Assumptions

1. F-022 (structured nak reasons) lands first or concurrently — nak reason types available
2. TASKS stream already configured per F-019
3. Agents implement structured nak (not bare `msg.nak()`)
4. Dead-letter is write-only from transport perspective — re-publish is operator concern

## Implementation Notes

Reference implementation target: `src/transport/dead-letter.ts`

Design source: `docs/design-agent-task-routing.md` Implementation step 9, GH #41
