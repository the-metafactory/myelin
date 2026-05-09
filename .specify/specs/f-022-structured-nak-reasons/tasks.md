# Implementation Tasks: F-022 Structured Nak Reasons

## Progress Tracking

| Task | Status | Notes |
|------|--------|-------|
| T-1.1 | ☐ | Types, constants, interfaces |
| T-2.1 | ☐ | nakWithReasonSync implementation |
| T-2.2 | ☐ | nakWithReason async implementation |
| T-2.3 | ☐ | Backoff logic tests |
| T-3.1 | ☐ | NATSTransport integration |
| T-3.2 | ☐ | Transport barrel export |
| T-3.3 | ☐ | Package root re-export |
| T-4.1 | ☐ | Documentation |

---

## Group 1: Foundation

### T-1.1: Create NakReason types and constants [T]

- **File:** `src/transport/nak.ts`
- **Test:** `src/transport/nak.test.ts`
- **Dependencies:** none
- **Description:** Define core types for structured nak reasons

**Implementation:**
```typescript
// Types
export type NakReason = 'cant-do' | 'wont-do' | 'not-now' | 'compliance-block';

export interface NakOptions {
  reason: NakReason;
  description?: string;
}

export interface NakContext {
  msg: JsMsg;
  envelope: MyelinEnvelope;
  agentPrincipal: string;
  publisher?: EnvelopePublisher;
  org?: string;
}

export interface TaskRejectedEvent {
  task_id: string;
  correlation_id: string;
  agent_principal: string;
  reason: NakReason;
  description?: string;
  timestamp: string;
  delivery_count: number;
}

// Constants
export const NAK_REASON_HEADER = 'Myelin-Nak-Reason';
export const NAK_DESCRIPTION_HEADER = 'Myelin-Nak-Description';

export const NAK_BACKOFF = {
  initialDelayMs: 1000,
  multiplier: 2,
  maxDelayMs: 60000,
} as const;
```

**Acceptance:**
- [ ] All 4 reason codes defined in NakReason union
- [ ] NakOptions has reason (required) and description (optional)
- [ ] NakContext has msg, envelope, agentPrincipal required; publisher, org optional
- [ ] TaskRejectedEvent matches spec lifecycle event payload
- [ ] Backoff constants: 1s initial, 2x multiplier, 60s max

---

## Group 2: Core Functions

### T-2.1: Implement nakWithReasonSync [T]

- **File:** `src/transport/nak.ts`
- **Test:** `src/transport/nak.test.ts`
- **Dependencies:** T-1.1
- **Description:** Simple sync nak for backwards-compat and handler errors

**Implementation:**
- Backoff state tracked in module-level Map keyed by stream sequence
- `cant-do`, `wont-do`, `compliance-block`: call `msg.nak()` with no delay
- `not-now`: call `msg.nak(delayNs)` with exponential backoff

**Backoff behavior:**
1. First `not-now` for sequence N → 1s delay
2. Second `not-now` for same sequence → 2s delay
3. Doubles each time, caps at 60s
4. Cleanup: remove state after max delay reached

**Test cases:**
- [ ] `cant-do` calls `nak()` with no args
- [ ] `wont-do` calls `nak()` with no args
- [ ] `compliance-block` calls `nak()` with no args
- [ ] First `not-now` calls `nak(1_000_000_000)` (1s in ns)
- [ ] Second `not-now` same sequence calls `nak(2_000_000_000)`
- [ ] Backoff caps at 60s after 7 retries

---

### T-2.2: Implement nakWithReason async [T]

- **File:** `src/transport/nak.ts`
- **Test:** `src/transport/nak.test.ts`
- **Dependencies:** T-1.1, T-2.1
- **Description:** Full async nak with lifecycle event emission

