# Technical Plan: Task Envelope Extension (F-021)

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         MyelinEnvelope                              │
├─────────────────────────────────────────────────────────────────────┤
│  Core Fields (existing)        │  Task Routing Fields (new)        │
│  ─────────────────────         │  ──────────────────────────        │
│  id, source, type, timestamp   │  requirements[]                   │
│  correlation_id?, sovereignty  │  sovereignty_required             │
│  signed_by?, economics?        │  distribution_mode                │
│  extensions?, payload          │  target_principal?                │
│                                │  deadline?                        │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
              ┌──────────┐   ┌──────────┐   ┌──────────┐
              │ Broadcast│   │  Direct  │   │ Delegate │
              │  (open)  │   │ (named)  │   │(outcome) │
              └──────────┘   └──────────┘   └──────────┘
```

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Bun | Project standard |
| Types | TypeScript strict | Existing pattern |
| Validation | Manual regex + enum | Matches envelope.ts pattern |
| Signing | JCS (RFC 8785) | Already implemented in canonicalize.ts |
| Testing | bun:test | Existing pattern |

## Data Model

### New Types (src/types.ts additions)

```typescript
/** Sovereignty evaluation strictness */
export type SovereigntyRequirement = 'open' | 'selective' | 'strict';

/** Task distribution semantics */
export type DistributionMode = 'broadcast' | 'direct' | 'delegate';

/** Extended MyelinEnvelope with task routing fields */
export interface MyelinEnvelope {
  // ... existing fields ...
  
  /** Capability tags required to claim this task */
  requirements?: string[];
  
  /** Minimum sovereignty mode for claiming agents */
  sovereignty_required?: SovereigntyRequirement;
  
  /** ISO-8601 deadline for task completion */
  deadline?: string;
  
  /** Distribution semantics */
  distribution_mode?: DistributionMode;
  
  /** Target agent DID for direct/delegate modes */
  target_principal?: string;
}
```

### Validation Patterns

```typescript
// Capability tag: lowercase letters, numbers, hyphens; starts with letter
const CAPABILITY_TAG_RE = /^[a-z][a-z0-9-]{0,63}$/;

// ISO-8601 datetime (already exists)
const ISO8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

// DID (already exists in identity/types.ts)
const DID_RE = /^did:mf:[a-z][a-z0-9._-]+$/;

// Enums
const SOVEREIGNTY_REQUIREMENTS = new Set(['open', 'selective', 'strict']);
const DISTRIBUTION_MODES = new Set(['broadcast', 'direct', 'delegate']);

// Bounds
const MAX_REQUIREMENTS = 10;
```

### Cross-Field Validation Rules

| Condition | Validation |
|-----------|------------|
| `distribution_mode` is `direct` or `delegate` | `target_principal` required |
| `target_principal` present with `broadcast` | Warning (ignored, not error) |
| `requirements` array | Max 10 elements |
| Each requirement | Must match `CAPABILITY_TAG_RE` |

## Implementation Phases

### Phase 1: Type Definitions (~30 min)

**Files:** `src/types.ts`

1. Add `SovereigntyRequirement` type alias
2. Add `DistributionMode` type alias
3. Extend `MyelinEnvelope` interface with 5 optional fields
4. Extend `CreateEnvelopeInput` interface with same fields

### Phase 2: Envelope Creation (~20 min)

**Files:** `src/envelope.ts`

1. Update `createEnvelope()` to pass through task routing fields
2. Only include fields when present (maintain sparse object pattern)

```typescript
export function createEnvelope(input: CreateEnvelopeInput): MyelinEnvelope {
  return {
    // ... existing fields ...
    ...(input.requirements?.length ? { requirements: input.requirements } : {}),
    ...(input.sovereignty_required ? { sovereignty_required: input.sovereignty_required } : {}),
    ...(input.deadline ? { deadline: input.deadline } : {}),
    ...(input.distribution_mode ? { distribution_mode: input.distribution_mode } : {}),
    ...(input.target_principal ? { target_principal: input.target_principal } : {}),
  };
}
```

### Phase 3: Validation (~45 min)

**Files:** `src/envelope.ts`

Add validation blocks for each new field in `validateEnvelope()`:

```typescript
// requirements validation
if (e.requirements !== undefined) {
  if (!Array.isArray(e.requirements)) {
    errors.push({ field: 'requirements', message: 'must be an array' });
  } else {
    if (e.requirements.length > 10) {
      errors.push({ field: 'requirements', message: 'max 10 capability tags' });
    }
    e.requirements.forEach((tag, i) => {
      if (typeof tag !== 'string' || !CAPABILITY_TAG_RE.test(tag)) {
        errors.push({ field: `requirements[${i}]`, message: 'invalid capability tag' });
      }
    });
  }
}

// sovereignty_required validation
if (e.sovereignty_required !== undefined) {
  if (!SOVEREIGNTY_REQUIREMENTS.has(e.sovereignty_required)) {
    errors.push({ field: 'sovereignty_required', message: 'must be open, selective, or strict' });
  }
}

// deadline validation
if (e.deadline !== undefined) {
  if (typeof e.deadline !== 'string' || !ISO8601_RE.test(e.deadline)) {
    errors.push({ field: 'deadline', message: 'must be valid ISO-8601 datetime' });
  }
}

// distribution_mode validation
if (e.distribution_mode !== undefined) {
  if (!DISTRIBUTION_MODES.has(e.distribution_mode)) {
    errors.push({ field: 'distribution_mode', message: 'must be broadcast, direct, or delegate' });
  }
}

