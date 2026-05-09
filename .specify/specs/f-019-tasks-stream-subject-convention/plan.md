# Technical Plan: TASKS Stream + Subject Convention

**Feature:** F-019  
**Spec:** MY-101 extension (tasks domain)  
**Source:** docs/design-agent-task-routing.md (Implementation step 1)  
**Dependencies:** MY-101 (namespace), Pattern 4 acceptance  

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     TASKS JetStream Stream                       │
│  subjects: local.*.tasks.>, federated.*.tasks.>                 │
│  retention: Limits (7 days), replicas: 3, storage: File         │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│   Broadcast   │    │    Direct     │    │  Dead-Letter  │
│ tasks.{cap}.> │    │ tasks.@{p}.>  │    │ tasks.dead-*  │
└───────────────┘    └───────────────┘    └───────────────┘
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│   Filtered    │    │   Named       │    │   Operator    │
│   Consumers   │    │   Consumer    │    │   Escalation  │
│ (competing)   │    │ (exclusive)   │    │   Dashboard   │
└───────────────┘    └───────────────┘    └───────────────┘
```

**Subject namespace extension to MY-101:**

```
local.{org}.tasks.{capability}.{subcap}      # Broadcast
local.{org}.tasks.@{principal}.{capability}  # Direct/Delegate
local.{org}.tasks.dead-letter.{capability}   # Unclaimable
federated.{org}.tasks.*                      # Cross-operator mirror
```

---

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Stream | NATS JetStream | Already in use, Pattern 4 decision |
| Spec format | Markdown | Project standard (specs/*.md) |
| Schema validation | Existing envelope.ts | Subject derivation already implemented |
| Consumer mgmt | Cortex (M7) | Out of scope - reference patterns only |

**No new code dependencies.** This is primarily a specification extension. The `src/transport/nats.ts` already supports JetStream stream/consumer operations.

---

## Data Model

### Subject Grammar Types

```typescript
// Subject patterns - not new types, but grammar documentation

// Broadcast: competing consumers
// Pattern: local.{org}.tasks.{capability}.{subcapability}
type BroadcastSubject = `local.${string}.tasks.${string}.${string}`;

// Direct: principal-addressed
// Pattern: local.{org}.tasks.@{principal}.{capability}
// Principal encoding: DID dots → hyphens (did:mf:forge → @did-mf-forge)
type DirectSubject = `local.${string}.tasks.@${string}.${string}`;

// Dead-letter: unclaimable escalation
// Pattern: local.{org}.tasks.dead-letter.{capability}
type DeadLetterSubject = `local.${string}.tasks.dead-letter.${string}`;

// Federated mirrors all three patterns
type FederatedSubject = `federated.${string}.tasks.${string}`;
```

### Reserved Patterns

| Pattern | Purpose | Validation Rule |
|---------|---------|-----------------|
| `@*` | Principal prefix | No capability may start with `@` |
| `dead-letter` | Escalation path | Reserved segment name |

### Initial Capability Taxonomy (Seed)

```typescript
const SEED_CAPABILITIES = [
  'code-review',      // PR review tasks
  'security-scan',    // Static analysis, dep scan
  'deploy',           // Environment promotion
  'release',          // Version cut, changelog, tag
] as const;
```

Operators extend via `cortex.yaml`. Validator accepts any `lower-kebab` token.

---

## API Contracts

### Stream Definition (Reference)

```typescript
// TASKS stream - created by infrastructure, documented here
const TASKS_STREAM: Partial<StreamConfig> = {
  name: "TASKS",
  subjects: [
    "local.*.tasks.>",
    "federated.*.tasks.>",
  ],
  retention: RetentionPolicy.Limits,
  max_age: nanos(7 * 24 * 60 * 60 * 1000), // 7 days
  storage: StorageType.File,
  replicas: 3,  // Production; R=1 for dev
  discard: DiscardPolicy.Old,
};
```

### Consumer Pattern (Reference)

```typescript
// Per-capability consumer - managed by Cortex (M7), not this spec
const CAPABILITY_CONSUMER: Partial<ConsumerConfig> = {
  durable_name: "{capability}-workers",
  filter_subject: "local.{org}.tasks.{capability}.>",
  ack_policy: AckPolicy.Explicit,
  max_deliver: 3,
  ack_wait: nanos(5 * 60 * 1000), // 5 minutes
};
```

### Subject Derivation Logic

Existing `specs/namespace.md` subject derivation applies. Tasks domain follows same pattern:

```typescript
function deriveTaskSubject(
  classification: 'local' | 'federated',
  org: string,
  capability: string,
  subcapability?: string,
  principal?: string
): string {
  const prefix = classification;
  
  if (principal) {
    // Direct mode: @principal encoding
    const encoded = principal.replace(/:/g, '-'); // did:mf:forge → did-mf-forge
    return `${prefix}.${org}.tasks.@${encoded}.${capability}`;
  }
  
  if (subcapability) {
    return `${prefix}.${org}.tasks.${capability}.${subcapability}`;
  }
  
  return `${prefix}.${org}.tasks.${capability}`;
}
```

---

## Implementation Phases

### Phase 1: Spec Extension (Primary Deliverable)

**Goal:** Extend `specs/namespace.md` with tasks domain.

| Task | File | Description |
|------|------|-------------|
| 1.1 | `specs/namespace.md` | Add `tasks` domain section |
| 1.2 | `specs/namespace.md` | Document broadcast subject grammar |
| 1.3 | `specs/namespace.md` | Document direct-address `@{principal}` pattern |
| 1.4 | `specs/namespace.md` | Document dead-letter path |
| 1.5 | `specs/namespace.md` | Document federated counterpart |
| 1.6 | `specs/namespace.md` | Add reserved segment rules (`@*`, `dead-letter`) |

**Acceptance:** All 7 success criteria from spec completed in namespace.md.

### Phase 2: Stream Reference Documentation

**Goal:** Document TASKS stream definition for infrastructure setup.

| Task | File | Description |
|------|------|-------------|
| 2.1 | `specs/namespace.md` | Add TASKS JetStream stream config reference |
| 2.2 | `specs/namespace.md` | Document retention policy (7 days, limits-based) |
| 2.3 | `specs/namespace.md` | Document replication (R=3 prod, R=1 dev) |
| 2.4 | `specs/namespace.md` | Add consumer filter pattern examples |

**Note:** Actual stream creation is infrastructure concern, not code. Config documented for operators.

### Phase 3: Collision Check + Validation

**Goal:** Verify no conflicts with existing subjects.

| Task | Description |
|------|-------------|
| 3.1 | Grep codebase for existing `tasks.>` usage |
| 3.2 | Verify no capability starts with `@` in seed taxonomy |
| 3.3 | Confirm `dead-letter` not used elsewhere |
| 3.4 | Document collision prevention rules |

### Phase 4: Capability Taxonomy Seed

**Goal:** Document initial capability vocabulary.

| Task | File | Description |
|------|------|-------------|
| 4.1 | `specs/namespace.md` | Add seed capability table |
| 4.2 | — | Note: extension mechanism is Cortex concern |

---

## File Structure

```
specs/
└── namespace.md              # PRIMARY: Extend with tasks domain
    ├── [existing sections]
    ├── Tasks Domain          # NEW SECTION
    │   ├── Broadcast Mode
    │   ├── Direct Mode
    │   ├── Dead-Letter Path
    │   ├── Federated Counterpart
    │   └── Reserved Patterns
    ├── TASKS Stream          # NEW SECTION
    │   ├── Stream Definition
    │   ├── Consumer Patterns (reference)
    │   └── Retention Policy
    └── Capability Taxonomy   # NEW SECTION
        └── Seed capabilities
