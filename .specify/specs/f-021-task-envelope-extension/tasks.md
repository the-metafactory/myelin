# Implementation Tasks: Task Envelope Extension (F-021)

## Progress Tracking

| Task | Status | Notes |
|------|--------|-------|
| T-1.1 | ☐ | Type definitions |
| T-2.1 | ☐ | createEnvelope update |
| T-2.2 | ☐ | Validation constants |
| T-2.3 | ☐ | Field validations |
| T-2.4 | ☐ | Cross-field validation |
| T-2.5 | ☐ | allowedFields update |
| T-3.1 | ☐ | JCS SIGNABLE_FIELDS |
| T-3.2 | ☐ | Type exports |
| T-4.1 | ☐ | Backwards compat tests |
| T-4.2 | ☐ | Requirements validation tests |
| T-4.3 | ☐ | Enum validation tests |
| T-4.4 | ☐ | Cross-field tests |
| T-4.5 | ☐ | JCS signing tests |
| T-4.6 | ☐ | createEnvelope tests |
| T-5.1 | ☐ | Test fixtures |

---

## Group 1: Foundation

### T-1.1: Add task routing type definitions [T]
- **File:** `src/types.ts`
- **Test:** `src/types.test.ts` (type-level only, no runtime tests)
- **Dependencies:** none
- **Description:** Add to existing types.ts:
  - `SovereigntyRequirement` type alias: `'open' | 'selective' | 'strict'`
  - `DistributionMode` type alias: `'broadcast' | 'direct' | 'delegate'`
  - Extend `MyelinEnvelope` interface with 5 optional fields:
    - `requirements?: string[]`
    - `sovereignty_required?: SovereigntyRequirement`
    - `deadline?: string`
    - `distribution_mode?: DistributionMode`
    - `target_principal?: string`
  - Extend `CreateEnvelopeInput` interface with same 5 fields

---

## Group 2: Core Implementation

### T-2.1: Update createEnvelope for task routing fields [P with T-2.2]
- **File:** `src/envelope.ts` (line ~21-32)
- **Test:** `src/envelope.test.ts`
- **Dependencies:** T-1.1
- **Description:** Modify `createEnvelope()` to pass through task routing fields using existing sparse object pattern:
  ```typescript
  ...(input.requirements?.length ? { requirements: input.requirements } : {}),
  ...(input.sovereignty_required ? { sovereignty_required: input.sovereignty_required } : {}),
  ...(input.deadline ? { deadline: input.deadline } : {}),
  ...(input.distribution_mode ? { distribution_mode: input.distribution_mode } : {}),
  ...(input.target_principal ? { target_principal: input.target_principal } : {}),
  ```

### T-2.2: Add validation patterns and constants [P with T-2.1]
- **File:** `src/envelope.ts` (near line ~12-19)
- **Test:** `src/envelope.test.ts`
- **Dependencies:** T-1.1
- **Description:** Add at top of file:
  ```typescript
  const CAPABILITY_TAG_RE = /^[a-z][a-z0-9-]{0,63}$/;
  const SOVEREIGNTY_REQUIREMENTS = new Set(['open', 'selective', 'strict']);
  const DISTRIBUTION_MODES = new Set(['broadcast', 'direct', 'delegate']);
  const MAX_REQUIREMENTS = 10;
  ```
  Note: `DID_RE` already imported from `./identity/types`

### T-2.3: Implement task routing field validations [T]
- **File:** `src/envelope.ts` (inside `validateEnvelope()`, after line ~136)
- **Test:** `src/envelope.test.ts`
- **Dependencies:** T-2.2
- **Description:** Add validation blocks for each field before the `allowedFields` check:
  1. `requirements`: array, max 10, each string matching `CAPABILITY_TAG_RE`
  2. `sovereignty_required`: must be in `SOVEREIGNTY_REQUIREMENTS` set
  3. `deadline`: string matching `ISO8601_RE` (already defined)
  4. `distribution_mode`: must be in `DISTRIBUTION_MODES` set
  5. `target_principal`: string matching `DID_RE` (already imported)

### T-2.4: Implement cross-field validation [T]
- **File:** `src/envelope.ts` (inside `validateEnvelope()`, after field validations)
- **Test:** `src/envelope.test.ts`
- **Dependencies:** T-2.3
- **Description:** Add cross-field rule:
  ```typescript
  if ((e.distribution_mode === 'direct' || e.distribution_mode === 'delegate') && !e.target_principal) {
    errors.push({ field: 'target_principal', message: 'required when distribution_mode is direct or delegate' });
  }
  ```

### T-2.5: Update allowedFields set
- **File:** `src/envelope.ts` (line ~138)
- **Test:** `src/envelope.test.ts`
- **Dependencies:** T-2.3
- **Description:** Add to existing `allowedFields` Set:
  - `'requirements'`
  - `'sovereignty_required'`
  - `'deadline'`
  - `'distribution_mode'`
  - `'target_principal'`

---

## Group 3: Integration

### T-3.1: Update JCS SIGNABLE_FIELDS [P with T-3.2]
- **File:** `src/identity/canonicalize.ts` (line ~12-20)
- **Test:** `src/identity/canonicalize.test.ts`
- **Dependencies:** T-1.1
- **Description:** Add task routing fields to `SIGNABLE_FIELDS` Set:
  ```typescript
  "requirements",
  "sovereignty_required",
  "deadline",
  "distribution_mode",
  "target_principal",
  ```
  Note: `canonicalStringify()` already sorts arrays lexicographically.

