# Specification: Structured Nak Reasons

## Context

> Generated from batch specification mode on 2026-05-09
> Tracks: myelin#40 | Parent: Implementation step 7 of docs/design-agent-task-routing.md
> Related: F-4 (dead-letter routing), myelin#9 (L5 Discovery)

## Problem Statement

**Core Problem**: Unstructured nak calls provide no actionable signal. When an agent rejects a task, consumers (dead-letter handler, retry logic, orchestrator) cannot differentiate between:
- A permanent capability mismatch (never retry against this agent)
- A policy refusal (agent capable but declining)
- A temporary load condition (retry soon)
- A compliance violation (route to dead-letter immediately)

Today's `msg.nak()` in `src/transport/nats.ts` just calls NATS nak without any reason. All naks look identical to downstream consumers.

**Urgency**: Other features are blocked:
- Dead-letter routing (F-4) needs `compliance-block` to trigger immediate dead-letter
- Orchestrator retry policy needs `not-now` vs `cant-do` discrimination
- Threshold-review observability needs reason telemetry

**Impact if Unsolved**: Inefficient retry storms, compliance violations silently retried, load-shedding indistinguishable from capability mismatch.

## Users & Stakeholders

| Consumer | Need |
|----------|------|
| Dead-letter handler | Route `compliance-block` immediately; accumulate `cant-do`/`wont-do` after max_deliver |
| Orchestrator retry logic | Bounce `not-now` to peer immediately; don't waste retries |
| Threshold-review | Count reason types for velocity-class harm detection |
| Agent developers | Signal why rejection occurred for debugging |

## User Scenarios

### Scenario 1: Agent lacks required capability

- **Given** Luna receives a task requiring `deploy.cloudflare` capability
- **When** Luna evaluates the task and lacks this capability
- **Then** Luna naks with reason `cant-do`
- **And** JetStream redelivers to next agent in consumer group
- **And** after max_deliver exhausted, task routes to dead-letter

### Scenario 2: Agent refuses for policy reasons

- **Given** Echo receives a code-review task for a repository it has been configured to avoid
- **When** Echo evaluates the task and sovereignty rules decline
- **Then** Echo naks with reason `wont-do`
- **And** JetStream redelivers to next agent
- **And** after max_deliver exhausted, task routes to dead-letter

### Scenario 3: Agent at capacity

- **Given** Forge receives a release task while already processing maxConcurrent tasks
- **When** Forge evaluates its load
- **Then** Forge naks with reason `not-now`
- **And** JetStream immediately redelivers to another agent in the consumer group
- **And** no max_deliver count incremented (load-shed, not failure)

### Scenario 4: Compliance violation detected

- **Given** Kai receives a task that would require egress to a blocked domain
- **When** Kai evaluates M7 attestation constraints
- **Then** Kai naks with reason `compliance-block`
- **And** task routes immediately to dead-letter (no retry)
- **And** escalation event emitted for operator review

## Functional Requirements

| ID | Requirement | Priority | Source |
|----|-------------|----------|--------|
| FR-1 | Define `NakReason` enum: `cant-do`, `wont-do`, `not-now`, `compliance-block` | High | design-agent-task-routing.md §Event-driven lifecycle |
| FR-2 | Extend NATS nak to carry reason code in message header `Myelin-Nak-Reason` | High | Wire format |
| FR-3 | Agent-side `nakWithReason(msg, reason, description?)` helper function | High | Developer ergonomics |
| FR-4 | Consumer routing: `compliance-block` → immediate dead-letter | High | F-4 integration |
| FR-5 | Consumer routing: `not-now` → immediate redeliver without incrementing delivery count | High | Load-shedding behavior |
| FR-6 | Consumer routing: `cant-do`/`wont-do` → standard retry up to max_deliver | High | Default behavior |
| FR-7 | Emit reason to lifecycle event stream (`dispatch.task.rejected`) | Medium | Observability |
| FR-8 | Optional `description` field for human-readable context | Low | Debugging |
| FR-9 | Export `NakReason` type from `@the-metafactory/myelin` package | High | API surface |

## Non-Functional Requirements

| ID | Requirement | Source |
|----|-------------|--------|
| NFR-1 | Nak overhead < 100μs (header serialization) | Performance |
| NFR-2 | Backwards-compatible: existing nak() calls without reason continue working (treated as `cant-do`) | Migration |
| NFR-3 | No external dependencies beyond existing NATS client | Constraints |
| NFR-4 | Reason codes are exhaustive enum — no string free-form | Type safety |

## Technical Design

### NakReason Type

```typescript
export type NakReason = 
  | 'cant-do'          // Static capability mismatch
  | 'wont-do'          // Sovereignty/policy refusal
  | 'not-now'          // Load/availability
  | 'compliance-block' // M7 attestation violation
;
```

### Wire Format

NATS JetStream messages support custom headers. The reason is transmitted via:

