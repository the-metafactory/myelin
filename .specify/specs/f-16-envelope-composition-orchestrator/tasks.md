# Implementation Tasks: F-16 — Envelope Composition Orchestrator

## Progress Tracking

| Task | Status | Notes |
|------|--------|-------|
| T-1.1 | ☐ | Core types |
| T-1.2 | ☐ | Event types |
| T-1.3 | ☐ | Module exports |
| T-2.1 | ☑ | Ajv setup — PR feat/f-16-schema |
| T-2.2 | ☑ | Schema compatibility — PR feat/f-16-schema |
| T-2.3 | ☑ | Runtime validation — PR feat/f-16-schema |
| T-3.1 | ☑ | Graph utilities — PR feat/f-16-graph |
| T-3.2 | ☐ | Workflow loader |
| T-4.1 | ☐ | Lifecycle emitter |
| T-4.2 | ☐ | Stream config |
| T-5.1 | ☑ | Store interface — PR feat/f-16-store |
| T-5.2 | ☑ | Memory store — PR feat/f-16-store |
| T-6.1 | ☑ | Orchestrator core — PR feat/f-16-orchestrator-core |
| T-6.2 | ☑ | Step dispatch — PR feat/f-16-orchestrator-core |
| T-6.3 | ☑ | Timeout handling — PR feat/f-16-timeout |
| T-7.1 | ☑ | Fan-out — PR feat/f-16-fan-out |
| T-7.2 | ☑ | Fan-in — PR feat/f-16-fan-in |
| T-8.1 | ☑ | Recovery — PR feat/f-16-recovery |
| T-8.2 | ☐ | Integration tests |
| T-8.3 | ☐ | Root exports |

---

## Group 1: Foundation — Types & Interfaces

### T-1.1: Define core workflow types [T]
- **File:** `src/composition/types.ts`
- **Test:** `src/composition/types.test.ts`
- **Dependencies:** none
- **Description:** Define `WorkflowDefinition`, `WorkflowStep`, `FailureStrategy`, `DistributionMode` reuse from dispatch. Include `WorkflowExecution`, `StepResult`, `StepError`, `ExecutionStatus`, `StepStatus`. Add JSON Schema type import.

**Acceptance:**
- All interfaces match spec §Workflow Definition Schema
- Types for execution state match §Workflow Execution
- Compiles with strict TypeScript

### T-1.2: Define lifecycle event types [T]
- **File:** `src/composition/types.ts` (extend)
- **Test:** `src/composition/types.test.ts` (extend)
- **Dependencies:** T-1.1
- **Description:** Add `WorkflowLifecycleState`, `BaseWorkflowEvent`, `WorkflowStartedEvent`, `WorkflowStepStartedEvent`, `WorkflowStepCompletedEvent`, `WorkflowStepFailedEvent`, `WorkflowCompletedEvent`, `WorkflowFailedEvent`, `WorkflowAbortedEvent`.

**Acceptance:**
- Event types match spec §Lifecycle Events
- Extends `BaseWorkflowEvent` pattern from dispatch lifecycle

### T-1.3: Create module index [P]
- **File:** `src/composition/index.ts`
- **Test:** none (export only)
- **Dependencies:** T-1.1, T-1.2
- **Description:** Export all types from composition module. Will be extended as implementation progresses.

---

## Group 2: Schema Validation

### T-2.1: Install and configure Ajv [T]
- **File:** `src/composition/schema.ts`
- **Test:** `src/composition/schema.test.ts`
- **Dependencies:** T-1.1
- **Description:** 
  1. Add `ajv@^8.17.1` and `ajv-formats@^3.0.1` to package.json
  2. Create Ajv instance configured for JSON Schema draft 2020-12
  3. Export `compileSchema()` function returning precompiled validator

**Acceptance:**
- `bun install` succeeds
- Ajv compiles basic schemas
- Format validators (date-time, email, uri) available

