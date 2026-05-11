import type { WorkflowDefinition, WorkflowStep } from "./types";

/**
 * F-16 T-3.1: DAG utilities for workflow step graphs.
 *
 * Pure functions over a validated `WorkflowDefinition`. The
 * orchestrator (T-6.x) walks these structures to drive execution;
 * the loader (validate.ts) uses cycle detection + reachability at
 * load time. Schema compatibility lives in `validate.ts` — graph
 * concerns are purely topological.
 *
 * Conventions:
 * - "Children" of step S = the step IDs in `S.next`.
 * - "Parents" of step S = step IDs whose `next` contains S.
 * - "Entry" steps = steps with no parents (zero in-degree).
 * - "Terminal" steps = steps with no children (zero out-degree).
 * - Cycles are detected via DFS with white/gray/black colouring;
 *   the first back-edge encountered yields the offending cycle.
 */

export interface StepGraph {
  /** stepId → step (for O(1) lookup) */
  steps: Map<string, WorkflowStep>;
  /** stepId → child step IDs (outgoing edges) */
  children: Map<string, string[]>;
  /** stepId → parent step IDs (incoming edges) */
  parents: Map<string, string[]>;
}

/**
 * Build a `StepGraph` from a validated workflow definition. Cheap —
 * O(steps + edges). Does not validate the definition; callers should
 * run `validateWorkflow` first if the input is untrusted.
 *
 * Edges pointing to non-existent steps are dropped from the children
 * map so downstream DAG operations don't crash on dangling pointers.
 * The loader catches this at validation time; the graph builder
 * stays robust to malformed input so it can be reused in test
 * harnesses.
 */
export function buildStepGraph(definition: WorkflowDefinition): StepGraph {
  const steps = new Map<string, WorkflowStep>();
  const children = new Map<string, string[]>();
  const parents = new Map<string, string[]>();

  for (const step of definition.steps) {
    steps.set(step.id, step);
    children.set(step.id, []);
    parents.set(step.id, []);
  }

  for (const step of definition.steps) {
    if (!step.next) continue;
    const out: string[] = [];
    for (const childId of step.next) {
      if (!steps.has(childId)) continue;
      out.push(childId);
      const parentList = parents.get(childId)!;
      parentList.push(step.id);
    }
    children.set(step.id, out);
  }

  return { steps, children, parents };
}

/** Step IDs with zero in-degree. */
export function findEntrySteps(graph: StepGraph): string[] {
  const out: string[] = [];
  for (const [id, parentList] of graph.parents) {
    if (parentList.length === 0) out.push(id);
  }
  return out;
}

/** Step IDs with zero out-degree (no children). */
export function findTerminalSteps(graph: StepGraph): string[] {
  const out: string[] = [];
  for (const [id, childList] of graph.children) {
    if (childList.length === 0) out.push(id);
  }
  return out;
}

/**
 * Detect the first cycle reachable in the graph via DFS. Returns
 * the offending cycle path (ordered, starting at the back-edge
 * target) or `null` if the graph is acyclic.
 *
 * Searches from every node so disconnected sub-cycles are still
 * found.
 */
export function detectCycle(graph: StepGraph): string[] | null {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const colour = new Map<string, number>();
  for (const id of graph.steps.keys()) colour.set(id, WHITE);
  const parent = new Map<string, string | null>();

  function dfs(start: string): string[] | null {
    const stack: Array<{ id: string; iter: number }> = [{ id: start, iter: 0 }];
    colour.set(start, GRAY);
    parent.set(start, null);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const kids = graph.children.get(frame.id) ?? [];
      if (frame.iter >= kids.length) {
        colour.set(frame.id, BLACK);
        stack.pop();
        continue;
      }
      const next = kids[frame.iter]!;
      frame.iter += 1;
      const c = colour.get(next);
      if (c === GRAY) {
        const cyclePath: string[] = [next];
        let cur: string | null | undefined = frame.id;
        while (cur && cur !== next) {
          cyclePath.push(cur);
          cur = parent.get(cur) ?? null;
        }
        cyclePath.reverse();
        cyclePath.push(next);
        return cyclePath;
      }
      if (c === WHITE) {
        colour.set(next, GRAY);
        parent.set(next, frame.id);
        stack.push({ id: next, iter: 0 });
      }
    }
    return null;
  }

  for (const id of graph.steps.keys()) {
    if (colour.get(id) === WHITE) {
      const cycle = dfs(id);
      if (cycle) return cycle;
    }
  }
  return null;
}

/**
 * Topological sort via Kahn's algorithm. Returns step IDs in
 * dependency order (parents before children). Returns `null` when
 * the graph has a cycle.
 *
 * Stable: within an equivalence class (same in-degree at a tick),
 * steps appear in `definition.steps` insertion order. This makes
 * the sort deterministic for tests and for fan-in aggregation.
 */
export function topologicalSort(graph: StepGraph): string[] | null {
  const indegree = new Map<string, number>();
  for (const [id, parentList] of graph.parents) indegree.set(id, parentList.length);
  const queue: string[] = [];
  for (const id of graph.steps.keys()) {
    if (indegree.get(id) === 0) queue.push(id);
  }
  const out: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    out.push(id);
    for (const childId of graph.children.get(id) ?? []) {
      const next = (indegree.get(childId) ?? 0) - 1;
      indegree.set(childId, next);
      if (next === 0) queue.push(childId);
    }
  }
  if (out.length !== graph.steps.size) return null;
  return out;
}

/**
 * Set of step IDs reachable from `start` via outgoing edges
 * (transitive closure). Includes `start` itself if it exists in
 * the graph.
 */
export function reachableFrom(graph: StepGraph, start: string): Set<string> {
  const visited = new Set<string>();
  if (!graph.steps.has(start)) return visited;
  const stack: string[] = [start];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const childId of graph.children.get(id) ?? []) {
      if (!visited.has(childId)) stack.push(childId);
    }
  }
  return visited;
}

/**
 * Step IDs not reachable from any of the given entry points. The
 * loader uses this to flag orphan steps — definitions where a step
 * exists but no path from any entry reaches it.
 */
export function unreachableSteps(graph: StepGraph, entries: string[]): string[] {
  const reached = new Set<string>();
  for (const entry of entries) {
    for (const id of reachableFrom(graph, entry)) reached.add(id);
  }
  const out: string[] = [];
  for (const id of graph.steps.keys()) {
    if (!reached.has(id)) out.push(id);
  }
  return out;
}