**Implementation:**
1. If `publisher` and `org` provided in context:
   - Build `TaskRejectedEvent` payload
   - Publish to `local.{org}.dispatch.task.rejected`
   - Best-effort (try/catch, don't block on failure)
2. Delegate to `nakWithReasonSync` for actual nak

**Test cases:**
- [ ] Emits lifecycle event when publisher provided
- [ ] Event payload matches TaskRejectedEvent schema
- [ ] Subject format: `local.{org}.dispatch.task.rejected`
- [ ] Continues even if publish fails
- [ ] Works without publisher (degrades to sync)

---

### T-2.3: Backoff logic edge cases [T]

- **File:** `src/transport/nak.test.ts`
- **Dependencies:** T-2.1
- **Description:** Edge case tests for backoff state management

**Test cases:**
- [ ] Different sequences maintain independent backoff state
- [ ] State cleaned up after max delay reached
- [ ] Memory doesn't leak with many sequences

---

## Group 3: Integration

### T-3.1: Update NATSTransport handler [P with T-3.2]

- **File:** `src/transport/nats.ts`
- **Dependencies:** T-2.1
- **Description:** Refactor subscribe() catch block to use nakWithReasonSync

**Current (line 156-159):**
```typescript
} catch (err) {
  msg.nak();
  process.stderr.write(...);
}
```

**Updated:**
```typescript
import { nakWithReasonSync } from './nak';

// In catch block:
} catch (err) {
  nakWithReasonSync(msg, {
    reason: 'cant-do',
    description: err instanceof Error ? err.message : String(err),
  });
  process.stderr.write(...);
}
```

**Acceptance:**
- [ ] Handler errors become `cant-do` naks
- [ ] Error message captured in description
- [ ] No behavior change for callers (backwards compat)

---

### T-3.2: Export from transport barrel [P with T-3.1]

- **File:** `src/transport/index.ts`
- **Dependencies:** T-2.2
- **Description:** Export nak symbols from transport module

**Add to exports:**
```typescript
export {
  nakWithReason,
  nakWithReasonSync,
} from './nak';

export type {
  NakReason,
  NakOptions,
  NakContext,
  TaskRejectedEvent,
} from './nak';
```

**Acceptance:**
- [ ] All public symbols exported
- [ ] Types exported separately

---

### T-3.3: Re-export from package root

- **File:** `src/index.ts`
- **Dependencies:** T-3.2
- **Description:** Re-export nak symbols for @the-metafactory/myelin consumers

**Add to exports:**
```typescript
export {
  nakWithReason,
  nakWithReasonSync,
} from './transport';

export type {
  NakReason,
  NakOptions,
  NakContext,
  TaskRejectedEvent,
} from './transport';
```

**Acceptance:**
- [ ] Import `{ nakWithReason, NakReason }` from `@the-metafactory/myelin` works
- [ ] Types available for TypeScript consumers

---

## Group 4: Documentation

### T-4.1: Create nak-reasons documentation

- **File:** `docs/nak-reasons.md`
- **Dependencies:** T-3.3
- **Description:** Document wire format, agent usage, consumer routing

**Sections:**
1. Overview (why structured naks matter)
2. Reason codes (table with code, meaning, consumer action)
3. Agent-side usage (code example with nakWithReason)
4. Lifecycle event format (TaskRejectedEvent schema)
5. Consumer routing (diagram from spec)
6. Backoff behavior for `not-now`

**Acceptance:**
- [ ] All 4 reason codes documented
- [ ] Code examples compile
- [ ] Links to F-4 dead-letter routing

---

## Execution Order

```
T-1.1 (types)
   │
   ├──→ T-2.1 (sync function)
   │       │
   │       ├──→ T-2.3 (backoff tests)
   │       │
   │       └──→ T-3.1 (NATSTransport integration) ──┐
   │                                                 │
   └──→ T-2.2 (async function)                       │
           │                                         │
           └──→ T-3.2 (barrel export) ──────────────┤
                                                     │
                       T-3.3 (root export) ←─────────┘
                           │
                           └──→ T-4.1 (docs)
```

**Parallelizable pairs:**
- T-3.1 and T-3.2 (after their respective dependencies)

**Critical path:** T-1.1 → T-2.1 → T-2.2 → T-3.2 → T-3.3 → T-4.1

---

## Success Criteria Mapping

| Spec Criterion | Task |
|----------------|------|
| `NakReason` type exported | T-3.3 |
| `nakWithReason(msg, options)` function | T-2.2 |
| Test: delay behavior per reason | T-2.1 |
| Test: backoff caps at 60s | T-2.3 |
| Lifecycle event emitted | T-2.2 |
| Backwards compat | T-3.1 |
| Documentation | T-4.1 |

---

## Out of Scope (F-4 Handles)

- Dead-letter stream/consumer setup
- Consumer-side routing logic (which reason → which action)
- `compliance-block` → immediate dead-letter path
- `not-now` → no count increment logic

These are consumer concerns. F-022 provides the signal; F-4 acts on it.
