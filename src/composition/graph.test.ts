import { describe, it, expect } from "bun:test";
import {
  buildStepGraph,
  detectCycle,
  findEntrySteps,
  findTerminalSteps,
  reachableFrom,
  topologicalSort,
  unreachableSteps,
} from "./graph";
import type { WorkflowDefinition, WorkflowStep } from "./types";

function step(id: string, next?: string[]): WorkflowStep {
  return {
    id,
    capability: "test-cap",
    input: { compatibility_key: "io.v1" },
    output: { compatibility_key: "io.v1" },
    ...(next ? { next } : {}),
  };
}

function workflow(steps: WorkflowStep[]): WorkflowDefinition {
  return {
    id: "wf",
    name: "test workflow",
    version: "1.0.0",
    steps,
  };
}

describe("buildStepGraph", () => {
  it("builds adjacency for a linear workflow", () => {
    const g = buildStepGraph(workflow([step("a", ["b"]), step("b", ["c"]), step("c")]));
    expect(g.steps.size).toBe(3);
    expect(g.children.get("a")).toEqual(["b"]);
    expect(g.children.get("b")).toEqual(["c"]);
    expect(g.children.get("c")).toEqual([]);
    expect(g.parents.get("a")).toEqual([]);
    expect(g.parents.get("b")).toEqual(["a"]);
    expect(g.parents.get("c")).toEqual(["b"]);
  });

  it("builds reverse adjacency for fan-out", () => {
    const g = buildStepGraph(
      workflow([step("a", ["b", "c", "d"]), step("b"), step("c"), step("d")]),
    );
    expect(g.children.get("a")).toEqual(["b", "c", "d"]);
    expect(g.parents.get("b")).toEqual(["a"]);
    expect(g.parents.get("c")).toEqual(["a"]);
    expect(g.parents.get("d")).toEqual(["a"]);
  });

  it("merges incoming edges for fan-in", () => {
    const g = buildStepGraph(
      workflow([
        step("a", ["d"]),
        step("b", ["d"]),
        step("c", ["d"]),
        step("d"),
      ]),
    );
    expect(g.parents.get("d")).toEqual(["a", "b", "c"]);
    expect(g.children.get("d")).toEqual([]);
  });

  it("drops dangling next-pointers without crashing", () => {
    const g = buildStepGraph(workflow([step("a", ["nonexistent", "b"]), step("b")]));
    expect(g.children.get("a")).toEqual(["b"]);
    expect(g.parents.get("b")).toEqual(["a"]);
  });

  it("handles steps with no next field", () => {
    const g = buildStepGraph(workflow([step("a")]));
    expect(g.children.get("a")).toEqual([]);
    expect(g.parents.get("a")).toEqual([]);
  });

  it("handles single-step workflows", () => {
    const g = buildStepGraph(workflow([step("only")]));
    expect(g.steps.size).toBe(1);
    expect(g.children.get("only")).toEqual([]);
    expect(g.parents.get("only")).toEqual([]);
  });
});

describe("findEntrySteps", () => {
  it("returns the single root of a linear workflow", () => {
    const g = buildStepGraph(workflow([step("a", ["b"]), step("b")]));
    expect(findEntrySteps(g)).toEqual(["a"]);
  });

  it("returns all roots in a forest", () => {
    const g = buildStepGraph(workflow([step("a", ["c"]), step("b", ["c"]), step("c")]));
    expect(findEntrySteps(g).sort()).toEqual(["a", "b"]);
  });

  it("returns the single root in a fan-out", () => {
    const g = buildStepGraph(workflow([step("a", ["b", "c"]), step("b"), step("c")]));
    expect(findEntrySteps(g)).toEqual(["a"]);
  });

  it("returns every step when there are no edges", () => {
    const g = buildStepGraph(workflow([step("a"), step("b"), step("c")]));
    expect(findEntrySteps(g).sort()).toEqual(["a", "b", "c"]);
  });
});

describe("findTerminalSteps", () => {
  it("returns the leaf of a linear workflow", () => {
    const g = buildStepGraph(workflow([step("a", ["b"]), step("b", ["c"]), step("c")]));
    expect(findTerminalSteps(g)).toEqual(["c"]);
  });

  it("returns the convergence point of a fan-in", () => {
    const g = buildStepGraph(
      workflow([step("a", ["d"]), step("b", ["d"]), step("c", ["d"]), step("d")]),
    );
    expect(findTerminalSteps(g)).toEqual(["d"]);
  });

  it("returns every branch end of a fan-out without merge", () => {
    const g = buildStepGraph(workflow([step("a", ["b", "c"]), step("b"), step("c")]));
    expect(findTerminalSteps(g).sort()).toEqual(["b", "c"]);
  });
});

