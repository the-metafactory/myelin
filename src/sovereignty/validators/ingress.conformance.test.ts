import { describe, it, expect } from "bun:test";
import {
  validateIngress,
  lookupPrincipalScope,
  checkDefaultCeiling,
} from "./ingress";
import { validateImportedPrincipalsConfig, validateScopeMapping } from "../schema";
import type { ScopeMapping, SovereigntyPolicy } from "../types";
import type { MyelinEnvelope } from "../../types";

// myelin#261 (sovereignty engine 2/3). Fixtures copied from the RFC-0001
// conformance pack (`specs/vectors/sovereignty/crossing.json`); vector ids cited
// in test names. Pack not on myelin main → inlined, not imported.
//
// SCOPE NOTE: item 3 (§6.0 link-level partner check / partner-unknown) is NOT
// implemented here — its partner-derivation anchor is contradictory across the
// pack (vector `ingress/mapped-subject-outside-scope-block` expects
// scope-exceeded for a crossing whose sourceSubject partner is unregistered,
// which the §6.0 "before the last-stamp principal is examined" reading would
// reject as partner-unknown). Escalated to Andreas per the #261 item-5 STOP
// rail. So `ingress/partner-unknown-link-rejected` is intentionally left
// failing (deployed collapse into unknown-principal), pending that decision.

function signed(identity: string, requirements?: string[]): MyelinEnvelope {
  return {
    id: "550e8400-e29b-41d4-a716-446655440261",
    source: "acme.default.echo",
    type: "tasks.code-review",
    timestamp: "2026-07-17T00:00:00Z",
    sovereignty: { classification: "federated", data_residency: "CH", max_hop: 1, frontier_ok: false, model_class: "any" },
    signed_by: [{ method: "ed25519", identity, signature: "AA", at: "2026-07-17T00:00:00Z" }],
    payload: {},
    ...(requirements ? { requirements } : {}),
  };
}

const acmeMapping: ScopeMapping = {
  partner_network: "acme",
  imported_principals: ["did:mf:acme.reviewer"],
  local_scope: ["federated.acme.>"],
  max_capabilities: ["code-review"],
};

function policy(over: Partial<SovereigntyPolicy["ingress"]>): SovereigntyPolicy {
  return {
    version: 1,
    network: "metafactory",
    egress: { block_local_escape: true, rules: [] },
    ingress: { scope_mappings: [acmeMapping], reject_unknown_partners: true, ...over },
    chain_of_stamps: { verify_delegation_sovereignty: false },
  };
}

describe("validateIngress — default ceiling closes the permissive trust inversion (RFC-0005 §6.2, D6)", () => {
  it("ingress/unknown-principal-permissive-ceiling-block: unmapped stranger onto local.* is scope-exceeded", () => {
    // Normalized pack input: reject_unknown_partners:false, empty mappings,
    // lastStampPrincipal did:mf:principal.stranger, subject local.acme.tasks.admin.escalate.
    const result = validateIngress(
      signed("did:mf:principal.stranger", ["admin"]),
      "local.acme.tasks.admin.escalate",
      policy({ scope_mappings: [], reject_unknown_partners: false }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("compliance-block:scope-exceeded");
  });

  it("ingress/unknown-principal-permissive-allow: unmapped stranger onto federated.* within default scope is allowed", () => {
    const result = validateIngress(
      signed("did:mf:stranger.agent", ["deploy-prod"]),
      "federated.anywhere.default.x.y.z",
      policy({ reject_unknown_partners: false }),
    );
    expect(result.valid).toBe(true);
  });

  it("D6 both-directions: declaring a partner MUST NOT reduce access relative to a stranger's", () => {
    const subject = "federated.acme.tasks.review";
    // Stranger under the default ceiling reaches the federated subject.
    const strangerResult = validateIngress(
      signed("did:mf:stranger.agent", ["code-review"]),
      subject,
      policy({ scope_mappings: [], reject_unknown_partners: false }),
    );
    expect(strangerResult.valid).toBe(true);
    // The declared partner covering that same subject reaches it too — not less.
    const partnerResult = validateIngress(
      signed("did:mf:acme.reviewer", ["code-review"]),
      subject,
      policy({ reject_unknown_partners: true }),
    );
    expect(partnerResult.valid).toBe(true);
  });

  it("checkDefaultCeiling: an operator-supplied capability ceiling bounds the stranger", () => {
    const blocked = checkDefaultCeiling(
      signed("did:mf:stranger.agent", ["deploy-prod"]),
      "federated.anywhere.x.y",
      { local_scope: ["federated.>"], max_capabilities: ["chat"] },
    );
    expect(blocked.valid).toBe(false);
    if (!blocked.valid) expect(blocked.code).toBe("compliance-block:scope-exceeded");
  });
});

describe("imported_principals config validation — principal-class only (RFC-0005 §6.1, D9)", () => {
  it("ingress/agent-class-import-entry-rejected: agent-class DID entry is rejected → agent-class-entry", () => {
    expect(validateImportedPrincipalsConfig({ imported_principals: ["did:mf:agent.acme.default.echo"] })).toEqual({
      valid: false,
      reason: "agent-class-entry",
    });
  });

  it("accepts a principal-class entry", () => {
    expect(validateImportedPrincipalsConfig({ imported_principals: ["did:mf:principal.acme"] })).toEqual({ valid: true });
  });

  it("validateScopeMapping rejects an agent-class imported_principals entry with a clear error", () => {
    const result = validateScopeMapping({
      partner_network: "acme",
      imported_principals: ["did:mf:agent.acme.default.echo"],
      local_scope: ["federated.acme.>"],
      max_capabilities: ["code-review"],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field.includes("imported_principals") && /principal-class/.test(e.message))).toBe(true);
  });

  it("validateScopeMapping accepts a principal-class entry", () => {
    const result = validateScopeMapping({
      partner_network: "acme",
      imported_principals: ["did:mf:principal.acme"],
      local_scope: ["federated.acme.>"],
      max_capabilities: ["code-review"],
    });
    expect(result.valid).toBe(true);
  });
});

describe("lookupPrincipalScope — principal-component matcher (RFC-0005 §6.1, D9)", () => {
  it("a principal-class entry admits every agent of that principal (class-explicit)", () => {
    const mappings: ScopeMapping[] = [{ ...acmeMapping, imported_principals: ["did:mf:principal.acme"] }];
    expect(lookupPrincipalScope("did:mf:agent.acme.default.echo", mappings)).not.toBeNull();
    expect(lookupPrincipalScope("did:mf:agent.acme.ops.forge", mappings)).not.toBeNull();
    expect(lookupPrincipalScope("did:mf:agent.other.default.echo", mappings)).toBeNull();
  });

  it("legacy (non-class-explicit) DIDs keep matching byte-for-byte", () => {
    const mappings: ScopeMapping[] = [{ ...acmeMapping, imported_principals: ["did:mf:echo", "did:mf:forge"] }];
    expect(lookupPrincipalScope("did:mf:echo", mappings)).not.toBeNull();
    expect(lookupPrincipalScope("did:mf:rogue", mappings)).toBeNull();
  });
});
