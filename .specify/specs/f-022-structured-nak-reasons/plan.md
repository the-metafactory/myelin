# Technical Plan: Structured Nak Reasons

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Agent Task Handler                                 │
│                                                                              │
│   ┌─────────────┐    ┌─────────────────┐    ┌────────────────────────────┐  │
│   │  Evaluate   │───>│  nakWithReason  │───>│  Set NATS Headers          │  │
│   │  Task       │    │  (cant-do       │    │  Myelin-Nak-Reason: X      │  │
│   │             │    │   wont-do       │    │  Myelin-Nak-Description: Y │  │
│   │             │    │   not-now       │    └──────────┬─────────────────┘  │
│   │             │    │   compliance-   │               │                    │
│   │             │    │   block)        │               ▼                    │
│   └─────────────┘    └─────────────────┘    ┌────────────────────────────┐  │
│                                             │  msg.nak(delay?)            │  │
│                                             └──────────┬─────────────────┘  │
└────────────────────────────────────────────────────────┼────────────────────┘
                                                         │
                                                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         JetStream Consumer                                   │
│                                                                              │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │                    Routing Logic (by reason)                          │  │
│   │                                                                        │  │
│   │   compliance-block  ──────────────────────────> Dead-Letter (F-4)     │  │
│   │                                                 (immediate, no retry)  │  │
│   │                                                                        │  │
│   │   not-now  ─────────> Redeliver to next agent                         │  │
│   │                       (NO delivery count increment)                    │  │
│   │                       (exponential backoff: 1s, 2s, 4s... max 60s)    │  │
│   │                                                                        │  │
│   │   cant-do / wont-do ──> Redeliver to next agent                       │  │
│   │                         (increment delivery count)                     │  │
│   │                         └──> count >= max_deliver? ──> Dead-Letter    │  │
│   │                                                                        │  │
│   │   (no header)  ─────────> Treat as cant-do                            │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                                         │
                                                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       Lifecycle Event Stream                                 │
│                                                                              │
│   Subject: local.{org}.dispatch.task.rejected                               │
│   Payload: { task_id, correlation_id, agent_principal, reason,              │
│              description?, timestamp, delivery_count }                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Bun | Project standard |
| Transport | @nats-io/transport-node | Already in use, JetStream support |
| JetStream | @nats-io/jetstream | Headers API required (2.10+) |
| Testing | bun:test | Project pattern |
| Types | TypeScript | Project standard, strict mode |

No new dependencies. Uses existing NATS client's headers API.

## Data Model

### NakReason Type

```typescript
// src/transport/nak.ts (new file)

/**
 * Structured reason codes for task rejection.
 * Discriminates routing behavior for dead-letter, retry, and observability.
 */
export type NakReason =
  | 'cant-do'          // Static capability mismatch — agent lacks required tool/env/credential
  | 'wont-do'          // Sovereignty/policy refusal — agent capable but declines
  | 'not-now'          // Load/availability — agent at capacity, redeliver to peer
  | 'compliance-block' // M7 attestation violation — immediate dead-letter, no retry
;

export interface NakOptions {
  reason: NakReason;
  description?: string;
}
```

### Wire Format Constants

```typescript
// Header names (NATS convention: Title-Case with hyphens)
export const NAK_REASON_HEADER = 'Myelin-Nak-Reason';
export const NAK_DESCRIPTION_HEADER = 'Myelin-Nak-Description';
```

### Backoff Configuration

```typescript
// Exponential backoff for not-now (load-shedding)
export const NAK_BACKOFF = {
  initialDelayMs: 1000,
  multiplier: 2,
  maxDelayMs: 60000,
} as const;
```

### Lifecycle Event Payload

```typescript
// Emitted to local.{org}.dispatch.task.rejected
export interface TaskRejectedEvent {
  task_id: string;
  correlation_id: string;
  agent_principal: string;
  reason: NakReason;
  description?: string;
  timestamp: string;
  delivery_count: number;
}
```

