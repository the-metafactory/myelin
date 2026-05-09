# Implementation Tasks: Dead Letter Queue Transport Wrapper

## Progress Tracking

| Task | Status | Notes |
|------|--------|-------|
| T-1.1 | ☐ | |
| T-1.2 | ☐ | |
| T-1.3 | ☐ | |
| T-2.1 | ☐ | |
| T-2.2 | ☐ | |
| T-2.3 | ☐ | |
| T-3.1 | ☐ | |
| T-3.2 | ☐ | |
| T-3.3 | ☐ | |
| T-4.1 | ☐ | |
| T-4.2 | ☐ | |
| T-4.3 | ☐ | |

---

## Group 1: Foundation — Types & Stream Setup

### T-1.1: Define dead-letter types and interfaces [T]
- **File:** `src/transport/dead-letter.ts`
- **Test:** `src/transport/dead-letter.test.ts`
- **Dependencies:** F-022 (NakReason type) — can stub locally if not merged
- **Description:** Create core type definitions:
  - `DeadLetterExtension` interface (original_subject, originating_consumer, delivery_count, nak_chain, final_nak_reason, dead_lettered_at)
  - `DeadLetterEnvelope` interface extending `MyelinEnvelope`
  - `DeadLetterHandlerOptions` interface
  - Type guard `isDeadLetterEnvelope()`
  - Import/stub `NakReason` from F-022

### T-1.2: Implement TASKS_DEAD stream setup [T] [P with T-1.1]
- **File:** `src/transport/nats.ts`
- **Test:** `src/transport/nats.test.ts` (new or extend existing)
- **Dependencies:** none
- **Description:** Add `ensureDeadLetterStream()` method to NATSTransport:
  - Stream name: `TASKS_DEAD`
  - Subjects: `local.*.tasks.dead-letter.>`, `federated.*.tasks.dead-letter.>`
  - Retention: 30 days (vs 7 days on TASKS)
  - Storage: file, R=3 production / R=1 dev
  - Uses existing `ensureStream()` pattern

### T-1.3: Export types from package [P with T-1.1]
- **File:** `src/transport/index.ts`, `src/index.ts`
- **Test:** n/a (verified by build)
- **Dependencies:** T-1.1
- **Description:** Re-export dead-letter types:
  - `DeadLetterExtension`
  - `DeadLetterEnvelope`
  - `DeadLetterHandlerOptions`
  - `isDeadLetterEnvelope`

---

## Group 2: Core Logic — Envelope Creation & Tracking

### T-2.1: Implement dead-letter envelope creation [T]
- **File:** `src/transport/dead-letter.ts`
- **Test:** `src/transport/dead-letter.test.ts`
- **Dependencies:** T-1.1
- **Description:** Create `createDeadLetterEnvelope()` function:
  - Preserves original `correlation_id`
  - Adds `extensions.dead_letter` block with all diagnostic fields
  - Generates new envelope `id` and `timestamp`
  - Copies sovereignty from original

### T-2.2: Implement subject derivation [T] [P with T-2.1]
- **File:** `src/transport/dead-letter.ts`
- **Test:** `src/transport/dead-letter.test.ts`
- **Dependencies:** T-1.1
- **Description:** Create `deriveDeadLetterSubject()` function:
  - Input: `local.acme.tasks.code-review.typescript`
  - Output: `local.acme.tasks.dead-letter.code-review`
  - Extracts capability segment (index 3) from original subject
  - Defensive parsing with validation

### T-2.3: Implement nak chain tracker [T]
- **File:** `src/transport/dead-letter.ts`
- **Test:** `src/transport/dead-letter.test.ts`
- **Dependencies:** T-1.1, F-022 (NakReason type)
- **Description:** Create `NakChainTracker` class:
  - In-memory cache keyed by `${correlation_id}:${consumer_name}`
  - `record(correlationId, consumer, reason)` — appends reason to chain
  - `get(correlationId, consumer)` — returns NakReason[]
  - `evict(correlationId, consumer)` — cleanup on ack/dead-letter
  - Bounded at `maxDeliver` entries per key (default 3)

---

## Group 3: Handler & Routing

### T-3.1: Implement DeadLetterHandler class [T]
- **File:** `src/transport/dead-letter.ts`
- **Test:** `src/transport/dead-letter.test.ts`
- **Dependencies:** T-2.1, T-2.2, T-2.3
- **Description:** Create `DeadLetterHandler` class:
  - Constructor takes `NATSTransport` + `DeadLetterHandlerOptions`
  - `start()` — begins monitoring for dead-letter conditions
  - `stop()` — cleanup
  - Subscribes to `dispatch.task.rejected` lifecycle events (from F-022)
  - Tracks delivery counts per task
  - Routes to dead-letter when:
    1. `compliance-block` reason (immediate fast path)
    2. `delivery_count >= max_deliver` (exhaustion path)