```

No new TypeScript files. Transport layer already supports JetStream operations via `src/transport/nats.ts`.

---

## Dependencies

### Prerequisites (Satisfied)

| Dependency | Status | Notes |
|------------|--------|-------|
| MY-101 namespace.md | ✅ Complete | Three-prefix model defined |
| Pattern 4 decision | ✅ Accepted | JetStream + Capability Registry chosen |
| NATS JetStream | ✅ Available | Already in metafactory infra |
| NATSTransport | ✅ Implemented | src/transport/nats.ts has stream/consumer support |

### Downstream Dependencies (Unblocked by This)

| Feature | Depends On | Notes |
|---------|------------|-------|
| F-020 | Subject grammar | Dispatch lifecycle envelopes |
| F-021 | Stream definition | Task envelope extension |
| myelin#9 | Consumer patterns | L5 Discovery capability registry |
| Cortex M7 | Full spec | Consumer lifecycle manager |

---

## Risk Assessment

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Subject collision with existing traffic | High | Low | Grep verification before merge (Phase 3.1) |
| Principal encoding ambiguity | Medium | Low | Document canonical encoding: dots→hyphens |
| Capability namespace fragmentation | Medium | Medium | Seed taxonomy + extension governance via cortex.yaml |
| Stream retention too short | Low | Low | 7 days covers weekend bounces; configurable |
| Federated path opens security surface | Medium | Low | Requires myelin#11 sovereignty enforcement first |

### Greenfield Advantage

Per spec decision: "Greenfield assumed — no existing `tasks.>` traffic to break."

Verification command:
```bash
rg 'tasks\.' specs/ src/ docs/ --type md --type ts
```

Expected: No conflicts (tasks domain is new).

---

## Validation Checklist

From spec success criteria:

- [ ] `specs/namespace.md` extended with `tasks` domain specification
- [ ] Subject grammar documented: Broadcast, Direct, Dead-letter, Federated
- [ ] Principal encoding rule documented (`@{did-with-hyphens}`)
- [ ] Reserved segment rules documented (`@*`, `dead-letter`)
- [ ] TASKS stream definition documented (subjects, retention, policies)
- [ ] Consumer filter pattern examples provided
- [ ] Collision check against existing reserved prefixes completed

---

## Estimated Effort

| Phase | Effort | Notes |
|-------|--------|-------|
| Phase 1: Spec extension | ~2 hours | Primary markdown writing |
| Phase 2: Stream docs | ~30 min | Config reference documentation |
| Phase 3: Collision check | ~15 min | Grep + verification |
| Phase 4: Taxonomy seed | ~15 min | Table + extension notes |
| **Total** | **~3 hours** | Spec-heavy, no code changes |

---

## Out of Scope

Explicitly excluded per spec:

- Consumer lifecycle management → Cortex M7
- AGENT_CAPABILITIES KV schema → myelin#9
- Task envelope schema → F-021
- Sovereignty enforcement → myelin#11
- Stream creation scripts → Infrastructure concern
