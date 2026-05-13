import { describe, it, expect } from "bun:test";
import { validateWorkflow, assertWorkflow } from "./validate";
import { createWorkflowLifecycleEvent, deriveWorkflowLifecycleSubject } from "./lifecycle";
import type { Sovereignty } from "../types";
import type { WorkflowDefinition } from "./types";

const sovereignty: Sovereignty = {
  classification: "local",
  data_residency: "CH",
  max_hop: 0,
  frontier_ok: false,
  model_class: "any",
};

const baseWorkflow: WorkflowDefinition = {
  id: "wf-pr-review",
  name: "PR review pipeline",
  version: "1.0.0",
  steps: [
    {
      id: "review",
      capability: "code-review",
      input: { compatibility_key: "pr.url.v1" },
      output: { compatibility_key: "review.result.v1" },
    },
    {
      id: "scan",
      capability: "security-scan",
      input: { compatibility_key: "review.result.v1" },
      output: { compatibility_key: "scan.report.v1" },
    },
  ],
};

describe("validateWorkflow — happy paths", () => {
  it("accepts a sequential two-step workflow", () => {
    const result = validateWorkflow(baseWorkflow);
    expect(result.valid).toBe(true);
  });

  it("accepts a single-step workflow", () => {
    const wf: WorkflowDefinition = {
      ...baseWorkflow,
      steps: [baseWorkflow.steps[0]],
    };
    expect(validateWorkflow(wf).valid).toBe(true);
  });

  it("accepts explicit `next` topology with matching schemas", () => {
    const wf: WorkflowDefinition = {
      ...baseWorkflow,
      steps: [
        { ...baseWorkflow.steps[0], next: ["scan"] },
        baseWorkflow.steps[1],
      ],
    };
    expect(validateWorkflow(wf).valid).toBe(true);
  });

  it("accepts a fan-out into two compatible steps", () => {
    const wf: WorkflowDefinition = {
      id: "fan", name: "fan", version: "1.0.0",
      steps: [
        {
          id: "triage",
          capability: "triage",
          kind: "fan-out",
          input: { compatibility_key: "pr.url.v1" },
          output: { compatibility_key: "triage.result.v1" },
          next: ["review", "scan"],
        },
        {
          id: "review",
          capability: "code-review",
          input: { compatibility_key: "triage.result.v1" },
          output: { compatibility_key: "review.result.v1" },
        },
        {
          id: "scan",
          capability: "security-scan",
          input: { compatibility_key: "triage.result.v1" },
          output: { compatibility_key: "scan.report.v1" },
        },
      ],
    };
    expect(validateWorkflow(wf).valid).toBe(true);
  });
});