### T-3.2: Implement routeToDeadLetter method [T]
- **File:** `src/transport/dead-letter.ts`
- **Test:** `src/transport/dead-letter.test.ts`
- **Dependencies:** T-3.1
- **Description:** Internal `routeToDeadLetter()` method:
  - Creates dead-letter envelope via `createDeadLetterEnvelope()`
  - Derives subject via `deriveDeadLetterSubject()`
  - Publishes to TASKS_DEAD stream
  - Evicts from NakChainTracker
  - Calls `onDeadLetter` callback if provided

### T-3.3: Emit dispatch.task.failed lifecycle event [T]
- **File:** `src/transport/dead-letter.ts`
- **Test:** `src/transport/dead-letter.test.ts`
- **Dependencies:** T-3.2
- **Description:** On dead-letter routing, emit lifecycle event:
  - Subject: `local.{org}.dispatch.task.failed`
  - Payload: task_id, correlation_id, final_reason, nak_chain, delivery_count, dead_letter_subject, consumer_name, route_trigger
  - Uses EnvelopePublisher from transport

---

## Group 4: Republish Helper & Integration

### T-4.1: Implement republishDeadLetter helper [T]
- **File:** `src/transport/dead-letter.ts`
- **Test:** `src/transport/dead-letter.test.ts`
- **Dependencies:** T-1.1
- **Description:** Create `republishDeadLetter()` function:
  - Strips `extensions.dead_letter` from envelope
  - Generates new `id` and `timestamp`
  - Preserves `correlation_id` (default: true)
  - Publishes to original subject or override
  - Validates input has `dead_letter` extension (throws otherwise)

### T-4.2: Integration tests with real NATS [T]
- **File:** `src/transport/dead-letter.integration.test.ts`
- **Test:** Integration test file (requires NATS test server)
- **Dependencies:** T-3.1, T-3.2, T-3.3, T-4.1
- **Description:** End-to-end tests:
  - Exhaustion path: 3 naks → dead-letter with full nak chain
  - Fast path: `compliance-block` → immediate dead-letter
  - Verify lifecycle event emission
  - Republish round-trip: dead-letter → republish → original subject
  - TASKS_DEAD stream 30-day retention config
  - Use TestEnvelopeTransport where possible, real NATS for stream tests

### T-4.3: Export DeadLetterHandler and helpers
- **File:** `src/transport/index.ts`, `src/index.ts`
- **Test:** n/a (verified by build)
- **Dependencies:** T-3.1, T-4.1
- **Description:** Re-export public API:
  - `DeadLetterHandler`
  - `republishDeadLetter`
  - `deriveDeadLetterSubject` (utility)
  - `createDeadLetterEnvelope` (utility)

---

## Execution Order

```
Phase 1 (Foundation):
  T-1.1 ─┬─ T-1.3
  T-1.2 ─┘

Phase 2 (Core Logic):
  T-2.1 ─┬─ T-2.3
  T-2.2 ─┘

Phase 3 (Handler):
  T-3.1 ─→ T-3.2 ─→ T-3.3

Phase 4 (Integration):
  T-4.1 ─┬─ T-4.3
  T-4.2 ─┘
```

Parallel execution possible within each phase:
- T-1.1 + T-1.2 (no dependencies between)
- T-2.1 + T-2.2 (independent functions)
- T-4.1 + T-4.2 (republish helper vs integration tests)

---

## Dependency Notes

| External Dependency | Status | Mitigation |
|---------------------|--------|------------|
| F-022 (NakReason type) | In progress | Stub `NakReason` locally; replace with import when F-022 merges |
| F-022 (dispatch.task.rejected events) | In progress | Handler can still route on delivery count; full integration after F-022 |
| NATS JetStream 2.10+ | Deployed | Headers API already used in codebase |

---

## Test Coverage Requirements

| Task | Unit Tests | Integration Tests |
|------|------------|-------------------|
| T-1.1 | Type guard, interface shape | — |
| T-1.2 | Stream config validation | Stream creation with NATS |
| T-2.1 | Envelope creation, field preservation | — |
| T-2.2 | Subject parsing edge cases | — |
| T-2.3 | Record/get/evict, bounds checking | — |
| T-3.1 | Handler lifecycle, event subscription | Full routing flow |
| T-3.2 | Envelope routing, subject derivation | — |
| T-3.3 | Event payload shape | Event delivery |
| T-4.1 | Strip extension, preserve fields | Round-trip republish |
| T-4.2 | — | All flows (exhaustion, fast, republish) |

---

## File Summary

| File | Action | Tasks |
|------|--------|-------|
| `src/transport/dead-letter.ts` | CREATE | T-1.1, T-2.1, T-2.2, T-2.3, T-3.1, T-3.2, T-3.3, T-4.1 |
| `src/transport/dead-letter.test.ts` | CREATE | Unit tests for above |
| `src/transport/dead-letter.integration.test.ts` | CREATE | T-4.2 |
| `src/transport/nats.ts` | MODIFY | T-1.2 |
| `src/transport/index.ts` | MODIFY | T-1.3, T-4.3 |
| `src/index.ts` | MODIFY | T-1.3, T-4.3 |
