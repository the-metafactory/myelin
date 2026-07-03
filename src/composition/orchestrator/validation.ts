import type { StepGraph } from "../graph";
import type { FailureStrategy, StepError, WorkflowDefinition } from "../types";
import type { OrchestratorContext } from "./context";

/**
 * Pre-execution workflow validation guards ([F-16]). Pure functions over the
 * workflow definition / step graph — no orchestrator state mutated, no bus
 * traffic. Extracted to their own module (Sage review #219) so `execute.ts`
 * imports them here rather than from `recovery.ts`, which removes the
 * execute ↔ recovery import cycle and stops these generic guards reading as
 * recovery-owned.
 */

export function detectExcessiveFanWidth(
  ctx: OrchestratorContext,
  graph: StepGraph,
): StepError | null {
  for (const [stepId, children] of graph.children) {
    if (children.length > ctx.maxFanOutWidth) {
      return {
        code: "validation-failed",
        message: `F-16 orchestrator: step '${stepId}' fans out to ${children.length} children, exceeds MAX_FANOUT_WIDTH=${ctx.maxFanOutWidth}`,
      };
    }
  }
  // Symmetric fan-in cap: a step with N parents pulls N entries
  // into the barrier's outputs Map + aggregated payload. The
  // fan-out cap is the implicit natural ceiling in practice, but
  // a step with many parents could still be assembled from
  // deeper graphs. Cap matches MAX_FANOUT_WIDTH by convention.
  for (const [stepId, parents] of graph.parents) {
    if (parents.length > ctx.maxFanOutWidth) {
      return {
        code: "validation-failed",
        message: `F-16 orchestrator: step '${stepId}' has ${parents.length} parents (fan-in), exceeds MAX_FANOUT_WIDTH=${ctx.maxFanOutWidth}`,
      };
    }
  }
  return null;
}

/**
 * Compute the max depth via DFS from each entry. Iterative
 * (explicit stack) so deep trees don't blow the call stack
 * during validation. Returns a `StepError` when the depth
 * exceeds `MAX_FANOUT_DEPTH` so deep pathological trees never
 * reach runtime — the recursive runChain would consume O(depth)
 * live closures otherwise.
 *
 * Termination: relies on the acyclic invariant established by
 * `topologicalSort` running before this validator. Workflows
 * are DAGs (fan-in is supported), so a node reachable by
 * multiple paths can be re-pushed at different depths. The
 * `seenDepth` map records the deepest depth observed for each
 * node and skips re-pushes that don't strictly increase it —
 * soundness for DAGs (the deeper path is what matters for the
 * cap), bounded cost O(V·D), and no dependency on push/pop
 * order. A first-visit-wins `Set<string>` would silently
 * under-count on diamond shapes (different push orders observe
 * different first-visit depths).
 *
 * Diamond observability: the deepest-path-wins behaviour is
 * exercised through any diamond shape (A → [B,C] → D where the
 * longer path through one branch determines D's depth). The
 * existing fan-in DAG tests cover this; a dedicated regression
 * test could land if a future refactor regresses the Map<id,
 * maxDepth> approach.
 */
export function detectExcessiveDepth(
  ctx: OrchestratorContext,
  graph: StepGraph,
  entries: string[],
): StepError | null {
  const seenDepth = new Map<string, number>();
  for (const entry of entries) {
    const stack: { id: string; depth: number }[] = [{ id: entry, depth: 1 }];
    while (stack.length > 0) {
      // Loop guard guarantees non-empty stack.
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const { id, depth } = stack.pop()!;
      const prev = seenDepth.get(id);
      if (prev !== undefined && prev >= depth) continue;
      seenDepth.set(id, depth);
      if (depth > ctx.maxFanOutDepth) {
        return {
          code: "validation-failed",
          message: `F-16 orchestrator: workflow depth ${depth} exceeds MAX_FANOUT_DEPTH=${ctx.maxFanOutDepth} (at step '${id}')`,
        };
      }
      for (const child of graph.children.get(id) ?? []) {
        stack.push({ id: child, depth: depth + 1 });
      }
    }
  }
  return null;
}

export function rejectUnsupportedStrategies(definition: WorkflowDefinition): void {
  // T-6.3 honors "abort", "skip-step", and "continue". "retry" is a
  // declared FailureStrategy literal but unimplemented per plan.md
  // §Q3; reject at load time rather than silently coercing to
  // skip-step.
  const strategies: (FailureStrategy | undefined)[] = [definition.on_failure];
  for (const step of definition.steps) strategies.push(step.on_failure);
  for (const s of strategies) {
    if (s === undefined) continue;
    // `s` narrows to `never` after the literals; defensive against an
    // unsupported value that bypassed the schema (e.g., parsed-untrusted-JSON).
    // `String(s)` is safe for any runtime value.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (s !== "abort" && s !== "skip-step" && s !== "continue") {
      throw new Error(
        `F-16 orchestrator T-6.3: on_failure '${String(s)}' is not implemented in this PR; supported: abort | skip-step | continue`,
      );
    }
  }
}