describe("validateWorkflow — rejection paths", () => {
  it("rejects empty steps", () => {
    const wf: WorkflowDefinition = { ...baseWorkflow, steps: [] };
    const r = validateWorkflow(wf);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === "steps")).toBe(true);
  });

  it("rejects missing version", () => {
    const wf = { ...baseWorkflow, version: "" };
    expect(validateWorkflow(wf).valid).toBe(false);
  });

  it("rejects bad semver", () => {
    const wf = { ...baseWorkflow, version: "v1" };
    const r = validateWorkflow(wf);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === "version")).toBe(true);
  });

  it("rejects duplicate step ids", () => {
    const wf: WorkflowDefinition = {
      ...baseWorkflow,
      steps: [baseWorkflow.steps[0], { ...baseWorkflow.steps[1], id: "review" }],
    };
    const r = validateWorkflow(wf);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.message.includes("duplicate step id"))).toBe(true);
  });

  it("rejects bad step id grammar", () => {
    const wf: WorkflowDefinition = {
      ...baseWorkflow,
      steps: [{ ...baseWorkflow.steps[0], id: "Bad_ID" }, baseWorkflow.steps[1]],
    };
    expect(validateWorkflow(wf).valid).toBe(false);
  });

  it("rejects bad capability tag", () => {
    const wf: WorkflowDefinition = {
      ...baseWorkflow,
      steps: [{ ...baseWorkflow.steps[0], capability: "Code_Review" }, baseWorkflow.steps[1]],
    };
    expect(validateWorkflow(wf).valid).toBe(false);
  });

  it("rejects schema mismatch on sequential pairing", () => {
    const wf: WorkflowDefinition = {
      ...baseWorkflow,
      steps: [
        baseWorkflow.steps[0],
        { ...baseWorkflow.steps[1], input: { compatibility_key: "OTHER.shape.v1" } },
      ],
    };
    const r = validateWorkflow(wf);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.message.includes("incompatible"))).toBe(true);
  });

  it("rejects schema mismatch on explicit next pointer", () => {
    const wf: WorkflowDefinition = {
      ...baseWorkflow,
      steps: [
        { ...baseWorkflow.steps[0], next: ["scan"] },
        { ...baseWorkflow.steps[1], input: { compatibility_key: "different.v1" } },
      ],
    };
    expect(validateWorkflow(wf).valid).toBe(false);
  });

  it("rejects unknown next-pointer", () => {
    const wf: WorkflowDefinition = {
      ...baseWorkflow,
      steps: [{ ...baseWorkflow.steps[0], next: ["nonexistent"] }, baseWorkflow.steps[1]],
    };
    const r = validateWorkflow(wf);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.message.includes("unknown step id"))).toBe(true);
  });

  it("rejects self-reference in next", () => {
    const wf: WorkflowDefinition = {
      ...baseWorkflow,
      steps: [{ ...baseWorkflow.steps[0], next: ["review"] }, baseWorkflow.steps[1]],
    };
    const r = validateWorkflow(wf);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.message.includes("cannot point at itself"))).toBe(true);
  });

  it("rejects bad failure strategy", () => {
    const wf = { ...baseWorkflow, on_failure: "yolo" as never };
    expect(validateWorkflow(wf).valid).toBe(false);
  });

  it("rejects negative timeout_ms", () => {
    const wf = { ...baseWorkflow, timeout_ms: 0 };
    expect(validateWorkflow(wf).valid).toBe(false);
  });

  it("rejects bad step kind", () => {
    const wf: WorkflowDefinition = {
      ...baseWorkflow,
      steps: [{ ...baseWorkflow.steps[0], kind: "yolo" as never }, baseWorkflow.steps[1]],
    };
    expect(validateWorkflow(wf).valid).toBe(false);
  });

  it("rejects empty compatibility_key", () => {
    const wf: WorkflowDefinition = {
      ...baseWorkflow,
      steps: [{ ...baseWorkflow.steps[0], output: { compatibility_key: "" } }, baseWorkflow.steps[1]],
    };
    expect(validateWorkflow(wf).valid).toBe(false);
  });

  it("rejects duplicate next entries", () => {
    const wf: WorkflowDefinition = {
      ...baseWorkflow,
      steps: [{ ...baseWorkflow.steps[0], next: ["scan", "scan"] }, baseWorkflow.steps[1]],
    };
    const r = validateWorkflow(wf);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.message.includes("duplicate next id"))).toBe(true);
  });
});

describe("assertWorkflow", () => {
  it("throws on invalid", () => {
    expect(() => { assertWorkflow({}); }).toThrow(/invalid workflow definition/);
  });

  it("does not throw on valid", () => {
    expect(() => { assertWorkflow(baseWorkflow); }).not.toThrow();
  });
});

describe("deriveWorkflowLifecycleSubject", () => {
  it("derives dispatch.workflow.* subjects", () => {
    expect(deriveWorkflowLifecycleSubject("metafactory", "workflow.started"))
      .toBe("local.metafactory.dispatch.workflow.started");
    expect(deriveWorkflowLifecycleSubject("metafactory", "workflow.step.completed"))
      .toBe("local.metafactory.dispatch.workflow.step.completed");
  });

  it("rejects bad org", () => {
    expect(() => deriveWorkflowLifecycleSubject("BAD_ORG", "workflow.started")).toThrow(/invalid org/);
  });
});

describe("createWorkflowLifecycleEvent", () => {
  it("produces unsigned envelope (transport signs)", () => {
    const result = createWorkflowLifecycleEvent({
      org: "metafactory",
      source: "metafactory.cortex.workflow",
      sovereignty,
      type: "workflow.started",
      input: { workflow_id: "wf-1", correlation_id: "550e8400-e29b-41d4-a716-446655440000" },
    });
    expect(result.envelope.signed_by).toBeUndefined();
    expect(result.envelope.type).toBe("workflow.started");
    expect(result.envelope.payload.workflow_id).toBe("wf-1");
    expect(result.subject).toBe("local.metafactory.dispatch.workflow.started");
  });

  it("threads correlation_id when provided", () => {
    const result = createWorkflowLifecycleEvent({
      org: "metafactory",
      source: "metafactory.cortex.workflow",
      sovereignty,
      type: "workflow.step.failed",
      input: { workflow_id: "wf-1", correlation_id: "770e8400-e29b-41d4-a716-446655440009", step_id: "build", reason: "boom" },
      correlation_id: "770e8400-e29b-41d4-a716-446655440009",
    });
    expect(result.envelope.correlation_id).toBe("770e8400-e29b-41d4-a716-446655440009");
    expect(result.envelope.payload.step_id).toBe("build");
  });
});