// target_principal validation
if (e.target_principal !== undefined) {
  if (typeof e.target_principal !== 'string' || !DID_RE.test(e.target_principal)) {
    errors.push({ field: 'target_principal', message: 'must be valid DID (did:mf:<name>)' });
  }
}

// Cross-field: direct/delegate requires target_principal
if ((e.distribution_mode === 'direct' || e.distribution_mode === 'delegate') && !e.target_principal) {
  errors.push({ field: 'target_principal', message: 'required when distribution_mode is direct or delegate' });
}
```

Update `allowedFields` set:
```typescript
const allowedFields = new Set([
  // ... existing ...
  'requirements', 'sovereignty_required', 'deadline', 'distribution_mode', 'target_principal'
]);
```

### Phase 4: JCS Canonical Inclusion (~15 min)

**Files:** `src/identity/canonicalize.ts`

Add task routing fields to `SIGNABLE_FIELDS`:

```typescript
const SIGNABLE_FIELDS = new Set([
  "id",
  "source",
  "type",
  "timestamp",
  "sovereignty",
  "payload",
  "signed_by",
  // Task routing fields (F-021)
  "requirements",
  "sovereignty_required",
  "deadline",
  "distribution_mode",
  "target_principal",
]);
```

Note: `requirements` array is sorted lexicographically by `canonicalStringify()` already.

### Phase 5: Exports (~5 min)

**Files:** `src/index.ts`

Add to type exports:
```typescript
export type {
  // ... existing ...
  SovereigntyRequirement,
  DistributionMode,
} from './types';
```

### Phase 6: Tests (~60 min)

**Files:** `src/envelope.test.ts`

Test structure following existing patterns:

```typescript
describe('validateEnvelope — task routing fields', () => {
  // Backwards compatibility
  it('accepts envelope without task routing fields');
  
  // requirements
  it('accepts valid requirements array');
  it('accepts empty requirements array');
  it('rejects requirements exceeding 10 elements');
  it('rejects invalid capability tag pattern');
  it('rejects non-string requirement');
  it('rejects non-array requirements');
  
  // sovereignty_required
  it('accepts valid sovereignty_required values');
  it('rejects invalid sovereignty_required');
  
  // deadline
  it('accepts valid ISO-8601 deadline');
  it('rejects invalid deadline format');
  
  // distribution_mode
  it('accepts broadcast/direct/delegate');
  it('rejects invalid distribution_mode');
  
  // target_principal
  it('accepts valid DID target_principal');
  it('rejects invalid DID format');
  
  // Cross-field
  it('rejects direct without target_principal');
  it('rejects delegate without target_principal');
  it('accepts broadcast with target_principal (warning only)');
  it('accepts broadcast without target_principal');
});

describe('createEnvelope — task routing fields', () => {
  it('includes requirements when provided');
  it('omits requirements when empty');
  it('includes all distribution mode combinations');
});

describe('JCS signing — task routing fields', () => {
  it('includes task routing fields in signature');
  it('requirements array sorted in canonical form');
});
```

### Phase 7: Test Fixtures (~20 min)

**Files:** `src/fixtures/task-envelopes.ts` (new)

Create validated example envelopes from spec:

```typescript
export const broadcastTaskEnvelope: MyelinEnvelope = { /* from spec */ };
export const directTaskEnvelope: MyelinEnvelope = { /* from spec */ };
export const delegateTaskEnvelope: MyelinEnvelope = { /* from spec */ };
```

## File Structure

```
src/
├── types.ts              # [EDIT] Add SovereigntyRequirement, DistributionMode, extend interfaces
├── envelope.ts           # [EDIT] Update createEnvelope, validateEnvelope
├── envelope.test.ts      # [EDIT] Add task routing test suites
├── identity/
│   └── canonicalize.ts   # [EDIT] Add fields to SIGNABLE_FIELDS
├── fixtures/
│   └── task-envelopes.ts # [NEW] Example envelope fixtures
└── index.ts              # [EDIT] Export new types
```

## Dependencies

| Dependency | Status | Notes |
|------------|--------|-------|
| `DID_RE` from identity/types | Exists | Import into envelope.ts for target_principal |
| JCS implementation | Exists | canonicalize.ts already handles array sorting |
| Bun test runner | Exists | No changes |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking change to validation | High | All new fields optional; additionalProperties whitelist extended |
| JCS field ordering | Medium | Test that requirements array is sorted in canonical output |
| Cross-field validation complexity | Low | Clear error messages; test all combinations |
| Future field additions | Low | Pattern established; easy to extend |

## Success Criteria Mapping

| Spec Criterion | Phase | Verification |
|----------------|-------|--------------|
| Types exported from `@the-metafactory/myelin` | P1, P5 | `bun run build` succeeds |
| `validateEnvelope()` updated | P3 | Test suite passes |
| Default behavior documented | P3 | Inline comments + tests |
| Cross-field validation | P3 | Specific test cases |
| JCS canonical inclusion | P4 | Signing test with task routing fields |
| Per-mode examples validated | P7 | Fixture tests pass validation |

## Estimated Effort

| Phase | Effort |
|-------|--------|
| P1: Types | 30 min |
| P2: Creation | 20 min |
| P3: Validation | 45 min |
| P4: JCS | 15 min |
| P5: Exports | 5 min |
| P6: Tests | 60 min |
| P7: Fixtures | 20 min |
| **Total** | **~3.5 hours** |