## API Contracts

### Agent-Side API

```typescript
import type { JsMsg } from '@nats-io/jetstream';

/**
 * Nak a JetStream message with a structured reason.
 * Sets headers before calling NATS nak.
 * 
 * @param msg - The JetStream message to reject
 * @param options - Reason code and optional description
 * 
 * Delay behavior:
 * - compliance-block: no delay (immediate dead-letter by consumer)
 * - not-now: exponential backoff (1s, 2s, 4s... max 60s)
 * - cant-do/wont-do: no delay (standard redelivery)
 */
export function nakWithReason(msg: JsMsg, options: NakOptions): void;
```

### Consumer Routing Contract

Consumer-side logic (F-4 dead-letter handler) reads headers:

```typescript
function getReasonFromHeaders(msg: JsMsg): NakReason | null {
  const headers = msg.headers;
  if (!headers) return null;
  const reason = headers.get(NAK_REASON_HEADER);
  if (!reason) return null;
  if (isValidNakReason(reason)) return reason;
  return null; // Invalid reason treated as cant-do
}

function isValidNakReason(s: string): s is NakReason {
  return ['cant-do', 'wont-do', 'not-now', 'compliance-block'].includes(s);
}
```

### Backwards Compatibility

Existing `msg.nak()` calls (no reason) continue working. Consumer logic:
- Missing `Myelin-Nak-Reason` header → treat as `cant-do`
- Increment delivery count, dead-letter after `max_deliver`

## Implementation Phases

### Phase 1: Core Types & Helper (Day 1)

**Files:**
- Create `src/transport/nak.ts` — types + `nakWithReason` implementation
- Update `src/transport/index.ts` — export new symbols
- Update `src/index.ts` — re-export from package root

**Implementation:**

```typescript
// src/transport/nak.ts
import type { JsMsg } from '@nats-io/jetstream';
import { headers } from '@nats-io/nats-core';

export type NakReason = 'cant-do' | 'wont-do' | 'not-now' | 'compliance-block';

export interface NakOptions {
  reason: NakReason;
  description?: string;
}

export const NAK_REASON_HEADER = 'Myelin-Nak-Reason';
export const NAK_DESCRIPTION_HEADER = 'Myelin-Nak-Description';

const NAK_BACKOFF = {
  initialDelayMs: 1000,
  multiplier: 2,
  maxDelayMs: 60000,
} as const;

// Track backoff state per message (keyed by stream sequence)
const backoffState = new Map<number, number>();

export function nakWithReason(msg: JsMsg, options: NakOptions): void {
  // Set headers on the message
  const h = headers();
  h.set(NAK_REASON_HEADER, options.reason);
  if (options.description) {
    h.set(NAK_DESCRIPTION_HEADER, options.description);
  }
  
  // Note: JsMsg headers are read-only after receipt.
  // The reason is transmitted via nak() delay pattern:
  // - compliance-block: no delay (consumer routes immediately)
  // - not-now: exponential backoff
  // - cant-do/wont-do: standard redelivery
  
  let delayMs: number | undefined;
  
  if (options.reason === 'not-now') {
    const seq = msg.info.streamSequence;
    const current = backoffState.get(seq) ?? NAK_BACKOFF.initialDelayMs;
    delayMs = current;
    const next = Math.min(current * NAK_BACKOFF.multiplier, NAK_BACKOFF.maxDelayMs);
    backoffState.set(seq, next);
    // Cleanup: remove from map after max delay reached
    if (next >= NAK_BACKOFF.maxDelayMs) {
      setTimeout(() => backoffState.delete(seq), NAK_BACKOFF.maxDelayMs);
    }
  }
  
  // NATS JsMsg.nak() accepts optional delay in nanoseconds
  if (delayMs !== undefined) {
    msg.nak(delayMs * 1_000_000); // ms to ns
  } else {
    msg.nak();
  }
}
```

**Problem: JsMsg headers are immutable after receipt.**

Alternative approach — use message metadata or wrap nak:

