import { describe, it, expect } from "bun:test";
import { validatePolicy, validateEgressRule, validateScopeMapping, assertPolicy } from "./schema";
import type { SovereigntyPolicy } from "./types";

const validPolicy: SovereigntyPolicy = {
  version: 1,
  org: "metafactory",
  egress: {
    block_local_escape: true,
    rules: [
      {
        classification: "local",
        allowed_subjects: ["local.metafactory.>"],
        data_residency_constraints: { CH: ["local.>"] },
      },
      { classification: "federated", allowed_subjects: ["federated.metafactory.>", "federated.*.tasks.>"] },
      { classification: "public", allowed_subjects: ["public.>"] },
    ],
  },
  ingress: {
    scope_mappings: [
      {
        partner_org: "operator-b",
        imported_principals: ["did:mf:echo", "did:mf:forge"],
        local_scope: ["federated.operator-b.tasks.>"],
        max_capabilities: ["code-review"],
      },
    ],
    reject_unknown_partners: true,
  },
  chain_of_stamps: { verify_delegation_sovereignty: false },
};

describe("validatePolicy", () => {
  it("accepts spec-shaped policy", () => {
    const result = validatePolicy(validPolicy);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects non-object", () => {
    const result = validatePolicy("nope");
    expect(result.valid).toBe(false);
  });

  it("rejects wrong version", () => {
    const bad = { ...validPolicy, version: 2 };
    const result = validatePolicy(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "version")).toBe(true);
  });

  it("rejects bad org grammar", () => {
    const bad = { ...validPolicy, org: "Meta_Factory" };
    const result = validatePolicy(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "org")).toBe(true);
  });

  it("rejects missing egress", () => {
    const { egress: _e, ...rest } = validPolicy as any;
    const result = validatePolicy(rest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "egress")).toBe(true);
  });

  it("rejects unknown classification in rule", () => {
    const bad = {
      ...validPolicy,
      egress: { block_local_escape: true, rules: [{ classification: "secret", allowed_subjects: ["local.>"] }] },
    };
    const result = validatePolicy(bad);
    expect(result.valid).toBe(false);
  });

  it("rejects ingress missing reject_unknown_partners", () => {
    const bad = { ...validPolicy, ingress: { scope_mappings: [], reject_unknown_partners: undefined as any } };
    const result = validatePolicy(bad);
    expect(result.valid).toBe(false);
  });

  it("rejects bad residency code (lowercase)", () => {
    const bad = {
      ...validPolicy,
      egress: {
        block_local_escape: true,
        rules: [
          {
            classification: "local",
            allowed_subjects: ["local.>"],
            data_residency_constraints: { ch: ["local.>"] },
          },
        ],
      },
    };
    const result = validatePolicy(bad);
    expect(result.valid).toBe(false);
  });

  it("rejects '>' wildcard not at end", () => {
    const bad = {
      ...validPolicy,
      egress: {
        block_local_escape: true,
        rules: [{ classification: "local", allowed_subjects: ["local.>.tasks"] }],
      },
    };
    const result = validatePolicy(bad);
    expect(result.valid).toBe(false);
  });

  it("rejects bad DID in scope mapping", () => {
    const bad = {
      ...validPolicy,
      ingress: {
        scope_mappings: [
          {
            partner_org: "operator-b",
            imported_principals: ["not-a-did"],
            local_scope: ["federated.operator-b.>"],
            max_capabilities: [],
          },
        ],
        reject_unknown_partners: true,
      },
    };
    const result = validatePolicy(bad);
    expect(result.valid).toBe(false);
  });

  it("rejects DID with consecutive hyphens (DID_RE injectivity)", () => {
    const bad = {
      ...validPolicy,
      ingress: {
        scope_mappings: [
          {
            partner_org: "operator-b",
            imported_principals: ["did:mf:hub--metafactory"],
            local_scope: ["federated.operator-b.>"],
            max_capabilities: [],
          },
        ],
        reject_unknown_partners: true,
      },
    };
    const result = validatePolicy(bad);
    expect(result.valid).toBe(false);
  });

  it("rejects bad capability tag", () => {
    const bad = {
      ...validPolicy,
      ingress: {
        scope_mappings: [
          {
            partner_org: "operator-b",
            imported_principals: ["did:mf:echo"],
            local_scope: ["federated.operator-b.>"],
            max_capabilities: ["Code_Review"],
          },
        ],
        reject_unknown_partners: true,
      },
    };
    const result = validatePolicy(bad);
    expect(result.valid).toBe(false);
  });
});

describe("validateEgressRule", () => {
  it("accepts a minimal rule", () => {
    const rule = { classification: "local", allowed_subjects: ["local.>"] };
    expect(validateEgressRule(rule).valid).toBe(true);
  });

  it("rejects empty allowed_subjects", () => {
    const rule = { classification: "local", allowed_subjects: [] };
    expect(validateEgressRule(rule).valid).toBe(false);
  });
});

describe("validateScopeMapping", () => {
  it("accepts a minimal mapping", () => {
    const mapping = {
      partner_org: "operator-b",
      imported_principals: ["did:mf:echo"],
      local_scope: ["federated.operator-b.>"],
      max_capabilities: [],
    };
    expect(validateScopeMapping(mapping).valid).toBe(true);
  });

  it("rejects bad partner_org", () => {
    const mapping = {
      partner_org: "Operator B",
      imported_principals: ["did:mf:echo"],
      local_scope: ["federated.b.>"],
      max_capabilities: [],
    };
    expect(validateScopeMapping(mapping).valid).toBe(false);
  });
});

describe("assertPolicy", () => {
  it("throws on invalid", () => {
    expect(() => assertPolicy({})).toThrow(/invalid sovereignty policy/);
  });

  it("does not throw on valid", () => {
    expect(() => assertPolicy(validPolicy)).not.toThrow();
  });
});
