# Specification: TASKS Stream + Subject Convention

## Context

> Generated from batch specification: 2026-05-09
> Tracks: myelin#37 | Parent: myelin#7 (seven-layer model)
> Extends: specs/namespace.md (MY-101)
> Source: docs/design-agent-task-routing.md (Implementation step 1)
> Related: myelin#9 (L5 Discovery), myelin#10 (L6 Composition), myelin#31 (chain-of-stamps)

## Problem Statement

**Core Problem**: No standardized subject namespace for capability-routed task distribution. Pattern 4 (JetStream + Capability Registry) was chosen in design-agent-task-routing.md, but the TASKS stream and subject conventions required to implement it don't exist.

**What's Missing:**
1. **JetStream stream definition** — no TASKS stream exists for durable task delivery
2. **Subject grammar** — no documented convention for Broadcast vs Direct/Delegate routing
3. **Dead-letter path** — no subject for unclaimable tasks after `max_deliver` exhausts
4. **Federation** — no federated counterpart for cross-operator task markets
5. **Reserved prefix check** — potential collision between `tasks.*` and existing reserved prefixes

**Urgency**: Foundational. Consumer lifecycle manager (implementation step 5), capability registry (step 3), and task envelope (step 6) all depend on the stream and subject structure defined here.

**Impact if Unsolved**: Pattern 4 implementation blocked. Agent task routing remains ad-hoc, no durability, no competing consumers, no sovereignty via nak.

## Users & Stakeholders

| Consumer | Need | Interface |
|----------|------|-----------|
| Task publishers | Publish tasks to capability-scoped subjects | `js.publish("local.{org}.tasks.code-review.typescript", payload)` |
| Competing agents | Pull tasks matching their capabilities | Consumer filters on `tasks.{capability}.>` |
| Orchestrator (Cortex M7) | Create/tear down filtered consumers dynamically | Consumer lifecycle manager watches KV, creates consumers |
| Direct-addressed agents | Receive tasks sent specifically to them | Subscribe to `tasks.@{principal}.>` subject pattern |
| Operators | Review tasks that no agent could handle | Monitor `tasks.dead-letter.>` for escalation |

## Current State

**Existing Systems:**
- `specs/namespace.md` (MY-101) defines three-prefix model: `local.`, `federated.`, `public.`
- Subject format: `{prefix}.{org}.{domain}.{entity}.{action}`
- Reserved prefixes: `_system.`, `_internal.`, `_audit.`, `_test.`
- No `tasks.` domain defined

**What This Extends:**
- Adds `tasks` as a domain under `local.{org}.*` and `federated.{org}.*`
- Introduces `@{principal}` pattern for direct-address subjects
- Defines reserved prefixes collision rules for task routing

## Requirements

### Functional Requirements

| ID | Requirement | Source |
|----|-------------|--------|
| FR-1 | Define TASKS JetStream stream with `local.{org}.tasks.>` subject binding | design-agent-task-routing.md §Pattern 3-4 |
| FR-2 | Broadcast subject grammar: `local.{org}.tasks.{capability}.{subcapability}` | design-agent-task-routing.md §Implementation step 1 |
| FR-3 | Direct-address subject grammar: `local.{org}.tasks.@{principal}.{capability}` | design-agent-task-routing.md §Decision Q5 |
| FR-4 | Dead-letter subject: `local.{org}.tasks.dead-letter.{capability}` | design-agent-task-routing.md §Namespace extension |
| FR-5 | Federated counterpart: `federated.{org}.tasks.>` mirrors local grammar | design-agent-task-routing.md §Decision Q3 |
| FR-6 | Document reserved prefix collision check for `tasks` domain | Feature description |
| FR-7 | Stream retention: limits-based with configurable max_age (default 7 days) | design-agent-task-routing.md §Pattern 3 |
| FR-8 | Extend specs/namespace.md with tasks domain specification | MY-101 extension |

### Non-Functional Requirements

