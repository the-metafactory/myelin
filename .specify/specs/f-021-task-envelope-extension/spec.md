# Specification: F-021 — Task Envelope Extension

## Context

> Generated from batch specification mode on 2026-05-09
> Source: docs/design-agent-task-routing.md Implementation step 6
> Tracks: GH #39 | Cross-ref: MY-100
> Related: myelin#9 (L5 Discovery), myelin#31 (chain-of-stamps), design-agent-task-routing.md

## Problem Statement

**Core Problem**: Task routing requires capability-based matching, but the current MyelinEnvelope lacks fields to express task requirements or distribution semantics. Publishers cannot specify:

1. **Capability requirements** — what capabilities an agent needs to claim this task
2. **Sovereignty mode** — how strictly agents should evaluate before accepting
3. **Distribution mode** — whether the task is open-market (Broadcast), targeted (Direct), or outcome-delegated (Delegate)
4. **Deadline** — when the task must be completed by
5. **Target principal** — which agent should receive Direct/Delegate tasks

Without these fields, the Pattern 4 (JetStream + Capability Registry) task routing cannot function. Capability matching falls back to subject-hierarchy-only, which is insufficient for rich capability taxonomies.

**Urgency**: Other routing infrastructure (consumer lifecycle manager, sovereignty evaluation, nak handling) is blocked until the envelope schema defines what fields exist to route on.

**Impact if Unsolved**: Task routing degrades to Pattern 1 (subject-based only). No sovereignty enforcement. No deadline handling. No Direct/Delegate distinction at the wire level.

## Users & Stakeholders

| Consumer | Need | Example |
|----------|------|---------|
| Task publishers | Express requirements in envelope | Pilot publishes code-review task requiring `typescript` + `security-scan` |
| Consumer lifecycle manager | Create filtered consumers from requirements | Manager watches tasks.code-review.>, creates consumer for agents with matching caps |
| Agent task evaluator | Check requirements against own capabilities before ack/nak | Luna receives task, checks requirements array against registered caps |
| Orchestrator (M7) | Route Direct/Delegate based on distribution_mode + target_principal | Cortex dispatch handler sees `delegate` + `did:mf:pilot` → routes to Pilot |
| Dead-letter handler | Know why tasks are unroutable | Task with unsatisfiable requirements → dead-letter with diagnostic |

## Current State

**Existing Envelope Fields (src/types.ts):**
```typescript
interface MyelinEnvelope {
  id: string;
  source: string;
  type: string;
  timestamp: string;
  correlation_id?: string;
  sovereignty: Sovereignty;  // classification, data_residency, max_hop, frontier_ok, model_class
  signed_by?: SignedBy;
  economics?: Record<string, unknown>;
  extensions?: Record<string, unknown>;
  payload: Record<string, unknown>;
}
```

**Gap**: No task-specific routing fields. The `extensions` field exists but is untyped — task routing needs first-class schema support for validation and tooling.

