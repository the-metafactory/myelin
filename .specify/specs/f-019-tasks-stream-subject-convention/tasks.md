# Implementation Tasks: TASKS Stream + Subject Convention

**Feature:** F-019  
**Type:** Specification Extension (no code changes)  
**Target:** `specs/namespace.md`  
**Effort:** ~3 hours  

---

## Progress Tracking

| Task | Status | Notes |
|------|--------|-------|
| T-1.1 | ☐ | Collision verification |
| T-2.1 | ☐ | Tasks domain intro |
| T-2.2 | ☐ | Broadcast grammar |
| T-2.3 | ☐ | Direct-address grammar |
| T-2.4 | ☐ | Dead-letter grammar |
| T-2.5 | ☐ | Federated grammar |
| T-2.6 | ☐ | Reserved patterns |
| T-3.1 | ☐ | Stream definition |
| T-3.2 | ☐ | Consumer patterns |
| T-3.3 | ☐ | Retention policy |
| T-4.1 | ☐ | Capability taxonomy |

---

## Group 1: Verification (Pre-flight)

### T-1.1: Collision Check [P]
- **File:** N/A (verification only)
- **Dependencies:** none
- **Description:** Verify no existing `tasks.>` subjects in codebase
- **Command:** `rg 'tasks\.' specs/ src/ --type ts`
- **Expected:** No conflicts (already verified: src/ clean)
- **Acceptance:** Document result in PR description

---

## Group 2: Subject Grammar (Core Spec)

All tasks in this group extend `specs/namespace.md`.

### T-2.1: Add Tasks Domain Section [P with T-1.1]
- **File:** `specs/namespace.md`
- **Dependencies:** T-1.1
- **Description:** Add new "Tasks Domain" section after "Reserved Prefixes"
- **Content:**
  - Intro paragraph explaining tasks are capability-routed
  - Note that tasks domain follows existing `{prefix}.{org}.{domain}.*` pattern
  - Reference to Pattern 4 (JetStream + Capability Registry)

### T-2.2: Document Broadcast Subject Grammar
- **File:** `specs/namespace.md`
- **Dependencies:** T-2.1
- **Description:** Add broadcast (competing consumers) subject pattern
- **Pattern:** `local.{org}.tasks.{capability}.{subcapability}`
- **Content:**
  - Format definition
  - 3+ examples: `local.metafactory.tasks.code-review.typescript`, etc.
  - Note: JetStream delivers to exactly one per consumer group

### T-2.3: Document Direct-Address Subject Grammar
- **File:** `specs/namespace.md`
- **Dependencies:** T-2.1
- **Description:** Add principal-addressed subject pattern
- **Pattern:** `local.{org}.tasks.@{principal}.{capability}`
- **Content:**
  - Format definition with `@` prefix explanation
  - Principal encoding rule: DID dots → hyphens (`did:mf:forge` → `@did-mf-forge`)
  - 3+ examples: `local.metafactory.tasks.@did-mf-forge.release`, etc.
  - Note: No competing consumers, exclusive delivery

### T-2.4: Document Dead-Letter Subject Grammar
- **File:** `specs/namespace.md`
- **Dependencies:** T-2.1
- **Description:** Add dead-letter escalation path pattern
- **Pattern:** `local.{org}.tasks.dead-letter.{capability}`
- **Content:**
  - Format definition
  - When triggered: tasks exhausting `max_deliver` without ack
  - 2+ examples: `local.metafactory.tasks.dead-letter.code-review`, etc.
  - Note: For operator escalation/monitoring

### T-2.5: Document Federated Subject Grammar
- **File:** `specs/namespace.md`
- **Dependencies:** T-2.2, T-2.3, T-2.4
- **Description:** Document federated counterparts of all three patterns
- **Patterns:**
  - `federated.{org}.tasks.{capability}.{subcapability}`
  - `federated.{org}.tasks.@{principal}.{capability}`
  - `federated.{org}.tasks.dead-letter.{capability}`
- **Content:**
  - Same grammar, different prefix
  - Note: Subject to envelope sovereignty rules (MY-200)
  - Note: Requires myelin#11 sovereignty enforcement