### T-3.2: Export new types [P with T-3.1]
- **File:** `src/index.ts` (line ~10-18)
- **Test:** Build verification
- **Dependencies:** T-1.1
- **Description:** Add to type exports:
  ```typescript
  SovereigntyRequirement,
  DistributionMode,
  ```

---

## Group 4: Testing

### T-4.1: Test backwards compatibility [T]
- **File:** `src/envelope.test.ts`
- **Test:** Self-contained
- **Dependencies:** T-2.5
- **Description:** Add test suite `describe('validateEnvelope — backwards compatibility')`:
  - `it('accepts envelope without task routing fields')` — existing valid envelope passes

### T-4.2: Test requirements validation [T] [P with T-4.3, T-4.6]
- **File:** `src/envelope.test.ts`
- **Test:** Self-contained
- **Dependencies:** T-2.5
- **Description:** Add test suite `describe('validateEnvelope — requirements')`:
  - `it('accepts valid requirements array')`
  - `it('accepts empty requirements array')`
  - `it('rejects requirements exceeding 10 elements')`
  - `it('rejects invalid capability tag pattern')` — uppercase, spaces, starts with number
  - `it('rejects non-string requirement')`
  - `it('rejects non-array requirements')`

### T-4.3: Test enum field validations [T] [P with T-4.2, T-4.6]
- **File:** `src/envelope.test.ts`
- **Test:** Self-contained
- **Dependencies:** T-2.5
- **Description:** Add test suites:
  - `describe('validateEnvelope — sovereignty_required')`:
    - `it('accepts open, selective, strict')`
    - `it('rejects invalid value')`
  - `describe('validateEnvelope — distribution_mode')`:
    - `it('accepts broadcast, direct, delegate')`
    - `it('rejects invalid value')`
  - `describe('validateEnvelope — deadline')`:
    - `it('accepts valid ISO-8601 datetime')`
    - `it('rejects invalid format')`
  - `describe('validateEnvelope — target_principal')`:
    - `it('accepts valid DID')`
    - `it('rejects invalid DID format')`

### T-4.4: Test cross-field validation [T]
- **File:** `src/envelope.test.ts`
- **Test:** Self-contained
- **Dependencies:** T-2.4
- **Description:** Add test suite `describe('validateEnvelope — cross-field rules')`:
  - `it('rejects direct without target_principal')`
  - `it('rejects delegate without target_principal')`
  - `it('accepts broadcast with target_principal')` — warning only, not error
  - `it('accepts broadcast without target_principal')`
  - `it('accepts direct with target_principal')`
  - `it('accepts delegate with target_principal')`

### T-4.5: Test JCS signing with task routing fields [T]
- **File:** `src/identity/canonicalize.test.ts`
- **Test:** Self-contained
- **Dependencies:** T-3.1
- **Description:** Add test suite `describe('canonicalizeForSigning — task routing fields')`:
  - `it('includes requirements in canonical output')`
  - `it('sorts requirements array lexicographically')`
  - `it('includes sovereignty_required, deadline, distribution_mode, target_principal')`
  - `it('excludes undefined task routing fields')`

### T-4.6: Test createEnvelope with task routing fields [T] [P with T-4.2, T-4.3]
- **File:** `src/envelope.test.ts`
- **Test:** Self-contained
- **Dependencies:** T-2.1
- **Description:** Add test suite `describe('createEnvelope — task routing fields')`:
  - `it('includes requirements when provided')`
  - `it('omits requirements when empty array')`
  - `it('omits requirements when undefined')`
  - `it('includes all distribution mode fields')`
  - `it('omits undefined task routing fields')`

---

## Group 5: Fixtures

### T-5.1: Create validated test fixtures [T]
- **File:** `src/fixtures/task-envelopes.ts` (NEW)
- **Test:** `src/fixtures/task-envelopes.test.ts` (NEW)
- **Dependencies:** T-2.5, T-4.1
- **Description:** Create fixture file with:
  ```typescript
  export const broadcastTaskEnvelope: MyelinEnvelope = { /* from spec */ };
  export const directTaskEnvelope: MyelinEnvelope = { /* from spec */ };
  export const delegateTaskEnvelope: MyelinEnvelope = { /* from spec */ };
  ```
  Test file validates each fixture passes `validateEnvelope()`.

---

## Execution Order

```
Phase 1: Foundation
  T-1.1 (types — no deps)

Phase 2: Core (parallel where marked)
  T-2.1 ─┬─ (createEnvelope)
  T-2.2 ─┘  (constants)
  T-2.3 ──── (field validations, needs T-2.2)
  T-2.4 ──── (cross-field, needs T-2.3)
  T-2.5 ──── (allowedFields, needs T-2.3)

Phase 3: Integration (parallel)
  T-3.1 ─┬─ (JCS)
  T-3.2 ─┘  (exports)

Phase 4: Testing (parallel once deps met)
  T-4.1 ──── (backwards compat)
  T-4.2 ─┬─ (requirements tests)
  T-4.3 ─┼─ (enum tests)
  T-4.6 ─┘  (createEnvelope tests)
  T-4.4 ──── (cross-field tests)
  T-4.5 ──── (JCS tests)

Phase 5: Fixtures
  T-5.1 ──── (fixtures)
```

---

## Estimated Effort

| Phase | Tasks | Time |
|-------|-------|------|
| Foundation | T-1.1 | 20 min |
| Core | T-2.1–T-2.5 | 45 min |
| Integration | T-3.1–T-3.2 | 15 min |
| Testing | T-4.1–T-4.6 | 60 min |
| Fixtures | T-5.1 | 20 min |
| **Total** | 15 tasks | **~2.5 hours** |