**Integration Points:**
- `AGENT_CAPABILITIES` KV bucket (myelin#9) — capability tags must align with registry vocabulary
- Consumer lifecycle manager — reads requirements to create filtered consumers
- `verifyEnvelopeIdentity()` — signed_by verification happens before task routing
- chain-of-stamps (myelin#31) — correlation_id links Delegate sub-tasks

## User Scenarios

### Scenario 1: Broadcast Task with Capability Requirements

- **Given** a publisher needs code review for a TypeScript file with security considerations
- **When** they publish a task envelope with `requirements: ["code-review", "typescript", "security-scan"]` and `distribution_mode: "broadcast"`
- **Then** the envelope validates successfully
- **And** only agents registered with all three capabilities in AGENT_CAPABILITIES can claim it
- **And** agents missing any capability nak with `cant-do`

### Scenario 2: Direct Task to Specific Agent

- **Given** an operator wants Forge specifically to cut a release
- **When** they publish with `distribution_mode: "direct"` and `target_principal: "did:mf:forge"`
- **Then** the task routes to subject `tasks.@forge.release` (named-subject convention)
- **And** only Forge receives delivery
- **And** other agents on the same capability consumer do not see it

### Scenario 3: Delegate Task with Outcome Commitment

- **Given** an operator hands off "drive PR #32 to merge" to Pilot
- **When** they publish with `distribution_mode: "delegate"`, `target_principal: "did:mf:pilot"`, and `deadline: "2026-05-10T18:00:00Z"`
- **Then** Pilot claims the task and internally orchestrates (Echo for review, Forge for release)
- **And** sub-tasks share the parent `correlation_id` for chain-of-stamps audit
- **And** lifecycle events emit on `local.{org}.dispatch.task.*`

### Scenario 4: Strict Sovereignty Enforcement

- **Given** a high-trust security scan task
- **When** published with `sovereignty_required: "strict"` and `requirements: ["pentest", "security-scan"]`
- **Then** only agents with `sovereignty: "strict"` in their AGENT_CAPABILITIES registration can claim
- **And** agents with `sovereignty: "selective"` or `"open"` nak with `wont-do`

### Scenario 5: Backwards Compatibility

- **Given** an existing envelope without task routing fields
- **When** received by the task routing layer
- **Then** it validates successfully (fields are optional)
- **And** defaults apply: `distribution_mode: "broadcast"`, no capability filtering, no deadline

## Requirements

### Functional Requirements

| ID | Requirement | Priority | Source |
|----|-------------|----------|--------|
| FR-1 | Add `requirements: string[]` field to MyelinEnvelope — capability tags from AGENT_CAPABILITIES vocabulary | High | design-agent-task-routing.md §6 |
| FR-2 | Add `sovereignty_required: "open" \| "selective" \| "strict"` field — minimum sovereignty mode for claiming agents | High | design-agent-task-routing.md §Sovereignty Modes |
| FR-3 | Add `deadline: string` field — ISO-8601 timestamp for task completion | High | design-agent-task-routing.md §6 |
| FR-4 | Add `distribution_mode: "broadcast" \| "direct" \| "delegate"` field — routing semantics | High | design-agent-task-routing.md §Distribution modes |
| FR-5 | Add `target_principal?: string` field — DID of target agent for Direct/Delegate modes | High | design-agent-task-routing.md §Direct-address |
| FR-6 | All new fields are optional for backwards compatibility | High | Migration reality |
| FR-7 | Defaults when fields missing: `distribution_mode: "broadcast"`, `sovereignty_required: "open"`, no requirements filter | High | design-agent-task-routing.md §6 |
| FR-8 | Validate `requirements` entries are non-empty strings matching capability tag pattern | Medium | Schema hygiene |
| FR-9 | Validate `target_principal` is a valid DID when present | Medium | Consistency with signed_by |
| FR-10 | Validate `deadline` is ISO-8601 when present | Medium | Schema hygiene |
| FR-11 | Validate `target_principal` is present when `distribution_mode` is "direct" or "delegate" | Medium | Semantic consistency |
| FR-12 | Use JCS (RFC 8785) for canonical field inclusion in signed envelopes | Medium | MY-400 alignment |
| FR-13 | Document which fields are included in envelope signing (for chain-of-stamps) | Medium | myelin#31 dependency |

### Non-Functional Requirements

| ID | Requirement | Source |
|----|-------------|--------|
| NFR-1 | No breaking changes to existing envelope consumers — all fields optional | Migration reality |
| NFR-2 | Validation overhead < 100μs per envelope (simple pattern matching) | Performance budget |
| NFR-3 | Requirements array bounded: max 10 capability tags per task | DoS prevention |
| NFR-4 | TypeScript types exported from `@the-metafactory/myelin` | API contract |

## Schema Extension

### TaskRouting Fields (Envelope Extension)

```typescript
/** Task routing fields — L3 envelope extension for capability-routed tasks */
interface TaskRoutingFields {
  /** Capability tags required to claim this task. Matched against AGENT_CAPABILITIES registry. */
  requirements?: string[];

  /** Minimum sovereignty mode an agent must have to claim this task. */
  sovereignty_required?: 'open' | 'selective' | 'strict';

  /** ISO-8601 deadline for task completion. */
  deadline?: string;

  /** Distribution semantics: broadcast (open market), direct (named recipient), delegate (outcome commitment). */
  distribution_mode?: 'broadcast' | 'direct' | 'delegate';

  /** Target agent DID for direct/delegate modes. Required when distribution_mode is not broadcast. */
  target_principal?: string;
}

// Extended MyelinEnvelope (backwards-compatible)
interface MyelinEnvelope {
  // ... existing fields ...
  
  // Task routing (all optional)
  requirements?: string[];
  sovereignty_required?: 'open' | 'selective' | 'strict';
  deadline?: string;
  distribution_mode?: 'broadcast' | 'direct' | 'delegate';
  target_principal?: string;
}
```

### Capability Tag Pattern

```
/^[a-z][a-z0-9-]*$/
```

Examples: `code-review`, `typescript`, `security-scan`, `deploy`, `release`, `pentest`

### Validation Rules

1. `requirements`: array of strings, each matching capability tag pattern, max 10 elements
2. `sovereignty_required`: enum value when present
3. `deadline`: ISO-8601 datetime string when present
4. `distribution_mode`: enum value when present
5. `target_principal`: valid DID (`did:mf:<name>`) when present
6. Cross-field: if `distribution_mode` is `direct` or `delegate`, `target_principal` must be present

### JCS Canonical Inclusion

For signed envelopes (chain-of-stamps), task routing fields are included in signature:
- `requirements` (array sorted lexicographically)
- `sovereignty_required`
- `deadline`
- `distribution_mode`
- `target_principal`

Omitted fields (undefined) are not included per JCS rules.

## Per-Mode Example Envelopes

### Broadcast Mode

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "source": "metafactory.cortex.operator",
  "type": "task.code-review",
  "timestamp": "2026-05-09T14:30:00Z",
  "correlation_id": "660e8400-e29b-41d4-a716-446655440001",
  "sovereignty": {
    "classification": "local",
    "data_residency": "CH",
    "max_hop": 0,
    "frontier_ok": true,
    "model_class": "any"
  },
  "requirements": ["code-review", "typescript"],
  "sovereignty_required": "selective",
  "deadline": "2026-05-09T18:00:00Z",
  "distribution_mode": "broadcast",
  "payload": {
    "pr_url": "https://github.com/the-metafactory/myelin/pull/42",
    "files_changed": 3
  }
}
```

### Direct Mode

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440002",
  "source": "metafactory.cortex.operator",
  "type": "task.release",
  "timestamp": "2026-05-09T14:35:00Z",
  "sovereignty": {
    "classification": "local",
    "data_residency": "CH",
    "max_hop": 0,
    "frontier_ok": false,
    "model_class": "local-only"
  },
  "requirements": ["release", "npm-publish"],
  "distribution_mode": "direct",
  "target_principal": "did:mf:forge",
  "payload": {
    "package": "@the-metafactory/myelin",
    "version": "0.8.0"
  }
}
```

### Delegate Mode

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440003",
  "source": "metafactory.cortex.operator",
  "type": "task.pr-merge",
  "timestamp": "2026-05-09T14:40:00Z",
  "correlation_id": "770e8400-e29b-41d4-a716-446655440004",
  "sovereignty": {
    "classification": "local",
    "data_residency": "CH",
    "max_hop": 0,
    "frontier_ok": true,
    "model_class": "any"
  },
  "requirements": ["orchestration", "code-review", "release"],
  "sovereignty_required": "strict",
  "deadline": "2026-05-10T18:00:00Z",
  "distribution_mode": "delegate",
  "target_principal": "did:mf:pilot",
  "payload": {
    "pr_url": "https://github.com/the-metafactory/myelin/pull/32",
    "outcome": "merged",
    "escalation_channel": "discord:metafactory-ops"
  }
}
```

## Edge Cases & Failure Modes

| Scenario | Expected Behavior |
|----------|-------------------|
| Empty `requirements` array | Valid — no capability filter, any agent can claim |
| `requirements` with unknown capability tag | Valid at schema level — nak with `cant-do` at routing level |
| `deadline` in the past | Valid at schema level — agent may nak with `not-now` or complete anyway |
| `distribution_mode: "direct"` without `target_principal` | Validation error — cross-field constraint |
| `target_principal` present with `distribution_mode: "broadcast"` | Warning logged, `target_principal` ignored |
| Agent lacks required sovereignty level | Nak with `wont-do` — capable but policy refusal |
| Requirements exceed 10 elements | Validation error — array bound exceeded |
| Capability tag with invalid characters | Validation error — pattern mismatch |

## Success Criteria

**Definition of Done:**

1. [ ] TypeScript types for task routing fields exported from `@the-metafactory/myelin`
2. [ ] `validateEnvelope()` updated to validate new fields
3. [ ] Default behavior documented and implemented (broadcast, open sovereignty, no filter)
4. [ ] Cross-field validation: direct/delegate requires target_principal
5. [ ] JCS canonical inclusion documented for signing
6. [ ] Per-mode example envelopes validated against schema
7. [ ] Tests: valid broadcast/direct/delegate envelopes, invalid cross-field combos, boundary cases

**Phasing:**
- **Phase 1**: Type definitions + validation rules
- **Phase 2**: Integration with createEnvelope/createSignedEnvelope
- **Phase 3**: Example envelope test fixtures

## Scope

### In Scope

- Task routing field definitions (requirements, sovereignty_required, deadline, distribution_mode, target_principal)
- Validation rules for each field
- Cross-field validation (direct/delegate requires target_principal)
- JCS inclusion rules for signed envelopes
- Backwards compatibility (all fields optional)
- Per-mode example envelopes
- Schema validator extension

### Explicitly Out of Scope

- Consumer lifecycle manager (watches registry, creates consumers) — separate implementation
- Agent-side capability evaluation logic — agent runtime concern
- Nak reason handling — separate spec (implementation step 7)
- Dead-letter routing — separate spec (implementation step 9)
- Bidding sub-protocol — separate spec (implementation step 10)
- AGENT_CAPABILITIES KV schema — L5 Discovery spec (myelin#9)

## Decisions (Resolved 2026-05-09)

- **Requirements negation:** Not supported. Positive tags only. YAGNI — revisit if real use case appears.
- **Deadline format:** ISO-8601 absolute timestamps only. Callers resolve relative durations to absolute before publish. Avoids clock-skew interpretation.
- **Capability tag bounds:** Max 64 chars, pattern `^[a-z][a-z0-9-]*$`. Matches NSC subject-token limit; preserves log readability.

## Assumptions

- Capability tags align with AGENT_CAPABILITIES KV bucket vocabulary (defined in myelin#9)
- DID format follows MY-400: `did:mf:<name>`
- JCS (RFC 8785) is already implemented for envelope signing (from MY-400)
- Agents understand the three distribution modes and route accordingly
- The `type` field (e.g., `task.code-review`) provides subject hierarchy routing; `requirements` refines matching

---

*Generated: 2026-05-09 (batch mode)*
*Source: design-agent-task-routing.md Implementation step 6*