```typescript
// Alternative: Store reason in envelope extensions before nak
// Consumer reads from republished envelope, not NATS headers

// OR: Use NATS server-side features (AckNak with metadata)
// Note: NATS 2.10+ supports nak with delay but not custom metadata
```

**Resolution:** After investigation, NATS JetStream `nak()` doesn't carry custom headers back to the server. The reason must be:

1. **Option A:** Published to a separate "nak-reason" subject before calling nak()
2. **Option B:** Stored in a KV bucket keyed by message sequence
3. **Option C:** Emitted as lifecycle event (task.rejected) which F-4 consumes

**Chosen: Option C** — Emit `dispatch.task.rejected` event with reason. This:
- Decouples nak from routing logic
- F-4 dead-letter handler subscribes to lifecycle events
- Reason is durable (JetStream-backed)
- Aligns with existing lifecycle event pattern

**Revised Implementation:**

```typescript
// src/transport/nak.ts
import type { JsMsg } from '@nats-io/jetstream';
import type { MyelinEnvelope } from '../types';
import type { EnvelopePublisher } from './types';

export type NakReason = 'cant-do' | 'wont-do' | 'not-now' | 'compliance-block';

export interface NakOptions {
  reason: NakReason;
  description?: string;
}

export interface NakContext {
  msg: JsMsg;
  envelope: MyelinEnvelope;
  agentPrincipal: string;
  publisher?: EnvelopePublisher; // For emitting lifecycle events
  org?: string;                   // Namespace org segment
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

const NAK_BACKOFF = {
  initialDelayMs: 1000,
  multiplier: 2,
  maxDelayMs: 60000,
} as const;

const backoffState = new Map<number, number>();

/**
 * Nak with structured reason. Emits lifecycle event if publisher provided.
 */
export async function nakWithReason(
  ctx: NakContext,
  options: NakOptions,
): Promise<void> {
  const { msg, envelope, agentPrincipal, publisher, org } = ctx;
  
  // Emit lifecycle event (best-effort)
  if (publisher && org) {
    const event: TaskRejectedEvent = {
      task_id: envelope.id,
      correlation_id: envelope.correlation_id ?? envelope.id,
      agent_principal: agentPrincipal,
      reason: options.reason,
      description: options.description,
      timestamp: new Date().toISOString(),
      delivery_count: msg.info.redeliveryCount + 1,
    };
    
    try {
      await publisher.publish({
        source: `urn:myelin:agent:${agentPrincipal}`,
        type: 'dispatch.task.rejected',
        payload: event as unknown as Record<string, unknown>,
        correlation_id: envelope.correlation_id,
      }, `local.${org}.dispatch.task.rejected`);
    } catch {
      // Best-effort — don't block nak on event emission failure
    }
  }
  
  // Calculate delay
  let delayMs: number | undefined;
  
  if (options.reason === 'not-now') {
    const seq = msg.info.streamSequence;
    const current = backoffState.get(seq) ?? NAK_BACKOFF.initialDelayMs;
    delayMs = current;
    const next = Math.min(current * NAK_BACKOFF.multiplier, NAK_BACKOFF.maxDelayMs);
    backoffState.set(seq, next);
  }
  
  // Nak the message
  if (delayMs !== undefined) {
    msg.nak(delayMs * 1_000_000);
  } else {
    msg.nak();
  }
}

/**
 * Simple sync nak for backwards compat — no lifecycle event.
 */
export function nakWithReasonSync(msg: JsMsg, options: NakOptions): void {
  let delayMs: number | undefined;
  
  if (options.reason === 'not-now') {
    const seq = msg.info.streamSequence;
    const current = backoffState.get(seq) ?? NAK_BACKOFF.initialDelayMs;
    delayMs = current;
    const next = Math.min(current * NAK_BACKOFF.multiplier, NAK_BACKOFF.maxDelayMs);
    backoffState.set(seq, next);
  }
  
  if (delayMs !== undefined) {
    msg.nak(delayMs * 1_000_000);
  } else {
    msg.nak();
  }
}
```