describe("detectCycle", () => {
  it("returns null for a linear DAG", () => {
    const g = buildStepGraph(workflow([step("a", ["b"]), step("b", ["c"]), step("c")]));
    expect(detectCycle(g)).toBeNull();
  });

  it("returns null for a fan-out/fan-in diamond", () => {
    const g = buildStepGraph(
      workflow([
        step("a", ["b", "c"]),
        step("b", ["d"]),
        step("c", ["d"]),
        step("d"),
      ]),
    );
    expect(detectCycle(g)).toBeNull();
  });

  it("detects a direct self-loop", () => {
    const g = buildStepGraph(workflow([step("a", ["a"])]));
    const cycle = detectCycle(g);
    expect(cycle).toEqual(["a", "a"]);
  });

  it("detects a two-step cycle", () => {
    const g = buildStepGraph(workflow([step("a", ["b"]), step("b", ["a"])]));
    const cycle = detectCycle(g);
    expect(cycle).not.toBeNull();
    expect(cycle!.length).toBeGreaterThanOrEqual(2);
    expect(cycle!).toContain("a");
    expect(cycle!).toContain("b");
  });

  it("detects a longer cycle embedded in a larger graph", () => {
    const g = buildStepGraph(
      workflow([
        step("entry", ["a"]),
        step("a", ["b"]),
        step("b", ["c"]),
        step("c", ["a"]),
        step("done"),
      ]),
    );
    const cycle = detectCycle(g);
    expect(cycle).not.toBeNull();
    expect(cycle!).toContain("a");
    expect(cycle!).toContain("b");
    expect(cycle!).toContain("c");
  });

  it("detects a cycle disconnected from the entry steps", () => {
    const g = buildStepGraph(
      workflow([
        step("entry", ["main"]),
        step("main"),
        step("orphan-a", ["orphan-b"]),
        step("orphan-b", ["orphan-a"]),
      ]),
    );
    expect(detectCycle(g)).not.toBeNull();
  });
});

describe("topologicalSort", () => {
  it("orders a linear chain in dependency order", () => {
    const g = buildStepGraph(workflow([step("a", ["b"]), step("b", ["c"]), step("c")]));
    expect(topologicalSort(g)).toEqual(["a", "b", "c"]);
  });

  it("places fan-out children after the fan-out parent", () => {
    const g = buildStepGraph(workflow([step("a", ["b", "c"]), step("b"), step("c")]));
    const order = topologicalSort(g)!;
    expect(order[0]).toBe("a");
    expect(order.slice(1).sort()).toEqual(["b", "c"]);
  });

  it("places fan-in target after all parents", () => {
    const g = buildStepGraph(
      workflow([step("a", ["d"]), step("b", ["d"]), step("c", ["d"]), step("d")]),
    );
    const order = topologicalSort(g)!;
    expect(order.indexOf("d")).toBe(3);
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("d"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("d"));
    expect(order.indexOf("c")).toBeLessThan(order.indexOf("d"));
  });

  it("returns null on a cyclic graph", () => {
    const g = buildStepGraph(workflow([step("a", ["b"]), step("b", ["a"])]));
    expect(topologicalSort(g)).toBeNull();
  });

  it("is deterministic — same input yields same order", () => {
    const def = workflow([step("a", ["b", "c"]), step("b"), step("c")]);
    expect(topologicalSort(buildStepGraph(def))).toEqual(topologicalSort(buildStepGraph(def))!);
  });
});

describe("reachableFrom", () => {
  it("returns the entry itself + all transitive descendants", () => {
    const g = buildStepGraph(workflow([step("a", ["b"]), step("b", ["c"]), step("c")]));
    expect(reachableFrom(g, "a")).toEqual(new Set(["a", "b", "c"]));
  });

  it("does not include nodes upstream of the start", () => {
    const g = buildStepGraph(workflow([step("a", ["b"]), step("b", ["c"]), step("c")]));
    expect(reachableFrom(g, "b")).toEqual(new Set(["b", "c"]));
  });

  it("crosses fan-out branches", () => {
    const g = buildStepGraph(
      workflow([
        step("a", ["b", "c"]),
        step("b", ["d"]),
        step("c", ["d"]),
        step("d"),
      ]),
    );
    expect(reachableFrom(g, "a")).toEqual(new Set(["a", "b", "c", "d"]));
  });

  it("returns empty set for a non-existent step", () => {
    const g = buildStepGraph(workflow([step("a")]));
    expect(reachableFrom(g, "ghost")).toEqual(new Set());
  });

  it("does not loop forever on a cycle", () => {
    const g = buildStepGraph(workflow([step("a", ["b"]), step("b", ["a"])]));
    expect(reachableFrom(g, "a")).toEqual(new Set(["a", "b"]));
  });
});

describe("unreachableSteps", () => {
  it("flags orphan steps no entry can reach", () => {
    const g = buildStepGraph(
      workflow([step("entry", ["main"]), step("main"), step("orphan")]),
    );
    expect(unreachableSteps(g, ["entry"])).toEqual(["orphan"]);
  });

  it("returns empty array when every step is reachable", () => {
    const g = buildStepGraph(workflow([step("a", ["b"]), step("b")]));
    expect(unreachableSteps(g, ["a"])).toEqual([]);
  });

  it("considers all provided entry points", () => {
    const g = buildStepGraph(
      workflow([
        step("entry-a", ["x"]),
        step("entry-b", ["y"]),
        step("x"),
        step("y"),
        step("orphan"),
      ]),
    );
    expect(unreachableSteps(g, ["entry-a", "entry-b"])).toEqual(["orphan"]);
  });
});