| ID | Requirement | Source |
|----|-------------|--------|
| NFR-1 | Subject segments follow MY-101 naming rules: lowercase alphanumeric + hyphens, 1-63 chars | specs/namespace.md |
| NFR-2 | Principal segment in direct-address subjects follows DID format: `@did-mf-{name}` | Derived from MY-400 principal format |
| NFR-3 | Backwards compatible — no breaking changes to existing subjects | Standard |
| NFR-4 | Stream must support filtered consumers for capability-scoped delivery | Pattern 4 requirement |

## Subject Grammar

### Broadcast Mode (Competing Consumers)

```
local.{org}.tasks.{capability}.{subcapability}
```

Tasks routed to any qualified agent. Multiple agents subscribe via filtered consumers; JetStream delivers to exactly one per consumer group.

**Examples:**
- `local.metafactory.tasks.code-review.typescript` — TS code review task
- `local.metafactory.tasks.security-scan.dependency` — dependency security scan
- `local.acme.tasks.deploy.cloudflare` — Cloudflare deployment task

### Direct/Delegate Mode (Named Recipient)

```
local.{org}.tasks.@{principal}.{capability}
```

Tasks addressed to a specific agent by principal. The `@` prefix denotes a principal-addressed subject (avoids content inspection, leverages NATS-native filtering).

**Principal encoding:** DID dots replaced with hyphens: `did:mf:forge` → `@did-mf-forge`

**Examples:**
- `local.metafactory.tasks.@did-mf-forge.release` — release task to Forge specifically
- `local.metafactory.tasks.@did-mf-pilot.pr-merge` — PR merge delegation to Pilot
- `local.acme.tasks.@did-mf-luna.code-review` — direct review request to Luna

### Dead-Letter Path

```
local.{org}.tasks.dead-letter.{capability}
```

Tasks that exhausted `max_deliver` without successful claim. Routed here for human review or escalation.

**Examples:**
- `local.metafactory.tasks.dead-letter.code-review` — unclaimed code review
- `local.metafactory.tasks.dead-letter.security-scan` — no agent could handle scan

### Federated Counterpart

```
federated.{org}.tasks.{capability}.{subcapability}
federated.{org}.tasks.@{principal}.{capability}
federated.{org}.tasks.dead-letter.{capability}
```