```
Header: Myelin-Nak-Reason: <reason>
Header: Myelin-Nak-Description: <optional description>
```

When nak is called:
1. Set headers on the JsMsg
2. Call `msg.nak()` with appropriate delay based on reason

### Consumer Routing Logic

```
┌─────────────────────────────────────────────────────────────┐
│                      nak received                           │
└───────────────────────────┬─────────────────────────────────┘
                            │
            ┌───────────────┴───────────────┐
            │     extract Myelin-Nak-Reason │
            └───────────────┬───────────────┘
                            │
     ┌──────────┬───────────┼───────────┬──────────┐
     ▼          ▼           ▼           ▼          ▼
compliance   not-now    cant-do    wont-do    (missing)
   -block                                     
     │          │           │           │          │
     ▼          ▼           └─────┬─────┘          ▼
  immediate  immediate          │             treat as
  dead-letter redeliver         │             cant-do
     │       (no count          ▼                  │
     │        increment)    redeliver              │
     │          │           (increment             │
     │          │            count)                │
     │          │               │                  │
     │          └───────────────┴──────────────────┘
     │                          │
     │                          ▼
     │                  count >= max_deliver?
     │                    yes │    │ no
     │                        ▼    └──→ next agent
     │                   dead-letter
     │                        │
     └────────────────────────┴──→ tasks.dead-letter.{capability}
```

### Agent-Side API

```typescript
interface NakOptions {
  reason: NakReason;
  description?: string;
}

function nakWithReason(msg: JsMsg, options: NakOptions): void;

// Usage in agent handler:
if (!canHandle(task)) {
  nakWithReason(msg, { reason: 'cant-do', description: 'Missing tool: kubectl' });
  return;
}

if (currentLoad >= maxConcurrent) {
  nakWithReason(msg, { reason: 'not-now', description: `Load ${currentLoad}/${maxConcurrent}` });
  return;
}
```

### Lifecycle Event

When a task is nak'd, emit to `local.{org}.dispatch.task.rejected`:

```typescript
interface TaskRejectedEvent {
  task_id: string;
  correlation_id: string;
  agent_principal: string;
  reason: NakReason;
  description?: string;
  timestamp: string;
  delivery_count: number;
}
```

## Success Criteria

- [ ] `NakReason` type exported from `@the-metafactory/myelin`
- [ ] `nakWithReason(msg, options)` function implemented in transport layer
- [ ] NATS headers `Myelin-Nak-Reason` and `Myelin-Nak-Description` documented
- [ ] Test: `compliance-block` routes to dead-letter immediately
- [ ] Test: `not-now` redelivers without incrementing delivery count
- [ ] Test: `cant-do`/`wont-do` increment delivery count and dead-letter after max_deliver
- [ ] Test: missing reason header treated as `cant-do`
- [ ] Integration: F-4 dead-letter handler reads and logs reason
- [ ] Test: lifecycle event `dispatch.task.rejected` emitted with reason

## Scope

### In Scope
- `NakReason` enum definition
- Wire format (NATS headers)
- `nakWithReason()` helper function
- Consumer routing logic per reason
- Lifecycle event emission
- TypeScript tests for each routing path

### Out of Scope
- Dead-letter stream/consumer setup (F-4 handles this)
- Orchestrator retry policy configuration (M7 concern)
- Threshold-review consumption of events (separate feature)
- UI for viewing nak reasons (operational tooling)

## Decisions (Resolved 2026-05-09)

- **`not-now` redeliver:** Exponential backoff via `nak(delay)`. Initial 1s, doubles per nak, capped at 60s. Avoids tight loops under whole-pool overload.
- **`not-now` accounting:** Does NOT count toward `max_deliver`. Only `cant-do`, `wont-do`, `compliance-block` count. Reasoning: `not-now` is transient — load lifts, redelivery succeeds. Dead-lettering on transient overload is wrong signal.
- **`wont-do` retry:** Same as `cant-do` — bounce until `max_deliver`, then dead-letter. Heterogeneous-policy agents may legitimately accept what others refuse; skipping retries loses valid matches.

## Assumptions

- JetStream message headers are preserved across redelivery (verified: NATS 2.10+)
- Consumer-side logic can read headers before ack/nak decision (for routing)
- F-4 dead-letter stream and consumer will be implemented (parallel/dependent feature)
- Agents have access to their M7 deployment policy (cortex.yaml) for sovereignty evaluation

## Dependencies

| Dependency | Status | Impact |
|------------|--------|--------|
| F-4 Dead-letter routing | Planned | Required for `compliance-block` path; can stub initially |
| MyelinEnvelope signed_by (MY-400) | In progress | Optional: reason events should include verified principal |
| NATS JetStream 2.10+ | Deployed | Headers API required |

---
*Batch-generated: 2026-05-09*
*Source: docs/design-agent-task-routing.md Implementation step 7*