### T-2.2: Implement schema compatibility check [T]
- **File:** `src/composition/schema.ts` (extend)
- **Test:** `src/composition/schema.test.ts` (extend)
- **Dependencies:** T-2.1
- **Description:** Implement `validateSchemaCompatibility(outputSchema, inputSchema)`. Output schema must satisfy input schema requirements. Handle undefined schemas as "any". Return `SchemaValidationResult` with errors.

**Tests:**
- Compatible object schemas pass
- Missing required field detected
- Type mismatch detected
- Undefined output + defined input = fail
- Undefined input = always pass
- Both undefined = pass

### T-2.3: Implement runtime data validation [T] [P with T-2.2]
- **File:** `src/composition/schema.ts` (extend)
- **Test:** `src/composition/schema.test.ts` (extend)
- **Dependencies:** T-2.1
- **Description:** Implement `validateData(data, schema)` for runtime step output validation. Return `SchemaValidationResult` with JSON pointer paths for errors.

**Tests:**
- Valid data passes
- Invalid type rejected
- Missing required field rejected
- Additional properties handling (per schema setting)

---

## Group 3: Workflow Loader

### T-3.1: Implement graph utilities [T]
- **File:** `src/composition/graph.ts`
- **Test:** `src/composition/graph.test.ts`
- **Dependencies:** T-1.1
- **Description:**
  1. `buildStepGraph(definition)` → `StepGraph` with `steps`, `children`, `parents` maps. Defensive: guards against duplicate step IDs and duplicate edges within a single `next` array.
  2. `detectCycle(graph)` → offending cycle path `string[]` (DFS, white/gray/black) or `null` when acyclic. Path return strictly more useful than boolean — orchestrator + loader both want the path for error reporting.
  3. `findEntrySteps(graph)` / `findTerminalSteps(graph)` → zero in/out-degree IDs.
  4. `findUnreachableSteps(graph, entries[])` → step IDs not reachable from any entry. Loader composes this with `detectCycle` for full connectivity validation (no separate `validateGraphConnectivity` helper needed).
  5. `topologicalSort(graph)` → discovery-order step IDs (Kahn's algorithm), `null` on cyclic input.
  6. `reachableFrom(graph, start)` → transitive closure, cycle-safe.

**Tests:**
- Linear graph: no cycles, all reachable, one terminal.
- Fan-out / fan-in / diamond: no cycles, proper terminals, parents merged.
- Cycle detection — direct self-loop, A↔B, embedded long cycle, disconnected sub-cycle.
- Disconnected step detected via `findUnreachableSteps`.
- Cycle path assertions use `toEqual` (not just `not.toBeNull`) to lock reconstruction contract.
- Determinism: same definition → same topo order.

### T-3.2: Implement workflow loader [T]
- **File:** `src/composition/loader.ts`
- **Test:** `src/composition/loader.test.ts`
- **Dependencies:** T-2.2, T-3.1
- **Description:**
  1. `loadWorkflow(definition, options?)` → `LoadWorkflowResult`
  2. Validate definition structure (required fields, constraints)
  3. Validate step graph using T-3.1 utilities
  4. Validate schema compatibility between all adjacent step pairs
  5. Precompile Ajv validators for each step's schemas
  6. Return `ExecutableWorkflow` with compiled graph and validators

**Tests:**
- Valid linear workflow loads successfully
- Valid fan-out/fan-in workflow loads
- Missing `entry_step` rejected
- Cyclic workflow rejected
- Schema mismatch between adjacent steps rejected with clear error
- Missing step ID in `next` rejected
- Fan-out > 10 branches rejected

---

## Group 4: Lifecycle Events

### T-4.1: Implement workflow lifecycle emitter [T]
- **File:** `src/composition/lifecycle.ts`
- **Test:** `src/composition/lifecycle.test.ts`
- **Dependencies:** T-1.2
- **Description:**
  1. `deriveWorkflowLifecycleSubject(org, state)` → `local.{org}.workflow.{state}`
  2. `WorkflowLifecycleEmitter` class (pattern from dispatch/lifecycle.ts)
  3. Methods: `started()`, `stepStarted()`, `stepCompleted()`, `stepFailed()`, `completed()`, `failed()`, `aborted()`
  4. Each method creates properly typed envelope and publishes

**Tests:**
- Subject derivation correct for all states
- Event payloads match type definitions
- Correlation ID preserved across all events
- Timestamp auto-generated

### T-4.2: Extend EVENTS stream config [T] [P with T-4.1]
- **File:** `src/composition/stream.ts`
- **Test:** `src/composition/stream.test.ts`
- **Dependencies:** T-1.2
- **Description:**
  1. Export `getWorkflowEventsSubjects()` → workflow subject patterns
  2. Document integration with existing EVENTS stream (extends F-020 config)

**Subjects:**
```
local.{org}.workflow.started
local.{org}.workflow.step.started
local.{org}.workflow.step.completed
local.{org}.workflow.step.failed
local.{org}.workflow.completed
local.{org}.workflow.failed
local.{org}.workflow.aborted
```

---

## Group 5: Execution Store

### T-5.1: Define store interface [T]
- **File:** `src/composition/execution-store.ts`
- **Test:** `src/composition/execution-store.test.ts`
- **Dependencies:** T-1.1
- **Description:** Define `WorkflowExecutionStore` interface:
  - `put(execution)` → Promise<void>
  - `get(execution_id)` → Promise<WorkflowExecution | null>
  - `listRunning()` → Promise<WorkflowExecution[]>
  - `delete(execution_id)` → Promise<void>
  - `watch()` → AsyncIterable<{operation, execution}>
  - `close()` → Promise<void>

### T-5.2: Implement in-memory store [T]
- **File:** `src/composition/memory-execution-store.ts`
- **Test:** `src/composition/memory-execution-store.test.ts`
- **Dependencies:** T-5.1
- **Description:** `InMemoryWorkflowExecutionStore` for testing:
  - Map-backed storage
  - Filter by status for `listRunning()`
  - EventEmitter-based watch

**Tests:**
- Put/get roundtrip
- List running filters correctly
- Delete removes entry
- Watch emits on put/delete

---

## Group 6: Orchestrator Core

### T-6.1: Create orchestrator factory [T]
- **File:** `src/composition/orchestrator.ts`
- **Test:** `src/composition/orchestrator.test.ts`
- **Dependencies:** T-4.1, T-5.2
- **Description:**
  1. `OrchestratorOptions` interface
  2. `createOrchestrator(options)` → `WorkflowOrchestrator`
  3. Internal state management for active executions
  4. Methods: `execute()`, `abort()`, `recover()`, `close()`
  5. Create execution record on start, update on each step

**Tests:**
- Factory creates valid orchestrator
- Options validation (required fields)

### T-6.2: Implement step dispatch loop [T]
- **File:** `src/composition/orchestrator.ts` (extend)
- **Test:** `src/composition/orchestrator.test.ts` (extend)
- **Dependencies:** T-6.1, T-3.2
- **Description:**
  1. `execute(input)` starts workflow, emits `workflow.started`
  2. Resolve entry step from graph
  3. For each step:
     - Emit `workflow.step.started`
     - Publish to `local.{org}.tasks.{capability}` with `correlation_id`
     - Wait for `dispatch.task.completed` or `dispatch.task.failed`
     - Validate output against next step's input schema
     - Emit `workflow.step.completed` or `workflow.step.failed`
  4. On completion: emit `workflow.completed`
  5. On failure: emit `workflow.failed` with `failed_step`

**Tests:**
- Two-step linear workflow completes
- Correlation ID consistent across all steps
- Step output validated before next step
- Step failure aborts workflow (default)
- Final result includes all step outputs

### T-6.3: Implement timeout handling [T]
- **File:** `src/composition/orchestrator.ts` (extend)
- **Test:** `src/composition/orchestrator.test.ts` (extend)
- **Dependencies:** T-6.2
- **Description:**
  1. Per-step timeout from definition or default (5 min)
  2. Workflow-level timeout from definition or default (30 min)
  3. Use AbortController for cancellation
  4. On timeout: emit `workflow.step.failed` with `code: "timeout"`

**Tests:**
- Step timeout triggers failure
- Workflow timeout triggers abort
- Timeout configurable per step
- Racing completion vs timeout

---

## Group 7: Fan-Out / Fan-In

### T-7.1: Implement fan-out execution [T]
- **File:** `src/composition/orchestrator.ts` (extend)
- **Test:** `src/composition/fan.test.ts`
- **Dependencies:** T-6.2
- **Description:**
  1. When step has `fan_out: string[]`, spawn parallel branches
  2. All branches share same `correlation_id`
  3. Track active branches in execution state
  4. Emit `workflow.step.started` for each branch
  5. Dispatch all tasks atomically before awaiting any

**Tests:**
- Three-branch fan-out spawns three parallel executions
- All branches get same correlation_id
- Step events emitted for each branch
- Partial failure: one branch fails, others complete

### T-7.2: Implement fan-in aggregation [T]
- **File:** `src/composition/orchestrator.ts` (extend)
- **Test:** `src/composition/fan.test.ts` (extend)
- **Dependencies:** T-7.1
- **Description:**
  1. Track `pending_fan_in` in execution state
  2. When multiple steps declare same `next`, wait for all
  3. Aggregate results as array ordered by `step_id`
  4. Pass `{ branches: [...] }` to converging step

**Tests:**
- Fan-in waits for all branches
- Aggregated results in step_id order
- Converging step receives all branch outputs
- One branch timeout = workflow failure

---

## Group 8: Recovery & Integration

### T-8.1: Implement orchestrator recovery [T]
- **File:** `src/composition/orchestrator.ts` (extend)
- **Test:** `src/composition/orchestrator.test.ts` (extend)
- **Dependencies:** T-5.2, T-6.2
- **Description:**
  1. `recover()` loads running executions from store
  2. For each: determine current step(s) from state
  3. Re-subscribe to task completion events
  4. Resume from last checkpoint (may re-dispatch; agents must be idempotent)
  5. Handle executions that timed out during downtime

**Tests:**
- Recovery loads running executions
- Timed-out executions marked failed
- Active executions resume

### T-8.2: Create integration tests [T]
- **File:** `src/composition/integration.test.ts`
- **Test:** (this is the test)
- **Dependencies:** T-6.2, T-7.2, T-8.1
- **Description:** End-to-end tests with mock transport:
  1. Linear workflow: triage → code-review → merge-check
  2. Fan-out workflow: triage → [code-review, security, docs] → merge-gate
  3. Schema mismatch at load time
  4. Step timeout handling
  5. Step failure propagation

**Scenarios from spec:**
- Scenario 1: Sequential Two-Agent Pipeline
- Scenario 2: Schema Mismatch Detection
- Scenario 3: Fan-Out with Correlation Tracking
- Scenario 4: Step Failure Propagation
- Scenario 5: Timeout on Workflow Step

### T-8.3: Add root exports [P]
- **File:** `src/index.ts` (extend)
- **File:** `src/composition/index.ts` (finalize)
- **Test:** none (export only)
- **Dependencies:** T-8.2
- **Description:**
  1. Export all public APIs from `src/composition/index.ts`
  2. Add composition exports to `src/index.ts`
  3. Verify all types, functions, classes exported

**Exports:**
- Types: `WorkflowDefinition`, `WorkflowStep`, `WorkflowExecution`, `StepResult`, `StepError`, `ExecutableWorkflow`, all event types
- Functions: `loadWorkflow`, `createOrchestrator`, `validateSchemaCompatibility`, `validateData`
- Classes: `InMemoryWorkflowExecutionStore`

---

## Execution Order

```
Phase 1 (Foundation):
  T-1.1 → T-1.2 → T-1.3

Phase 2 (Schema):
  T-2.1 → T-2.2 + T-2.3 (parallel)

Phase 3 (Loader):
  T-3.1 + T-2.2 → T-3.2

Phase 4 (Lifecycle):
  T-4.1 + T-4.2 (parallel, after T-1.2)

Phase 5 (Store):
  T-5.1 → T-5.2 (can parallel with Phase 4)

Phase 6 (Orchestrator):
  T-6.1 (after T-4.1, T-5.2) → T-6.2 → T-6.3

Phase 7 (Fan-out/Fan-in):
  T-7.1 → T-7.2 (after T-6.2)

Phase 8 (Integration):
  T-8.1 + T-8.2 (after T-7.2) → T-8.3
```

---

## Dependency Graph

```
T-1.1 ─────────┬─────────────────────────────────────────────────────┐
               │                                                      │
               ▼                                                      │
            T-1.2 ────────────────┬───────────────────────────────┐   │
               │                  │                               │   │
               ▼                  ▼                               ▼   │
            T-1.3              T-4.1 ◄────────────────┐        T-4.2  │
               │                  │                   │               │
               │                  │                   │               │
T-2.1 ◄────────┘                  │                   │               │
   │                              │                   │               │
   ├────────┬─────────┐           │                   │               │
   ▼        ▼         │           │                   │               │
T-2.2    T-2.3        │           │                   │               │
   │                  │           │                   │               │
   │                  │           │                   │               │
   ▼                  │           │                   │               │
T-3.1 ◄───────────────┘           │                   │               │
   │                              │                   │               │
   ▼                              │                   │               │
T-3.2                             │                   │               │
   │                              │                   │               │
   │                              │                   │               │
   │    T-5.1 ◄───────────────────┼───────────────────┼───────────────┘
   │       │                      │                   │
   │       ▼                      │                   │
   │    T-5.2 ────────────────────┤                   │
   │       │                      │                   │
   │       │                      │                   │
   │       ▼                      ▼                   │
   │    T-6.1 ◄───────────────────┘                   │
   │       │                                          │
   │       ▼                                          │
   └────► T-6.2                                       │
            │                                         │
            ▼                                         │
         T-6.3                                        │
            │                                         │
            ▼                                         │
         T-7.1                                        │
            │                                         │
            ▼                                         │
         T-7.2                                        │
            │                                         │
            ├─────────────────────────────────────────┘
            ▼
     T-8.1 + T-8.2
            │
            ▼
         T-8.3
```

---

## Estimated Effort

| Group | Tasks | Hours | Parallelizable |
|-------|-------|-------|----------------|
| Foundation | T-1.1, T-1.2, T-1.3 | 3-4 | T-1.3 |
| Schema | T-2.1, T-2.2, T-2.3 | 4-5 | T-2.2, T-2.3 |
| Loader | T-3.1, T-3.2 | 4-5 | - |
| Lifecycle | T-4.1, T-4.2 | 3-4 | T-4.1, T-4.2 |
| Store | T-5.1, T-5.2 | 3-4 | - |
| Orchestrator | T-6.1, T-6.2, T-6.3 | 6-8 | - |
| Fan-out/Fan-in | T-7.1, T-7.2 | 4-5 | - |
| Integration | T-8.1, T-8.2, T-8.3 | 4-5 | T-8.1, T-8.2 |
| **Total** | **20** | **32-40** | **8** |

---

## Critical Path

`T-1.1 → T-2.1 → T-2.2 → T-3.2 → T-6.1 → T-6.2 → T-7.1 → T-7.2 → T-8.2 → T-8.3`

Estimated: 28-32 hours (critical path)

---

## Notes

- **Ajv dependency:** T-2.1 adds new deps; run `bun install` before proceeding
- **Idempotency:** Agents must handle re-dispatch during recovery (documented in T-8.1)
- **KV bucket deferred:** `NatsWorkflowExecutionStore` not in scope; `InMemoryWorkflowExecutionStore` sufficient for v1
- **Retry deferred:** `on_failure: "retry"` parsed but not implemented per plan decision
