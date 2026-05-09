# Technical Plan: Dead Letter Queue Transport Wrapper

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│                           NATS JetStream                                  │
├─────────────────────────────────┬────────────────────────────────────────┤
│         TASKS Stream            │           TASKS_DEAD Stream            │
│  local.*.tasks.{cap}.{sub}      │   local.*.tasks.dead-letter.{cap}      │
│  retention: 7 days              │   retention: 30 days                   │
└───────────────┬─────────────────┴───────────────────────────────────────┬┘
                │                                                          │
                ▼                                                          │
┌───────────────────────────────┐                                          │
│     capability consumer       │                                          │
│   (code-review-workers, etc)  │                                          │
└───────────────┬───────────────┘                                          │
                │ deliver                                                  │
                ▼                                                          │
    ┌───────────────────────────────────────────────────┐                  │
    │                  Agent Handler                     │                  │
    │                                                    │                  │
    │   evaluate task → nakWithReason(msg, reason)       │                  │
    │                                                    │                  │
    │   reasons: cant-do | wont-do | not-now |          │                  │
    │            compliance-block                        │                  │
    └───────────────────────────┬───────────────────────┘                  │
                                │                                          │
                                ▼                                          │
    ┌───────────────────────────────────────────────────┐                  │
    │             DeadLetterHandler                      │                  │
    │                                                    │                  │
    │   Path 1: compliance-block → immediate DLQ         ├─────────────────►│
    │   Path 2: max_deliver exhausted → DLQ             │                  │
    │                                                    │                  │
    │   • Wraps envelope with dead_letter extension      │                  │
    │   • Tracks nak_chain across deliveries             │                  │
    │   • Derives dead-letter subject from capability    │                  │
    │   • Emits dispatch.task.failed lifecycle event     │                  │
    └────────────────────────────────────────────────────┘                  │
                                                                           │
                                                            ┌──────────────▼┐
                                                            │   Operator    │
                                                            │   Monitor     │
                                                            │               │
                                                            │ • Review DLQ  │
                                                            │ • Diagnose    │
                                                            │ • Republish   │
                                                            └───────────────┘
```

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Bun | Project standard |
| Transport | @nats-io/jetstream 3.3.1 | Already used in nats.ts |
| Types | TypeScript strict | Project pattern |
| Testing | Bun test runner | Project pattern |
| Stream storage | JetStream File | Production durability |

## Data Model

### NakReason (from F-022)

```typescript
// src/transport/nak.ts (F-022 provides this)
export type NakReason = 
  | 'cant-do'           // Static capability mismatch
  | 'wont-do'           // Sovereignty/policy refusal  
  | 'not-now'           // Load/availability
  | 'compliance-block'  // M7 attestation violation
;

export const NAK_REASON_HEADER = 'Myelin-Nak-Reason';
export const NAK_DESCRIPTION_HEADER = 'Myelin-Nak-Description';
```

### DeadLetterExtension

```typescript
// src/transport/dead-letter.ts

export interface DeadLetterExtension {
  original_subject: string;        // Subject task was originally published to
  originating_consumer: string;    // Consumer group that exhausted retries
  delivery_count: number;          // Total delivery attempts
  nak_chain: NakReason[];         // Ordered array of nak reasons (max max_deliver)
  final_nak_reason: NakReason;    // Last nak reason before dead-lettering
  dead_lettered_at: string;       // ISO-8601 timestamp
}

export interface DeadLetterEnvelope extends MyelinEnvelope {
  extensions: {
    dead_letter: DeadLetterExtension;
  } & Record<string, unknown>;
}
```

### NakChainTracker (internal)

```typescript
// Tracks nak reasons across redeliveries using NATS message metadata
interface NakChainEntry {
  correlation_id: string;
  consumer_name: string;
  nak_reasons: NakReason[];
  delivery_count: number;
  first_delivery_at: string;
}

// In-memory cache, keyed by correlation_id + consumer_name
// Evicted on ack or dead-letter
type NakChainCache = Map<string, NakChainEntry>;
```

## API Contracts

### Dead-Letter Routing

```typescript
// src/transport/dead-letter.ts

export interface DeadLetterHandlerOptions {
  /** TASKS stream to monitor */
  tasksStream: string;
  
  /** Dead-letter stream name (default: TASKS_DEAD) */
  deadLetterStream?: string;
  
  /** Org for subject derivation */
  org: string;
  
  /** Max delivery attempts before dead-letter (default: 3) */
  maxDeliver?: number;
  
  /** Callback on dead-letter routing (for lifecycle events) */
  onDeadLetter?: (envelope: DeadLetterEnvelope, reason: 'exhausted' | 'compliance-block') => Promise<void>;
}