### Phase 2: Tests (Day 1-2)

**Files:**
- Create `src/transport/nak.test.ts`

**Test cases:**

```typescript
// src/transport/nak.test.ts
import { describe, it, expect, mock } from 'bun:test';
import { nakWithReasonSync, type NakReason } from './nak';

// Mock JsMsg
const createMockMsg = (redeliveryCount = 0, streamSequence = 1) => ({
  info: { redeliveryCount, streamSequence },
  nak: mock(() => {}),
});

describe('nakWithReasonSync', () => {
  it('calls nak without delay for cant-do', () => {
    const msg = createMockMsg();
    nakWithReasonSync(msg as any, { reason: 'cant-do' });
    expect(msg.nak).toHaveBeenCalledWith();
  });

  it('calls nak without delay for wont-do', () => {
    const msg = createMockMsg();
    nakWithReasonSync(msg as any, { reason: 'wont-do' });
    expect(msg.nak).toHaveBeenCalledWith();
  });

  it('calls nak without delay for compliance-block', () => {
    const msg = createMockMsg();
    nakWithReasonSync(msg as any, { reason: 'compliance-block' });
    expect(msg.nak).toHaveBeenCalledWith();
  });

  it('calls nak with 1s delay for first not-now', () => {
    const msg = createMockMsg(0, 100);
    nakWithReasonSync(msg as any, { reason: 'not-now' });
    expect(msg.nak).toHaveBeenCalledWith(1_000_000_000); // 1s in ns
  });

  it('doubles delay on subsequent not-now (same sequence)', () => {
    const msg1 = createMockMsg(0, 200);
    const msg2 = createMockMsg(1, 200);
    
    nakWithReasonSync(msg1 as any, { reason: 'not-now' });
    nakWithReasonSync(msg2 as any, { reason: 'not-now' });
    
    expect(msg2.nak).toHaveBeenCalledWith(2_000_000_000); // 2s
  });

  it('caps delay at 60s', () => {
    const seq = 300;
    // Simulate 7 retries: 1s, 2s, 4s, 8s, 16s, 32s, 60s (capped)
    for (let i = 0; i < 7; i++) {
      const msg = createMockMsg(i, seq);
      nakWithReasonSync(msg as any, { reason: 'not-now' });
    }
    
    const msg = createMockMsg(7, seq);
    nakWithReasonSync(msg as any, { reason: 'not-now' });
    expect(msg.nak).toHaveBeenCalledWith(60_000_000_000); // 60s max
  });
});

describe('NakReason type', () => {
  it('covers all four reason codes', () => {
    const reasons: NakReason[] = ['cant-do', 'wont-do', 'not-now', 'compliance-block'];
    expect(reasons.length).toBe(4);
  });
});
```

### Phase 3: Integration with NATSTransport (Day 2)

**Files:**
- Update `src/transport/nats.ts` — refactor handler to use nakWithReason

**Current code (line 156-159):**
```typescript
} catch (err) {
  msg.nak();
  process.stderr.write(...);
}
```

**Updated:**
```typescript
import { nakWithReasonSync } from './nak';

// In subscribe() handler:
} catch (err) {
  nakWithReasonSync(msg, { 
    reason: 'cant-do', 
    description: err instanceof Error ? err.message : String(err) 
  });
  process.stderr.write(...);
}
```

This maintains backwards compatibility — existing handler errors become `cant-do` naks.

### Phase 4: Export from Package (Day 2)

**Files:**
- Update `src/transport/index.ts`
- Update `src/index.ts`

```typescript
// src/transport/index.ts
export { 
  nakWithReason, 
  nakWithReasonSync,
  type NakReason, 
  type NakOptions, 
  type NakContext,
  type TaskRejectedEvent,
} from './nak';

// src/index.ts
export { 
  nakWithReason, 
  nakWithReasonSync,
  type NakReason, 
  type NakOptions, 
  type NakContext,
  type TaskRejectedEvent,
} from './transport';
```

