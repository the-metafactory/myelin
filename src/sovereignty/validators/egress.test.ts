import { describe, it, expect } from "bun:test";
import {
  matchesGlobPattern,
  compileGlobPattern,
  checkClassificationAlignment,
  checkDataResidency,
  validateEgress,
} from "./egress";
import type { EgressRule } from "../types";
import type { MyelinEnvelope } from "../../types";

function envelope(classification: "local" | "federated" | "public", residency = "CH"): MyelinEnvelope {
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    source: "metafactory.echo.local",
    type: "tasks.code-review",
    timestamp: "2026-05-10T00:00:00Z",
    sovereignty: { classification, data_residency: residency, max_hop: 0, frontier_ok: false, model_class: "any" },
    payload: {},
  };
}

describe("compileGlobPattern", () => {
  it("matches single token wildcard", () => {
    const re = compileGlobPattern("local.*.tasks.review");
    expect(re.test("local.org.tasks.review")).toBe(true);
    expect(re.test("local.org.deep.tasks.review")).toBe(false);
  });

  it("matches multi-token > wildcard", () => {
    const re = compileGlobPattern("local.org.tasks.>");
    expect(re.test("local.org.tasks.review")).toBe(true);
    expect(re.test("local.org.tasks.review.typescript")).toBe(true);
    expect(re.test("local.org.tasks")).toBe(false);
  });

  it("rejects > not at end", () => {
    expect(() => compileGlobPattern("local.>.tasks")).toThrow();
  });

  it("does not match different prefix", () => {
    expect(matchesGlobPattern("federated.org.tasks", "local.>")).toBe(false);
  });

  it("escapes special characters in literal tokens", () => {
    const re = compileGlobPattern("local.test-org.tasks");
    expect(re.test("local.test-org.tasks")).toBe(true);
    expect(re.test("localxtest-orgxtasks")).toBe(false);
  });
});

describe("checkClassificationAlignment", () => {
  const rules: EgressRule[] = [
    { classification: "local", allowed_subjects: ["local.metafactory.>"] },
    { classification: "federated", allowed_subjects: ["federated.metafactory.>", "federated.*.tasks.>"] },
    { classification: "public", allowed_subjects: ["public.>"] },
  ];

  it("blocks local envelope to federated subject", () => {
    const result = checkClassificationAlignment(envelope("local"), "federated.metafactory.tasks.review", rules);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("compliance-block:classification-mismatch");
  });

  it("allows local envelope to local subject in allowed list", () => {
    const result = checkClassificationAlignment(envelope("local"), "local.metafactory.tasks.review", rules);
    expect(result.valid).toBe(true);
  });

  it("blocks local envelope to local subject NOT in allowed list", () => {
    const result = checkClassificationAlignment(envelope("local"), "local.other-org.tasks.review", rules);
    expect(result.valid).toBe(false);
  });

  it("allows federated envelope to local subject (downgrade)", () => {
    const result = checkClassificationAlignment(envelope("federated"), "federated.partner.tasks.review", rules);
    expect(result.valid).toBe(true);
  });

  it("allows public envelope anywhere matching public rule", () => {
    const result = checkClassificationAlignment(envelope("public"), "public.broadcast.news", rules);
    expect(result.valid).toBe(true);
  });

  it("blocks subject without classification prefix", () => {
    const result = checkClassificationAlignment(envelope("local"), "weird.subject", rules);
    expect(result.valid).toBe(false);
  });

  it("blocks when no rule for classification exists", () => {
    const result = checkClassificationAlignment(envelope("public"), "public.x", []);
    expect(result.valid).toBe(false);
  });
});

describe("checkDataResidency", () => {
  it("passes when no residency constraints", () => {
    const rule: EgressRule = { classification: "local", allowed_subjects: ["local.>"] };
    expect(checkDataResidency(envelope("local"), "local.x.tasks", rule).valid).toBe(true);
  });

  it("blocks CH-resident envelope to non-CH subject", () => {
    const rule: EgressRule = {
      classification: "federated",
      allowed_subjects: ["federated.>"],
      data_residency_constraints: { CH: ["federated.ch.>", "local.>"] },
    };
    const result = checkDataResidency(envelope("federated", "CH"), "federated.de.tasks", rule);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("compliance-block:residency-violation");
  });

  it("allows CH-resident envelope to CH subject", () => {
    const rule: EgressRule = {
      classification: "federated",
      allowed_subjects: ["federated.>"],
      data_residency_constraints: { CH: ["federated.ch.>"] },
    };
    expect(checkDataResidency(envelope("federated", "CH"), "federated.ch.tasks", rule).valid).toBe(true);
  });

  it("passes when residency code has no constraint entry", () => {
    const rule: EgressRule = {
      classification: "federated",
      allowed_subjects: ["federated.>"],
      data_residency_constraints: { CH: ["federated.ch.>"] },
    };
    expect(checkDataResidency(envelope("federated", "DE"), "federated.de.tasks", rule).valid).toBe(true);
  });
});

describe("validateEgress (orchestration)", () => {
  const rules: EgressRule[] = [
    {
      classification: "federated",
      allowed_subjects: ["federated.>"],
      data_residency_constraints: { CH: ["federated.ch.>"] },
    },
  ];

  it("returns classification mismatch first, residency not checked", () => {
    const result = validateEgress(envelope("local"), "federated.ch.tasks", rules);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("compliance-block:classification-mismatch");
  });

  it("returns residency violation after passing classification", () => {
    const result = validateEgress(envelope("federated", "CH"), "federated.de.tasks", rules);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("compliance-block:residency-violation");
  });

  it("returns valid when both pass", () => {
    expect(validateEgress(envelope("federated", "CH"), "federated.ch.tasks.review", rules).valid).toBe(true);
  });
});
