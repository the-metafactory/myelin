import type {
  StepError,
  WorkflowDefinition,
  WorkflowExecution,
} from "../types";
import type { ExecuteWorkflowResult } from "../orchestrator";
import type { OrchestratorContext, ResumeMarker } from "./context";
import { checkpoint, emitLifecycle, resultOf } from "./state";
import { ensureSubscribed, executeWithResume } from "./execute";

/**
 * Mark an orphan execution (no resolvable definition / loader
 * throw) as failed in one place. Extracted (cycle-2 N-7) so the
 * `loader threw` and `loader returned undefined` branches don't
 * drift on contract details — error code shape, event ordering
 * (`workflow.recovered` before `workflow.failed`), checkpoint
 * write, retry_count bump. Callers pass in the per-iteration
 * `snap` clone (NOT the original `snapshot` from listRunning),
 * the constructed `err`, and the sweep_id for event correlation.
 */
export async function terminateAsOrphan(
  ctx: OrchestratorContext,
  snap: WorkflowExecution,
  err: StepError,
  sweep_id: string,
): Promise<ExecuteWorkflowResult> {
  await emitLifecycle(
    ctx,
    "workflow.recovered",
    snap.correlation_id,
    snap.workflow_id,
    undefined,
    undefined,
    { retry_count: snap.retry_count + 1, sweep_id },
  );
  snap.status = "failed";
  snap.error = err;
  snap.completed_at = ctx.now().toISOString();
  snap.retry_count += 1;
  await ctx.store.put(checkpoint(ctx, snap));
  await emitLifecycle(
    ctx,
    "workflow.failed",
    snap.correlation_id,
    snap.workflow_id,
    undefined,
    err.message,
    { sweep_id },
  );
  return resultOf(snap);
}

/**
 * T-8.1: reload running workflow executions from the store and
 * resume them. Implements `WorkflowOrchestrator.recover`; see the
 * public interface JSDoc for the single-active-instance and
 * single-call contracts.
 */
