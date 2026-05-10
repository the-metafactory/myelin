import { describe, it, expect } from "bun:test";
import type {
  SovereigntyPolicy,
  EgressRule,
  ScopeMapping,
  AuditEntry,
  NakReasonCode,
  SovereigntyValidationResult,
} from "./types";

describe("sovereignty types", () => {
  it("compiles a minimal SovereigntyPolicy literal", () => {
    const policy: SovereigntyPolicy = {
      version: 1,
      org: "metafactory",
      egress: { block_local_escape: true, rules: [] },
      ingress: { scope_mappings: [], reject_unknown_partners: true },
      chain_of_stamps: { verify_delegation_sovereignty: false },
    };
    expect(policy.version).toBe(1);
    expect(policy.org).toBe("metafactory");
  });

  it("EgressRule supports residency constraints", () => {
    const rule: EgressRule = {
      classification: "local",
      allowed_subjects: ["local.metafactory.>"],
      data_residency_constraints: { CH: ["local.>", "federated.ch.>"] },
    };
    expect(rule.data_residency_constraints?.CH?.length).toBe(2);
  });

  it("ScopeMapping requires partner_org and capabilities", () => {
    const mapping: ScopeMapping = {
      partner_org: "operator-b",
      imported_principals: ["did:mf:echo"],
      local_scope: ["federated.operator-b.tasks.>"],
      max_capabilities: ["code-review", "security-scan"],
    };
    expect(mapping.imported_principals.length).toBe(1);
  });

  it("AuditEntry includes decision and direction", () => {
    const entry: AuditEntry = {
      timestamp: "2026-05-10T00:00:00Z",
      envelope_id: "550e8400-e29b-41d4-a716-446655440000",
      direction: "egress",
      decision: "block",
      reason_code: "compliance-block:classification-mismatch",
      reason: "test",
      subject: "federated.x.tasks.review",
      classification: "local",
      data_residency: "CH",
    };
    expect(entry.direction).toBe("egress");
    expect(entry.decision).toBe("block");
  });

  it("NakReasonCode union covers all six variants", () => {
    const codes: NakReasonCode[] = [
      "compliance-block:classification-mismatch",
      "compliance-block:residency-violation",
      "compliance-block:unknown-principal",
      "compliance-block:scope-exceeded",
      "compliance-block:chain-invalid",
      "compliance-block:partner-unknown",
    ];
    expect(codes.length).toBe(6);
  });

  it("SovereigntyValidationResult discriminates on valid", () => {
    const ok: SovereigntyValidationResult = { valid: true };
    const bad: SovereigntyValidationResult = {
      valid: false,
      code: "compliance-block:scope-exceeded",
      reason: "out of bounds",
    };
    if (ok.valid) expect(ok.valid).toBe(true);
    if (!bad.valid) expect(bad.code).toBe("compliance-block:scope-exceeded");
  });
});
