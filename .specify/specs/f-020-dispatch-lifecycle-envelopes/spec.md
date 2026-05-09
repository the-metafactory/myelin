# Specification: F-020 — Dispatch Lifecycle Envelopes

## Context

> Source: `docs/design-agent-task-routing.md` Implementation step 2
> Tracks: myelin#38
> Related: myelin#31 (chain-of-stamps), myelin#9 (L5 Discovery), myelin#10 (L6 Composition)
> Dependencies: None

## Problem Statement

**Core Problem**: Multiple systems need visibility into task execution but currently lack a unified event stream. When an agent receives, starts, or completes work, there's no standardized way for:

1. **Orchestrators** to track task progress across agents
2. **Operators** to observe Delegate-mode outcomes (the cognitive-load value proposition)
3. **Threshold-review systems** to detect velocity-class harm patterns
4. **Replay/recovery** to reconstruct task state after failures
5. **Chain-of-stamps** to bind audit trails to task execution phases

**Urgency**: Delegate mode's value collapses without lifecycle visibility — handing off an outcome only works if the operator can *see* what's happening. Federation and compliance attestation depend on observable task streams.

**Impact if Unsolved**: Delegate mode is unusable. No audit trail for agent actions. Threshold-review cannot detect slow-motion harm. Recovery after failures requires manual reconstruction.

## Users & Stakeholders

| Consumer | Need | What they observe |
|----------|------|-------------------|
| Orchestrator (cortex M7) | Track task flow, manage retries | All lifecycle events |
| Operator-in-the-loop | Watch Delegate outcomes, intervene on escalation | `progress`, `completed`, `failed`, `aborted` |
| Threshold-review | Count destructive verbs per session | All events, pattern-match against velocity thresholds |
| Dead-letter handler | Surface unclaimable tasks | `failed` with structured nak reasons |
| Replay consumers | Reconstruct state after restart | All events via JetStream replay |

## User Scenarios

### Scenario 1: Delegate Mode Visibility

- **Given** an operator issues a Delegate task ("Pilot, drive PR #32 to merge")
- **When** Pilot claims and begins orchestrating sub-tasks
- **Then** the operator observes `received` → `assigned` → `started` → `progress` (per sub-step) → `completed` or `failed` on `local.{org}.dispatch.task.>` with shared `correlation_id`

### Scenario 2: Threshold-Review Detection

- **Given** an agent is executing many small write operations
- **When** the cumulative count crosses configured thresholds
- **Then** threshold-review consumes the `progress` stream and triggers human sign-off before next destructive action

### Scenario 3: Recovery After Failure

- **Given** a Delegate task was mid-flight when the orchestrator crashed
- **When** the orchestrator restarts
- **Then** it replays lifecycle events from JetStream (durable consumer from last ack position) and reconstructs in-progress task state

### Scenario 4: Nak Routing to Dead-Letter

- **Given** a task is rejected by all capable agents with `compliance-block` reason
- **When** max_deliver is exhausted
- **Then** the dead-letter handler receives the task with accumulated nak reasons and surfaces for human review

## Requirements

### Functional Requirements

| ID | Requirement | Priority | Source |
|----|-------------|----------|--------|
| FR-1 | Define lifecycle event subjects: `local.{org}.dispatch.task.{received,assigned,started,progress,completed,failed,aborted}` | High | design-agent-task-routing.md §Event-driven lifecycle |
| FR-2 | All lifecycle envelopes share a `correlation_id` invariant — same value across all events for a single task | High | design doc: "reconstruct the timeline" |
| FR-3 | Define per-state envelope schema (fields appropriate to each lifecycle state) | High | design doc requirement |
| FR-4 | Broadcast/Direct modes emit subset: `received`, `assigned`, `completed`, `failed` | Medium | design doc: "strict subset" |
| FR-5 | Delegate mode emits full lifecycle including `started`, `progress`, `aborted` | High | design doc: Delegate mode distinction |
| FR-6 | `completed` envelope includes optional economics fields: `input_tokens`, `output_tokens` | Medium | design doc Decision Q4 |
| FR-7 | JetStream-backed on `events.>` stream for durability and replay | High | design-cortex.md §3.3 reference |
| FR-8 | Implement structured nak reasons: `cant-do`, `wont-do`, `not-now`, `compliance-block` | High | design doc §Event-driven lifecycle |
| FR-9 | `failed` envelope includes nak reason and optional error details | High | observability requirement |
| FR-10 | Idempotency: consumers can replay events safely (state derived from stream position) | High | design doc: "recoverable hot-path subscribers" |