export class DeadLetterHandler {
  constructor(transport: NATSTransport, options: DeadLetterHandlerOptions);
  
  /** Start monitoring for dead-letter conditions */
  start(): Promise<void>;
  
  /** Stop monitoring */
  stop(): Promise<void>;
  
  /** Manually route an envelope to dead-letter (for testing/escalation) */
  routeToDeadLetter(
    envelope: MyelinEnvelope,
    originalSubject: string,
    consumerName: string,
    nakChain: NakReason[],
    deliveryCount: number,
  ): Promise<void>;
}
```

### Republish Helper

```typescript
// src/transport/dead-letter.ts

export interface RepublishOptions {
  /** Override original subject (default: use original_subject from extension) */
  subject?: string;
  
  /** Preserve correlation_id (default: true) */
  preserveCorrelationId?: boolean;
}

/**
 * Re-emit a dead-lettered envelope to its original capability subject.
 * Strips extensions.dead_letter and publishes fresh.
 */
export async function republishDeadLetter(
  transport: TransportPublisher,
  envelope: DeadLetterEnvelope,
  options?: RepublishOptions,
): Promise<void>;
```

### Stream Configuration

```typescript
// TASKS_DEAD stream definition
const TASKS_DEAD_CONFIG = {
  name: 'TASKS_DEAD',
  subjects: [
    'local.*.tasks.dead-letter.>',
    'federated.*.tasks.dead-letter.>',
  ],
  retention: 'limits',
  max_age: 30 * 24 * 60 * 60 * 1e9,  // 30 days (vs 7 days on TASKS)
  storage: 'file',
  num_replicas: 3,  // Production; R=1 for dev
  discard: 'old',
};
```

## Implementation Phases

### Phase 1: Types & Interfaces (Day 1)

1. Create `src/transport/dead-letter.ts` with:
   - `DeadLetterExtension` interface
   - `DeadLetterEnvelope` interface  
   - `DeadLetterHandlerOptions` interface
   - Type guards: `isDeadLetterEnvelope()`

2. Ensure `NakReason` exported from F-022 integration (dependency)

3. Export from `src/transport/index.ts`

### Phase 2: TASKS_DEAD Stream Setup (Day 1)

1. Add `ensureDeadLetterStream()` to NATSTransport:
   ```typescript
   async ensureDeadLetterStream(config?: Partial<StreamConfig>): Promise<void>
   ```

2. Use 30-day retention, File storage, R=3 for production

3. Subject filter: `local.*.tasks.dead-letter.>`, `federated.*.tasks.dead-letter.>`

### Phase 3: Dead-Letter Envelope Creation (Day 2)

1. Implement `createDeadLetterEnvelope()`:
   ```typescript
   function createDeadLetterEnvelope(
     original: MyelinEnvelope,
     originalSubject: string,
     consumerName: string,
     nakChain: NakReason[],
     deliveryCount: number,
   ): DeadLetterEnvelope
   ```

2. Preserve original `correlation_id`
3. Derive capability from subject: `local.acme.tasks.code-review.typescript` → `code-review`
4. Add `extensions.dead_letter` block

### Phase 4: Nak Chain Tracking (Day 2)

1. Implement `NakChainTracker` class:
   - In-memory cache keyed by `${correlation_id}:${consumer_name}`
   - `record(correlationId, consumer, reason)` — appends reason
   - `get(correlationId, consumer)` — returns chain
   - `evict(correlationId, consumer)` — cleanup on ack/dead-letter
   - Bounded at `maxDeliver` entries per key

2. Integration point: called from enhanced `nakWithReason()` (F-022)

### Phase 5: Dead-Letter Routing Handler (Day 3)

1. Implement `DeadLetterHandler` class:
   - Monitor consumer advisory messages for `max_deliver` exhaustion
   - OR: hook into nak logic to detect when `numDelivered >= maxDeliver`
   
2. Fast path: `compliance-block` → immediate `routeToDeadLetter()`
   - No retry, no waiting for exhaustion
   
3. Exhaustion path: when `delivery_count >= max_deliver` and final nak
   - Collect nak chain from tracker
   - Route to `local.{org}.tasks.dead-letter.{capability}`

4. Subject derivation:
   ```typescript
   function deriveDeadLetterSubject(originalSubject: string): string {
     // local.acme.tasks.code-review.typescript 
     //   → local.acme.tasks.dead-letter.code-review
     const parts = originalSubject.split('.');
     const capability = parts[3]; // 0:local, 1:org, 2:tasks, 3:capability
     return `${parts[0]}.${parts[1]}.tasks.dead-letter.${capability}`;
   }
   ```

### Phase 6: Republish Helper (Day 3)

1. Implement `republishDeadLetter()`:
   - Strip `extensions.dead_letter`
   - Preserve `correlation_id` (default)
   - Publish to original subject or override
   - Generate new envelope `id` and `timestamp`

2. Validation: reject if missing `dead_letter` extension

### Phase 7: Lifecycle Event Emission (Day 4)

1. On dead-letter routing, emit `dispatch.task.failed`:
   ```typescript
   interface TaskFailedEvent {
     type: 'dispatch.task.failed';
     payload: {
       task_id: string;
       correlation_id: string;
       final_reason: NakReason;
       nak_chain: NakReason[];
       delivery_count: number;
       dead_letter_subject: string;
       consumer_name: string;
       route_trigger: 'exhausted' | 'compliance-block';
     };
   }
   ```

2. Publish to `local.{org}.dispatch.task.failed`

### Phase 8: Tests (Day 4-5)

1. Unit tests:
   - `createDeadLetterEnvelope()` output shape
   - `deriveDeadLetterSubject()` edge cases
   - `republishDeadLetter()` stripping logic
   - `isDeadLetterEnvelope()` type guard

2. Integration tests:
   - Exhaustion path: 3 naks → dead-letter
   - Fast path: `compliance-block` → immediate dead-letter
   - Lifecycle event emission
   - Republish round-trip
   - TASKS_DEAD stream retention (30d config)

3. Test fixtures:
   - Use `TestEnvelopeTransport` for unit tests
   - Use real NATSTransport with test server for integration

## File Structure

```
src/
├── transport/
│   ├── dead-letter.ts          # DeadLetterHandler, helpers, types
│   ├── dead-letter.test.ts     # Unit tests
│   ├── nak.ts                  # NakReason type, nakWithReason() (F-022)
│   ├── nak.test.ts             # Nak reason tests (F-022)
│   ├── nats.ts                 # Existing NATSTransport (extended)
│   ├── types.ts                # Extended with dead-letter types
│   └── index.ts                # Updated exports
├── types.ts                    # MyelinEnvelope (unchanged)
└── index.ts                    # Public API exports
```

## Dependencies

### External

| Package | Version | Purpose |
|---------|---------|---------|
| @nats-io/jetstream | 3.3.1 | Already in use |
| @nats-io/transport-node | 3.3.1 | Already in use |

### Internal

| Feature | Status | Blocking? |
|---------|--------|-----------|
| F-022 Structured Nak Reasons | Concurrent | Yes — provides NakReason type and nakWithReason() |
| F-019 TASKS Stream | Specced | No — dead-letter works with existing stream |
| MyelinEnvelope extensions field | Exists | No — already supports arbitrary extensions |

### Runtime

- NATS JetStream 2.10+ (headers API required)
- Bun 1.x

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| F-022 not ready | High | Medium | Can stub NakReason type locally; full integration deferred |
| Nak chain state loss on process restart | Medium | Medium | Accept loss (bounded to single session); future: use JetStream KV for persistence |
| Consumer advisory not reliable for exhaustion detection | Medium | Low | Primary path: hook into nak logic directly; advisory as backup signal |
| Subject parsing fragile | Low | Low | Validate subject format in publish path; defensive parsing with fallback |
| TASKS_DEAD stream not created | High | Low | Auto-create in `start()`; fail loudly if stream creation fails |

## Open Questions (Resolved)

1. **Q: How to track nak chain across redeliveries?**  
   A: In-memory cache keyed by `correlation_id:consumer`. Acceptable to lose on restart — bounded state.

2. **Q: Hook into nak vs. consumer advisory?**  
   A: Primary: hook into `nakWithReason()` — count deliveries there. Advisory as secondary signal for edge cases.

3. **Q: Separate file or extend nats.ts?**  
   A: Separate `dead-letter.ts` — single responsibility. NATSTransport stays focused on transport primitives.

## Success Criteria Mapping

| Spec Criterion | Implementation |
|----------------|----------------|
| Tasks reaching max_deliver appear on dead-letter within 100ms | Phase 5: DeadLetterHandler monitors delivery count |
| compliance-block skips retries | Phase 5: Fast path in nakWithReason() |
| Dead-letter envelope contains diagnostic fields | Phase 3: createDeadLetterEnvelope() |
| Existing TASKS stream consumers unaffected | No changes to consumer logic; additive feature |
| Integration test: compliance-block surfaces on first attempt | Phase 8: Fast path test |
| Dead-letter stream queryable via JetStream consumer | Phase 2: TASKS_DEAD stream setup |
