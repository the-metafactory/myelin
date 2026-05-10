import { describe, it, expect } from "bun:test";
import { createSovereigntyEngine } from "./engine";
import { createInMemoryPolicyStore } from "./policy-store";
import type { SovereigntyPolicy } from "./types";
import type { MyelinEnvelope } from "../types";

const policy: SovereigntyPolicy = {
  version: 1,
  org: "metafactory",
  egress: {
    block_local_escape: true,
    rules: [
      { classification: "local", allowed_subjects: ["local.metafactory.>"] },
      {
        classification: "federated",
        allowed_subjects: ["federated.metafactory.>", "federated.operator-b.>"],
        data_residency_constraints: { CH: ["federated.ch.>", "federated.metafactory.>"] },
      },
      { classification: "public", allowed_subjects: ["public.>"] },
    ],
  },
  ingress: {
    scope_mappings: [
      {
        partner_org: "operator-b",
        imported_principals: ["did:mf:echo"],
        local_scope: ["federated.operator-b.tasks.>"],
        max_capabilities: ["code-review"],
      },
    ],
    reject_unknown_partners: true,
  },
  chain_of_stamps: { verify_delegation_sovereignty: false },
};

function envelope(classification: "local" | "federated" | "public", residency = "CH", principal?: string): MyelinEnvelope {
  return {
    id: "550e8400-e29b-41d4-a716-446655440005",
    source: "metafactory.echo.local",
    type: "tasks.code-review",
    timestamp: "2026-05-10T00:00:00Z",
    sovereignty: { classification, data_residency: residency, max_hop: 0, frontier_ok: false, model_class: "any" },
    payload: {},
    ...(principal
      ? { signed_by: { method: "ed25519-pubkey", principal, signature: "x", at: "2026-05-10T00:00:00Z" } as any }
      : {}),
  };
}

describe("SovereigntyEngine", () => {
  it("validateEgress blocks local-escape via block_local_escape fast-path", () => {
    const engine = createSovereigntyEngine({ policyStore: createInMemoryPolicyStore({ initial: policy }) });
    const result = engine.validateEgress(envelope("local"), "federated.metafactory.tasks.review");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("compliance-block:classification-mismatch");
  });

  it("validateEgress allows local envelope to local subject in allowed list", () => {
    const engine = createSovereigntyEngine({ policyStore: createInMemoryPolicyStore({ initial: policy }) });
    expect(engine.validateEgress(envelope("local"), "local.metafactory.tasks.review").valid).toBe(true);
  });

  it("validateEgress enforces residency", () => {
    const engine = createSovereigntyEngine({ policyStore: createInMemoryPolicyStore({ initial: policy }) });
    const result = engine.validateEgress(envelope("federated", "CH"), "federated.operator-b.tasks");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("compliance-block:residency-violation");
  });

  it("validateIngress accepts known principal in scope", () => {
    const engine = createSovereigntyEngine({ policyStore: createInMemoryPolicyStore({ initial: policy }) });
    const result = engine.validateIngress(envelope("federated", "CH", "did:mf:echo"), "federated.operator-b.tasks.review");
    expect(result.valid).toBe(true);
  });

  it("validateIngress rejects unknown principal", () => {
    const engine = createSovereigntyEngine({ policyStore: createInMemoryPolicyStore({ initial: policy }) });
    const result = engine.validateIngress(envelope("federated", "CH", "did:mf:rogue"), "federated.operator-b.tasks.review");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("compliance-block:unknown-principal");
  });

  it("getPolicyStore returns the underlying store", () => {
    const store = createInMemoryPolicyStore({ initial: policy });
    const engine = createSovereigntyEngine({ policyStore: store });
    expect(engine.getPolicyStore()).toBe(store);
  });

  it("validateEgress fails fast-closed when policy not loaded", () => {
    const store = createInMemoryPolicyStore();
    const engine = createSovereigntyEngine({ policyStore: store });
    expect(() => engine.validateEgress(envelope("local"), "local.metafactory.tasks")).toThrow(/fail-closed/);
  });
});
