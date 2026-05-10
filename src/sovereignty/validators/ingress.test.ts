import { describe, it, expect } from "bun:test";
import { lookupPrincipalScope, checkScopeCeiling, validateIngress } from "./ingress";
import type { ScopeMapping, SovereigntyPolicy } from "../types";
import type { MyelinEnvelope } from "../../types";

function signedEnvelope(principal: string, requirements?: string[]): MyelinEnvelope {
  return {
    id: "550e8400-e29b-41d4-a716-446655440001",
    source: "operator-b.echo.federated",
    type: "tasks.code-review",
    timestamp: "2026-05-10T00:00:00Z",
    sovereignty: { classification: "federated", data_residency: "CH", max_hop: 1, frontier_ok: false, model_class: "any" },
    signed_by: { method: "ed25519", principal, signature: "x", at: "2026-05-10T00:00:00Z" },
    payload: {},
    ...(requirements ? { requirements } : {}),
  };
}

const mappings: ScopeMapping[] = [
  {
    partner_org: "operator-b",
    imported_principals: ["did:mf:echo", "did:mf:forge"],
    local_scope: ["federated.operator-b.tasks.>"],
    max_capabilities: ["code-review", "security-scan"],
  },
];

const policy: SovereigntyPolicy = {
  version: 1,
  org: "metafactory",
  egress: { block_local_escape: true, rules: [] },
  ingress: { scope_mappings: mappings, reject_unknown_partners: true },
  chain_of_stamps: { verify_delegation_sovereignty: false },
};

describe("lookupPrincipalScope", () => {
  it("returns mapping for known principal", () => {
    const m = lookupPrincipalScope("did:mf:echo", mappings);
    expect(m?.partner_org).toBe("operator-b");
  });

  it("returns null for unknown principal", () => {
    expect(lookupPrincipalScope("did:mf:rogue", mappings)).toBeNull();
  });
});

describe("checkScopeCeiling", () => {
  it("allows access to subject inside local_scope", () => {
    const result = checkScopeCeiling(signedEnvelope("did:mf:echo"), "federated.operator-b.tasks.review", mappings[0]!);
    expect(result.valid).toBe(true);
  });

  it("blocks access outside local_scope", () => {
    const result = checkScopeCeiling(signedEnvelope("did:mf:echo"), "local.metafactory.secrets", mappings[0]!);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("compliance-block:scope-exceeded");
  });

  it("blocks when requirement exceeds max_capabilities", () => {
    const env = signedEnvelope("did:mf:echo", ["deploy"]);
    const result = checkScopeCeiling(env, "federated.operator-b.tasks.deploy", mappings[0]!);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("compliance-block:scope-exceeded");
  });

  it("allows requirement listed in max_capabilities", () => {
    const env = signedEnvelope("did:mf:echo", ["code-review"]);
    const result = checkScopeCeiling(env, "federated.operator-b.tasks.review", mappings[0]!);
    expect(result.valid).toBe(true);
  });
});

describe("validateIngress", () => {
  it("blocks unsigned envelope", () => {
    const env = signedEnvelope("did:mf:echo");
    delete (env as any).signed_by;
    const result = validateIngress(env, "federated.operator-b.tasks.review", policy);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("compliance-block:unknown-principal");
  });

  it("blocks unknown principal when reject_unknown_partners=true", () => {
    const result = validateIngress(signedEnvelope("did:mf:rogue"), "federated.operator-b.tasks.review", policy);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("compliance-block:unknown-principal");
  });

  it("allows unknown principal when reject_unknown_partners=false", () => {
    const open: SovereigntyPolicy = {
      ...policy,
      ingress: { scope_mappings: mappings, reject_unknown_partners: false },
    };
    const result = validateIngress(signedEnvelope("did:mf:rogue"), "federated.operator-b.tasks.review", open);
    expect(result.valid).toBe(true);
  });

  it("allows known principal accessing its scope", () => {
    const result = validateIngress(signedEnvelope("did:mf:echo"), "federated.operator-b.tasks.review", policy);
    expect(result.valid).toBe(true);
  });

  it("blocks known principal exceeding scope subject", () => {
    const result = validateIngress(signedEnvelope("did:mf:echo"), "local.metafactory.secrets", policy);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("compliance-block:scope-exceeded");
  });
});