### T-2.6: Document Reserved Patterns
- **File:** `specs/namespace.md`
- **Dependencies:** T-2.3, T-2.4
- **Description:** Add tasks-specific reserved segments to Reserved Prefixes section
- **Content:**
  - Add row for `@*` (principal prefix) — no capability may start with `@`
  - Add row for `dead-letter` — reserved segment name
  - Validation rule: reject capabilities matching reserved patterns

---

## Group 3: Stream Reference

### T-3.1: Document TASKS Stream Definition
- **File:** `specs/namespace.md`
- **Dependencies:** T-2.1
- **Description:** Add JetStream stream configuration reference
- **Content:**
  ```typescript
  {
    name: "TASKS",
    subjects: ["local.*.tasks.>", "federated.*.tasks.>"],
    retention: RetentionPolicy.Limits,
    storage: StorageType.File,
    replicas: 3,  // R=1 for dev
    discard: DiscardPolicy.Old,
  }
  ```
- **Note:** Reference only — actual stream creation is infrastructure concern

### T-3.2: Document Consumer Filter Patterns [P with T-3.1]
- **File:** `specs/namespace.md`
- **Dependencies:** T-2.2
- **Description:** Add consumer pattern examples for capability-scoped delivery
- **Content:**
  - Per-capability consumer example
  - Filter subject pattern: `local.{org}.tasks.{capability}.>`
  - Ack policy, max_deliver, ack_wait reference values
  - Note: Consumer lifecycle managed by Cortex (M7), not this spec

### T-3.3: Document Retention Policy
- **File:** `specs/namespace.md`
- **Dependencies:** T-3.1
- **Description:** Document retention and replication policies
- **Content:**
  - `max_age`: 7 days (covers weekend bounces)
  - `replicas`: R=3 production, R=1 dev (configurable)
  - Rationale for 7-day default

---

## Group 4: Capability Taxonomy

### T-4.1: Document Seed Capabilities
- **File:** `specs/namespace.md`
- **Dependencies:** T-2.2
- **Description:** Add initial capability vocabulary table
- **Content:**
  | Tag | Purpose |
  |-----|---------|
  | `code-review` | Pull request review tasks |
  | `security-scan` | Static analysis, dep scan, secret scan |
  | `deploy` | Environment promotion / cloudflare / k8s |
  | `release` | Version cut, changelog, tag |
- **Note:** Operator-extensible via `cortex.yaml`; validator accepts any `lower-kebab` token

---

## Execution Order

```
T-1.1 ─────────┐
               ├──► T-2.1 ──► T-2.2 ──┬──► T-2.5
               │           ──► T-2.3 ──┤
               │           ──► T-2.4 ──┘
               │                │
               │                └──► T-2.6
               │
               └──► T-3.1 ──► T-3.3
                    │
                    T-3.2
                    │
                    T-4.1
```

**Parallelizable sets:**
1. T-1.1 (standalone verification)
2. T-3.1 + T-3.2 (stream docs, independent of grammar details)
3. T-2.2 + T-2.3 + T-2.4 (three subject patterns, same structure)

**Critical path:** T-1.1 → T-2.1 → T-2.2/T-2.3/T-2.4 → T-2.5 → T-2.6

---

## Validation Checklist

From spec success criteria:

- [ ] `specs/namespace.md` extended with `tasks` domain specification — T-2.1
- [ ] Subject grammar documented: Broadcast, Direct, Dead-letter, Federated — T-2.2, T-2.3, T-2.4, T-2.5
- [ ] Principal encoding rule documented (`@{did-with-hyphens}`) — T-2.3
- [ ] Reserved segment rules documented (`@*`, `dead-letter`) — T-2.6
- [ ] TASKS stream definition documented (subjects, retention, policies) — T-3.1, T-3.3
- [ ] Consumer filter pattern examples provided — T-3.2
- [ ] Collision check against existing reserved prefixes completed — T-1.1

---

## Out of Scope

Per spec exclusions:

- Consumer lifecycle management → Cortex M7
- AGENT_CAPABILITIES KV schema → myelin#9
- Task envelope schema → F-021
- Sovereignty enforcement → myelin#11
- Stream creation scripts → Infrastructure