Same grammar, different prefix. Subject to envelope sovereignty block rules per MY-101. Enables cross-operator task markets (requires myelin#11 sovereignty enforcement as prerequisite).

## JetStream Stream Definition

### TASKS Stream

```typescript
await jsm.streams.add({
  name: "TASKS",
  subjects: [
    "local.*.tasks.>",      // All local task subjects
    "federated.*.tasks.>",  // All federated task subjects
  ],
  retention: RetentionPolicy.Limits,
  max_age: 7 * 24 * 60 * 60 * 1_000_000_000, // 7 days in nanos
  storage: StorageType.File,
  replicas: 3,              // R=3 production default (single-region cluster, tolerates 1 node loss)
                            // R=1 acceptable for dev/single-operator; configurable at install
  discard: DiscardPolicy.Old,
});
```

### Consumer Pattern (Reference)

Filtered consumers created per capability by Cortex (M7):

```typescript
await jsm.consumers.add("TASKS", {
  durable_name: "code-review-workers",
  filter_subject: "local.metafactory.tasks.code-review.>",
  ack_policy: AckPolicy.Explicit,
  max_deliver: 3,
  ack_wait: 300_000_000_000, // 5 minutes
});
```

Consumer lifecycle managed by Cortex — not part of this spec (see myelin#9, cortex §7.6).

## Reserved Prefix Collision Check

### Existing Reserved Prefixes (MY-101)

| Prefix | Purpose | Collision Risk |
|--------|---------|----------------|
| `_system.` | NATS cluster management | None — different prefix |
| `_internal.` | Myelin protocol control | None — different prefix |
| `_audit.` | Compliance/audit trail | None — different prefix |
| `_test.` | Test harness | None — different prefix |

### New Reserved Pattern

| Pattern | Purpose | Rule |
|---------|---------|------|
| `tasks.@*` | Principal-addressed tasks | `@` prefix reserved for principal encoding |
| `tasks.dead-letter.*` | Unclaimable task escalation | `dead-letter` reserved segment |

**Collision prevention:** No capability name may start with `@` or equal `dead-letter`. Validation in task publish path.

## User Scenarios

### Scenario 1: Agent Publishes Broadcast Task

- **Given** an orchestrator needs code review for a TypeScript PR
- **When** it publishes to `local.metafactory.tasks.code-review.typescript`
- **Then** JetStream persists the task in TASKS stream
- **And** exactly one agent with code-review capability receives via pull consumer
- **And** the agent can ack (claim) or nak (reject) based on sovereignty

### Scenario 2: Direct Task to Named Agent

- **Given** an operator says "Forge, cut a release"
- **When** orchestrator publishes to `local.metafactory.tasks.@did-mf-forge.release`
- **Then** only Forge receives the task (no competing consumers)
- **And** if Forge is offline, task persists until delivery or expiry

### Scenario 3: Task Dead-Letters After Max Retries

- **Given** a security-scan task delivered to agents 3 times (max_deliver)
- **When** all agents nak (capability mismatch or policy refusal)
- **Then** task routes to `local.metafactory.tasks.dead-letter.security-scan`
- **And** operator can monitor dead-letter subject for escalation

### Scenario 4: Cross-Operator Task (Federated)

- **Given** metafactory wants to offer code review to acme
- **When** task published to `federated.metafactory.tasks.code-review.typescript`
- **Then** acme's qualified agents can subscribe (subject to sovereignty)
- **And** envelope sovereignty block enforced per MY-200

## Success Criteria

**Definition of Done:**

1. [ ] `specs/namespace.md` extended with `tasks` domain specification
2. [ ] Subject grammar documented: Broadcast, Direct, Dead-letter, Federated
3. [ ] Principal encoding rule documented (`@{did-with-hyphens}`)
4. [ ] Reserved segment rules documented (`@*`, `dead-letter`)
5. [ ] TASKS stream definition documented (subjects, retention, policies)
6. [ ] Consumer filter pattern examples provided
7. [ ] Collision check against existing reserved prefixes completed

**Not in scope for this spec:**
- Consumer lifecycle management (Cortex M7)
- AGENT_CAPABILITIES KV schema (myelin#9)
- Task envelope schema (implementation step 6)
- Sovereignty enforcement (myelin#11)

## Assumptions

- JetStream available (already running in metafactory infrastructure)
- MY-101 namespace convention adopted — `local.{org}.*` pattern stable
- MY-400 principal format (`did:mf:{name}`) will be the identity standard
- Single TASKS stream per operator — not per-capability streams

## Initial Capability Taxonomy (Seed)

Operators MAY extend; validator accepts any lower-kebab token. Initial seed prevents early ecosystem fragmentation:

| Tag | Purpose |
|---|---|
| `code-review` | Pull request review tasks |
| `security-scan` | Static analysis, dep scan, secret scan |
| `deploy` | Environment promotion / cloudflare / k8s |
| `release` | Version cut, changelog, tag |

Per-operator extension recorded in `cortex.yaml` or equivalent; not part of this spec.

## Decisions (Resolved 2026-05-09)

- **Retention:** Limits, max_age = 7 days (matches typical task lifetime; bridges weekend bounces).
- **Replication:** R=3 production default, R=1 dev. Configurable at install.
- **Initial taxonomy:** Seed `code-review`, `security-scan`, `deploy`, `release`. Operator-extensible.
- **Migration:** Greenfield assumed — no existing `tasks.>` traffic to break. Pre-merge grep verifies.
- **Direct-address:** `tasks.@{principal}.{capability}` per Decision Q5 (broker-side filtering, no payload inspection).

---
*Batch specification generated: 2026-05-09*
*Source: docs/design-agent-task-routing.md (Implementation step 1)*