### Phase 5: Documentation (Day 2)

**Files:**
- Update `README.md` or create `docs/nak-reasons.md`

Document:
- Wire format (lifecycle event payload)
- Agent usage pattern
- Consumer routing expectations (for F-4)
- Backoff behavior for `not-now`

## File Structure

```
src/
├── transport/
│   ├── nak.ts          # NEW: NakReason type, nakWithReason functions
│   ├── nak.test.ts     # NEW: Unit tests
│   ├── nats.ts         # UPDATE: Import nakWithReasonSync for handler errors
│   ├── index.ts        # UPDATE: Re-export nak symbols
│   └── types.ts        # UNCHANGED
├── types.ts            # UNCHANGED
└── index.ts            # UPDATE: Re-export nak symbols

docs/
└── nak-reasons.md      # NEW: Usage documentation
```

## Dependencies

| Dependency | Status | Required For |
|------------|--------|--------------|
| @nats-io/jetstream | Deployed | JsMsg type, nak() API |
| NATS 2.10+ | Deployed | Nak delay support |
| F-4 Dead-letter routing | Planned | Consuming `dispatch.task.rejected` events |
| F-020 Dispatch lifecycle | Planned | Event subject convention |

### Dependency Resolution

- F-4 reads lifecycle events; this feature emits them. No circular dependency.
- F-020 defines `dispatch.task.rejected` subject. If not yet implemented, F-022 can publish to the subject anyway — the stream/consumer setup is F-020's concern.
- Can stub F-4 integration: emit events, F-4 consumes when ready.

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| **JsMsg nak() doesn't carry headers** | High | Confirmed | Use lifecycle events instead of NATS headers for routing |
| **Backoff state memory leak** | Low | Medium | Cleanup after max delay reached; bounded by active message count |
| **Lifecycle event emission fails** | Low | Low | Best-effort fire-and-forget; nak still happens |
| **Breaking change to handler signature** | Medium | Low | Backwards compat: existing msg.nak() calls unchanged |
| **F-4 not ready to consume events** | Low | Medium | Events are durable (JetStream); F-4 catches up when deployed |
| **Performance: event publish on nak path** | Low | Medium | Async, non-blocking; < 5ms added latency |

## Testing Strategy

### Unit Tests (Phase 2)
- `nakWithReasonSync` delay behavior per reason
- Backoff doubling for `not-now`
- Backoff cap at 60s

### Integration Tests (Future, with F-4)
- `compliance-block` → dead-letter immediately (no redelivery)
- `not-now` → redeliver without incrementing `max_deliver` count
- `cant-do`/`wont-do` → normal retry until exhaustion
- Missing reason → treat as `cant-do`

### Performance Tests
- Nak overhead < 100μs (no event emission)
- Nak + event < 5ms

## Success Criteria Mapping

| Spec Criterion | Implementation |
|----------------|----------------|
| `NakReason` type exported | Phase 4: `src/index.ts` re-export |
| `nakWithReason(msg, options)` function | Phase 1: `src/transport/nak.ts` |
| NATS headers documented | N/A — using lifecycle events instead |
| Test: `compliance-block` → dead-letter | Phase 3 (stub) + F-4 integration |
| Test: `not-now` no count increment | F-4 consumer logic (out of scope) |
| Test: `cant-do`/`wont-do` increment | F-4 consumer logic (out of scope) |
| Test: missing header → `cant-do` | F-4 consumer logic (out of scope) |
| F-4 integration | Lifecycle event contract defined |
| Lifecycle event emitted | Phase 1: `dispatch.task.rejected` |

## Out of Scope (F-4 Handles)

- Dead-letter stream/consumer setup
- Consumer-side routing logic (which reason → which action)
- Nak chain accumulation
- `republishDeadLetter()` helper

---

*Plan generated: 2026-05-09*
*Spec source: F-022 Structured Nak Reasons*
