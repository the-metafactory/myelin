import { describe, it, expect } from "bun:test";
import { validateEgress } from "./egress";
import type { EgressRule } from "../types";
import type { Classification, MyelinEnvelope } from "../../types";

// myelin#261 (sovereignty engine 2/3, RFC-0005 §4.2/§5.2, grill D4). Fixtures
// copied from the RFC-0001 conformance pack
// (`specs/vectors/sovereignty/crossing.json`, kind `validateEgress`); vector ids
// cited in test names. Pack not on myelin main → inlined, not imported.
//
// Token note: the pack spells the reason `compliance_block:classification-mismatch`
// (post-#233 snake). This implementation keeps the current kebab spelling
// `compliance-block:classification-mismatch` — the snake flip is staged
// separately (myelin#233), and #261 is explicit: do not flip token spellings.

function env(classification: Classification): MyelinEnvelope {
  return {
    id: "550e8400-e29b-41d4-a716-446655440261",
    source: "acme.default.echo",
    type: "ops.x.y",
    timestamp: "2026-07-17T00:00:00Z",
    sovereignty: { classification, data_residency: "CH", max_hop: 0, frontier_ok: classification === "public", model_class: "any" },
    payload: {},
  };
}

describe("validateEgress — strict classification equality (RFC-0005 §4.2, D4)", () => {
  it("egress/public-to-local-block: public envelope on a local.* subject is a mismatch (THE D4 fix)", () => {
    const rules: EgressRule[] = [{ classification: "public", allowed_subjects: ["local.>", "public.>"] }];
    const result = validateEgress(env("public"), "local.metafactory.default.obs.copy.made", rules);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("compliance-block:classification-mismatch");
  });

  it("egress/local-to-federated-block: local envelope cannot publish to a federated.* subject", () => {
    const rules: EgressRule[] = [{ classification: "local", allowed_subjects: ["local.>"] }];
    const result = validateEgress(env("local"), "federated.metafactory.default.code.pr.review", rules);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("compliance-block:classification-mismatch");
  });

  it("egress/local-to-local-allow: strict equality still allows an in-allowlist same-class subject", () => {
    const rules: EgressRule[] = [{ classification: "local", allowed_subjects: ["local.metafactory.>"] }];
    const result = validateEgress(env("local"), "local.metafactory.default.ops.deploy.done", rules);
    expect(result.valid).toBe(true);
  });

  it("federated→federated with matching residency still allows (no regression)", () => {
    const rules: EgressRule[] = [
      { classification: "federated", allowed_subjects: ["federated.>"], data_residency_constraints: { CH: ["federated.ch.>"] } },
    ];
    const result = validateEgress(env("federated"), "federated.ch.default.x.y.z", rules);
    expect(result.valid).toBe(true);
  });
});