### Non-Functional Requirements

| ID | Requirement | Source |
|----|-------------|--------|
| NFR-1 | Event publish latency < 5ms (fire-and-forget to JetStream) | Performance: must not block task execution |
| NFR-2 | Events retained 7 days minimum (configurable) | Recovery window per design doc |
| NFR-3 | Consumer lag observable via NATS metrics | Built-in JetStream |
| NFR-4 | Works with existing `MyelinEnvelope` schema (extends, not replaces) | Backwards compatibility |

## Lifecycle Envelope Schemas

### Common Fields (all lifecycle events)

```typescript
interface DispatchLifecycleEnvelope extends MyelinEnvelope {
  type: `dispatch.task.${LifecycleState}`;
  payload: {
    correlation_id: string;       // UUID — invariant across all events for this task
    task_id: string;              // Original task identifier
    distribution_mode: "broadcast" | "direct" | "delegate";
    principal?: string;           // DID of acting agent (when assigned)
    timestamp: string;            // ISO-8601
    // ... state-specific fields
  };
}

type LifecycleState = 
  | "received"    // Task entered the system
  | "assigned"    // Agent claimed the task
  | "started"     // Agent began execution
  | "progress"    // Mid-flight update (Delegate only)
  | "completed"   // Terminal: success
  | "failed"      // Terminal: failure
  | "aborted";    // Terminal: operator interrupt or timeout
```

### State-Specific Payloads

```typescript
// received — task entered routing
interface ReceivedPayload {
  correlation_id: string;
  task_id: string;
  distribution_mode: "broadcast" | "direct" | "delegate";
  requirements: string[];         // Capability tags required
  target_principal?: string;      // For Direct/Delegate: specific agent DID
  deadline?: string;              // ISO-8601 optional deadline
}

// assigned — agent claimed
interface AssignedPayload {
  correlation_id: string;
  task_id: string;
  distribution_mode: "broadcast" | "direct" | "delegate";
  principal: string;              // DID of claiming agent
  claimed_at: string;
}

// started — execution began (Delegate mode)
interface StartedPayload {
  correlation_id: string;
  task_id: string;
  principal: string;
}

// progress — mid-flight (Delegate mode)
interface ProgressPayload {
  correlation_id: string;
  task_id: string;
  principal: string;
  message: string;                // Human-readable progress
  step?: number;                  // Optional: current step
  total_steps?: number;           // Optional: total steps
  sub_correlation_id?: string;    // When fanning out sub-tasks
}

// completed — terminal success
interface CompletedPayload {
  correlation_id: string;
  task_id: string;
  principal: string;
  result?: unknown;               // Task-specific result
  // Economics (optional per Decision Q4)
  input_tokens?: number;
  output_tokens?: number;
  duration_ms?: number;
}

// failed — terminal failure
interface FailedPayload {
  correlation_id: string;
  task_id: string;
  principal?: string;             // May be unassigned at failure
  nak_reason?: "cant-do" | "wont-do" | "not-now" | "compliance-block";
  error?: string;                 // Human-readable error
  error_code?: string;            // Machine-parseable error code
  retries_exhausted?: boolean;    // True if max_deliver reached
}

// aborted — terminal interrupt
interface AbortedPayload {
  correlation_id: string;
  task_id: string;
  principal?: string;
  reason: "operator-interrupt" | "timeout" | "dependency-failed";
  aborted_by?: string;            // DID of aborting principal (if operator)
}
```

## Subject Mapping

Following `specs/namespace.md` conventions:

| Event | Subject | JetStream |
|-------|---------|-----------|
| received | `local.{org}.dispatch.task.received` | `EVENTS` stream |
| assigned | `local.{org}.dispatch.task.assigned` | `EVENTS` stream |
| started | `local.{org}.dispatch.task.started` | `EVENTS` stream |
| progress | `local.{org}.dispatch.task.progress` | `EVENTS` stream |
| completed | `local.{org}.dispatch.task.completed` | `EVENTS` stream |
| failed | `local.{org}.dispatch.task.failed` | `EVENTS` stream |
| aborted | `local.{org}.dispatch.task.aborted` | `EVENTS` stream |

All subjects match filter `local.{org}.dispatch.task.>` for lifecycle consumers.

## Emission Rules by Distribution Mode

