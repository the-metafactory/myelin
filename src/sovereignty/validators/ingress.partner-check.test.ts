import { describe, it, expect } from "bun:test";
import { validateIngress, sourceSubjectPartner, buildPartnerRegistry } from "./ingress";
import type { ScopeMapping, SovereigntyPolicy } from "../types";
import type { MyelinEnvelope } from "../../types";

// myelin#261 item 3 — §6.0 link-level partner check (engine half).
// Derivation pinned by Andreas 2026-07-17 (STOP-AND-ASK resolved on #261):
// partner = sourceSubject 2nd segment, tested against the partner registry
// (scope_mappings partner_network values + optional partner_roster), BEFORE
// principal lookup; unknown → partner-unknown under reject_unknown_partners.
//
// Fixtures inlined from the RFC-0001 conformance pack
// (`specs/vectors/sovereignty/crossing.json`); ids cited in test names. The
// crossing.json re-cut of `ingress/mapped-subject-outside-scope-block` (declare
// 'other' in its config) is a SEPARATE PR after the pack lands — here the
// re-cut form is exercised inline.
//
// Token note: the pack spells the reason `compliance_block:partner-unknown`
// (post-#233 snake); this implementation keeps the current kebab
// `compliance-block:partner-unknown` (snake flip staged with #233).

function signed(identity: string, requirements?: string[]): MyelinEnvelope {
  return {
    id: "550e8400-e29b-41d4-a716-446655440261",
    source: "acme.default.echo",
    type: "tasks.chat",
    timestamp: "2026-07-17T00:00:00Z",
    sovereignty: { classification: "federated", data_residency: "CH", max_hop: 1, frontier_ok: false, model_class: "any" },
    signed_by: [{ method: "ed25519", identity, signature: "AA", at: "2026-07-17T00:00:00Z" }],
    payload: {},
    ...(requirements ? { requirements } : {}),
  };
}

const acmeMapping: ScopeMapping = {
  partner_network: "acme",
  imported_principals: ["did:mf:principal.acme"],
  local_scope: ["federated.acme.>"],
  max_capabilities: ["chat"],
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

describe("sourceSubjectPartner / buildPartnerRegistry", () => {
  it("extracts the 2nd segment of a federated subject; exempts local/public", () => {
    expect(sourceSubjectPartner("federated.stranger.ops.tasks.chat.general")).toBe("stranger");
    expect(sourceSubjectPartner("federated.acme.default.code.pr.review")).toBe("acme");
    expect(sourceSubjectPartner("local.metafactory.secrets")).toBeNull();
    expect(sourceSubjectPartner("public.x.y")).toBeNull();
  });

  it("registry unions partner_network values and the optional partner_roster", () => {
    const reg = buildPartnerRegistry({ scope_mappings: [acmeMapping], reject_unknown_partners: true, partner_roster: ["beta"] });
    expect([...reg].sort()).toEqual(["acme", "beta"]);
  });
});

describe("validateIngress — §6.0 link-level partner check (myelin#261 item 3)", () => {
  it("ingress/partner-unknown-link-rejected: crossing from an unregistered partner → partner-unknown", () => {
    const result = validateIngress(
      signed("did:mf:agent.stranger.ops.bot"),
      "federated.stranger.ops.tasks.chat.general",
      policy({ reject_unknown_partners: true }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("compliance-block:partner-unknown");
  });

  it("partner-unknown fires BEFORE principal lookup (unmapped principal from unregistered partner still reads as partner-unknown)", () => {
    const result = validateIngress(
      signed("did:mf:principal.whoever"),
      "federated.stranger.ops.x.y",
      policy({ reject_unknown_partners: true }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("compliance-block:partner-unknown");
  });

  it("ingress/mapped-subject-outside-scope-block (re-cut): partner 'other' DECLARED → passes link, fails scope", () => {
    // The re-cut: 'other' is a registered partner (roster), so the §6.0 check
    // passes and the vector's subject test (scope) is reached. The mapped
    // principal did:mf:principal.acme carries a subject outside its local_scope.
    const result = validateIngress(
      signed("did:mf:principal.acme"),
      "federated.other.default.code.pr.review",
      policy({ reject_unknown_partners: true, partner_roster: ["other"] }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("compliance-block:scope-exceeded");
  });

  it("ingress/mapped-in-scope-allow: registered partner + mapped principal in scope → allow", () => {
    const result = validateIngress(
      signed("did:mf:principal.acme", ["chat"]),
      "federated.acme.default.code.pr.review",
      policy({ reject_unknown_partners: true }),
    );
    expect(result.valid).toBe(true);
  });

  it("ingress/unknown-principal-reject: EMPTY registry falls through to principal check → unknown-principal (NOT partner-unknown)", () => {
    const result = validateIngress(
      signed("did:mf:stranger.agent"),
      "federated.anywhere.default.x.y.z",
      policy({ scope_mappings: [], reject_unknown_partners: true }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("compliance-block:unknown-principal");
  });

  it("permissive mode (reject_unknown_partners:false) skips the partner check entirely", () => {
    // Unregistered partner, but permissive → no partner-unknown; the default
    // ceiling applies (federated subject within federated.>) → allow.
    const result = validateIngress(
      signed("did:mf:stranger.agent"),
      "federated.stranger.default.x.y.z",
      policy({ reject_unknown_partners: false }),
    );
    expect(result.valid).toBe(true);
  });

  it("local.* crossing is exempt from the partner check (mapped principal, subject test only)", () => {
    // A mapped principal on a local.* subject: no partner link, so scope alone
    // decides — the subject is outside local_scope → scope-exceeded, never
    // partner-unknown.
    const result = validateIngress(
      signed("did:mf:principal.acme"),
      "local.metafactory.secrets",
      policy({ reject_unknown_partners: true }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("compliance-block:scope-exceeded");
  });
});