export async function recover(ctx: OrchestratorContext): Promise<ExecuteWorkflowResult[]> {
  if (ctx.closed) throw new Error("orchestrator is closed");
  // Pre-checks first so a caller who forgets `definitionLoader`
  // doesn't burn their one recover() attempt on a config bug.
  if (!ctx.definitionLoader) {
    const err = new Error(
      "F-16 orchestrator: recover() requires options.definitionLoader to resolve WorkflowDefinitions by (id, version)",
    ) as Error & { code: string };
    err.code = "validation-failed";
    throw err;
  }
  // Single-call gate. recover() is the post-restart bootstrap
  // hook, not a runtime tool: a second invocation against the
  // same orchestrator would race the first's in-flight resumed
  // executions for the same execution_ids. The single-active-
  // instance constraint (one orchestrator per process at a
  // time) is already documented on WorkflowOrchestrator.recover;
  // this gate enforces it mechanically. Build a fresh
  // orchestrator if you need to recover again.
  //
  // Defer the flip until AFTER ensureSubscribed() succeeds so
  // a transient subscriber failure on the first call doesn't
  // permanently lock the orchestrator out of recovery (cycle-2
  // N-4): the operator can fix the transport and retry without
  // tearing down and rebuilding the orchestrator.
  if (ctx.recoveredOnce) {
    const err = new Error(
      "F-16 orchestrator: recover() has already been called on this orchestrator instance; create a new orchestrator to attempt another recovery sweep",
    ) as Error & { code: string };
    err.code = "validation-failed";
    throw err;
  }
  await ensureSubscribed(ctx);
  ctx.recoveredOnce = true;

  const running = await ctx.store.listRunning();
  const sweep_id = ctx.uuid();
  // Sweep-level audit breadcrumb (cycle-2 N-6). One line per
  // restart sweep gives operators a single-pass answer to
  // "what did this orchestrator boot find and resolve" without
  // having to aggregate workflow.recovered events by hand. The
  // sweep_id is carried on every per-snapshot lifecycle event
  // emitted below for downstream correlation.

  console.info(
    `[F-16] recovery sweep starting: sweep_id=${sweep_id} running=${running.length}`,
  );
  if (running.length === 0) {

    console.info(
      `[F-16] recovery sweep complete: sweep_id=${sweep_id} resumed=0 orphaned=0`,
    );
    return [];
  }

  const loader = ctx.definitionLoader;
  // Sequential rather than Promise.all/allSettled. Sequential
  // iteration keeps the boot-time recovery path simple (no
  // shared marker state to race against) and is bounded by the
  // crash-time `running` count, which the F-16 spec caps at
  // operationally-tractable widths. Per-snapshot try/catch
  // ensures one bad definition / loader fault / unexpected
  // exception in the resumed execute() never stalls the
  // rest of the sweep — the failing run is recorded as a
  // synthetic failed result.
  const results: ExecuteWorkflowResult[] = [];
  let resumedCount = 0;
  let orphanedCount = 0;
  for (const snapshot of running) {
    // Clone the snapshot at the top of each iteration so any
    // mutation we make (status / error / completed_at /
    // retry_count) lives on a caller-owned object, not the
    // store's internal record. The current
    // InMemoryWorkflowExecutionStore happens to clone on
    // listRunning, but a NATS-KV-backed store handing back
    // its internal record would have that record corrupted
    // BEFORE the `store.put` lands (cycle-2 N-3). Defending
    // here removes the implicit "listRunning returns isolated
    // copies" contract dependency.
    const snap = structuredClone(snapshot);
    try {
      let definition: WorkflowDefinition | undefined;
      try {
        definition = await loader(snap.workflow_id, snap.workflow_version);
      } catch (loaderErr) {
        const err: StepError = {
          code: "validation-failed",
          message: `F-16 recovery: definitionLoader threw for workflow_id='${snap.workflow_id}' version='${snap.workflow_version}': ${
            loaderErr instanceof Error ? loaderErr.message : String(loaderErr)
          }`,
        };
        results.push(await terminateAsOrphan(ctx, snap, err, sweep_id));
        orphanedCount += 1;
        continue;
      }
      if (!definition) {
        const err: StepError = {
          code: "validation-failed",
          message: `F-16 recovery: no definition for workflow_id='${snap.workflow_id}' version='${snap.workflow_version}'`,
        };
        results.push(await terminateAsOrphan(ctx, snap, err, sweep_id));
        orphanedCount += 1;
        continue;
      }
      // structuredClone of completed_steps / pending_fan_in
      // is correctness-load-bearing: any mutation
      // executeWithResume makes (extending completed_steps
      // with newly run steps) is isolated from the snap we
      // hold here (which we also persist as the failed
      // record in the catch branch below). retry_count is
      // incremented here so every recovery sweep visibly
      // bumps it in the new execution record.
      //
      // Boot-budget scaling note (cycle-2 N-10): this clone
      // is per-snapshot synchronous work. For a wide
      // recovery — K snapshots × M completed_steps × KB-
      // sized outputs — it can become a measurable cold-
      // start cost. Today the cap on K is operational (one
      // orchestrator process per workflow stream) so this is
      // acceptable; revisit if recovery time becomes a
      // measurable SLO item.
      const marker: ResumeMarker = {
        execution_id: snap.execution_id,
        retry_count: snap.retry_count + 1,
        started_at: snap.started_at,
        completed_steps: structuredClone(snap.completed_steps),
        pending_fan_in: structuredClone(snap.pending_fan_in),
      };
      results.push(
        await executeWithResume(
          ctx,
          {
            definition,
            input: snap.input,
            correlation_id: snap.correlation_id,
          },
          marker,
          sweep_id,
        ),
      );
      resumedCount += 1;
    } catch (perSnapshotErr) {
      // Any unexpected failure inside the resumed
      // executeWithResume call surfaces as a synthetic failure
      // rather than aborting the whole recovery sweep. The
      // snapshot is left in `running` for a future operator-
      // initiated resweep (after fixing whatever caused the
      // throw). structuredClone matches the marker / N-2
      // discipline so a future caller mutating `results`
      // doesn't reach back into the store's snapshot.
      results.push({
        execution_id: snap.execution_id,
        correlation_id: snap.correlation_id,
        status: "failed",
        error: {
          code: "validation-failed",
          message: `F-16 recovery: unexpected error resuming execution_id='${snap.execution_id}': ${
            perSnapshotErr instanceof Error ? perSnapshotErr.message : String(perSnapshotErr)
          }`,
        },
        results: structuredClone(snap.completed_steps),
      });
      orphanedCount += 1;
    }
  }

  console.info(
    `[F-16] recovery sweep complete: sweep_id=${sweep_id} resumed=${resumedCount} orphaned=${orphanedCount}`,
  );
  return results;
}