| State | Broadcast | Direct | Delegate |
|-------|-----------|--------|----------|
| received | Yes | Yes | Yes |
| assigned | Yes | Yes | Yes |
| started | No | No | Yes |
| progress | No | No | Yes |
| completed | Yes | Yes | Yes |
| failed | Yes | Yes | Yes |
| aborted | No | No | Yes |

## Idempotency & Replay Semantics

1. **Event sourcing model**: Task state derived from event stream position, not stored separately
2. **Consumer checkpoint**: JetStream durable consumers track last-ack; replay from checkpoint on restart
3. **correlation_id invariant**: All events for a task share the same correlation_id — no duplicates with same (correlation_id, state, timestamp)
4. **At-least-once delivery**: Consumers must handle duplicate events gracefully (idempotent handlers)

## Worked Example: Pilot Review Loop

Per `design-event-taxonomy.md` §6 (Cortex repo):

```
1. Operator: "Pilot, drive PR #32 to merge"
   → local.metafactory.dispatch.task.received
     { correlation_id: "abc-123", task_id: "pilot-pr-32", 
       distribution_mode: "delegate", target_principal: "did:mf:pilot" }

2. Pilot claims
   → local.metafactory.dispatch.task.assigned
     { correlation_id: "abc-123", principal: "did:mf:pilot" }

3. Pilot starts
   → local.metafactory.dispatch.task.started
     { correlation_id: "abc-123", principal: "did:mf:pilot" }

4. Pilot fans out to Echo for review
   → local.metafactory.dispatch.task.progress
     { correlation_id: "abc-123", principal: "did:mf:pilot",
       message: "Requesting review from Echo", sub_correlation_id: "echo-review-1" }

5. Echo completes review (separate lifecycle with sub_correlation_id)
   ...

6. Pilot pushes fix, requests re-review
   → local.metafactory.dispatch.task.progress
     { correlation_id: "abc-123", message: "Pushed fix, awaiting re-review" }

7. PR approved, Pilot merges
   → local.metafactory.dispatch.task.completed
     { correlation_id: "abc-123", principal: "did:mf:pilot",
       input_tokens: 15420, output_tokens: 8200, duration_ms: 324000 }
```

## Success Criteria

**Definition of Done:**

1. [ ] Lifecycle envelope types exported from `@the-metafactory/myelin`
2. [ ] `correlation_id` generator utility (UUID-based)
3. [ ] `emitLifecycleEvent(state, payload)` function — publishes to correct subject
4. [ ] JetStream `EVENTS` stream configuration includes `local.*.dispatch.task.>` filter
5. [ ] Nak reason enum exported with `cant-do | wont-do | not-now | compliance-block`
6. [ ] Tests: emit→consume round-trip, replay from checkpoint, correlation_id invariant
7. [ ] Integration with chain-of-stamps (myelin#31) — lifecycle events carry stamps

## Scope

### In Scope

- Lifecycle event envelope schemas (7 states)
- Subject naming convention for dispatch events
- Correlation_id invariant specification
- Emission rules per distribution mode
- Nak reason vocabulary
- Economics fields on completed
- JetStream backing requirement
- Idempotency semantics

### Explicitly Out of Scope

- JetStream stream configuration (covered in myelin#38 infrastructure)
- Threshold-review implementation (M7 consumer, not protocol)
- Surface routing (which UI sees which event) — M7 cortex concern
- Chain-of-stamps accumulation logic (myelin#31)
- Dead-letter handler implementation (separate feature)

## Assumptions

- JetStream `EVENTS` stream exists or will be created per cortex architecture §3.3
- Envelope extends existing `MyelinEnvelope` schema without breaking changes
- `correlation_id` is caller-generated (orchestrator responsibility)
- Economics fields are optional — agents may omit if token counting unavailable

## Decisions (Resolved 2026-05-09)

- **Progress severity:** `severity: info | warn | escalate` field on `progress` envelopes. Threshold-review filters on `warn+`; surface-router can paging-route on `escalate`.
- **Retention:** 7 days, matches TASKS stream. Symmetric task↔lifecycle replay window. Operator-configurable in `cortex.yaml`.
- **`sub_correlation_id`:** Formal parent-child link, both `correlation_id` and `sub_correlation_id` part of signed envelope coverage. Chain-of-stamps (#31) accumulates per hop. Audit graph reconstructible from stream.
- **Economics on `completed`:** Optional fields per Decision Q4 — lightweight instrumentation now, no cost-based routing yet. Agents without token counting omit; future cost-routing reads when present.

---
*Generated: 2026-05-09 | Mode: batch (non-interactive)*
*Source: design-agent-task-routing.md Implementation step 2*
