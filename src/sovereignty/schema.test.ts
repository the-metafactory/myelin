import { describe, it, expect } from "bun:test";
import { validatePolicy, validateEgressRule, validateScopeMapping, assertPolicy } from "./schema";
import type { SovereigntyPolicy } from "./types";

const validPolicy: SovereigntyPolicy = {
  version: 1,
  network: "metafactory",
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
        partner_network: "principal-b",
        imported_principals: ["did:mf:echo", "did:mf:forge"],
        local_scope: ["federated.principal-b.tasks.>"],
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

  it("rejects bad network grammar", () => {
    const bad = { ...validPolicy, network: "Meta_Factory" };
    const result = validatePolicy(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "network")).toBe(true);
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
            partner_network: "principal-b",
            imported_principals: ["not-a-did"],
            local_scope: ["federated.principal-b.>"],
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
            partner_network: "principal-b",
            imported_principals: ["did:mf:hub--metafactory"],
            local_scope: ["federated.principal-b.>"],
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
            partner_network: "principal-b",
            imported_principals: ["did:mf:echo"],
            local_scope: ["federated.principal-b.>"],
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
      partner_network: "principal-b",
      imported_principals: ["did:mf:echo"],
      local_scope: ["federated.principal-b.>"],
      max_capabilities: [],
    };
    expect(validateScopeMapping(mapping).valid).toBe(true);
  });

  it("rejects bad partner_network", () => {
    const mapping = {
      partner_network: "Operator B",
      imported_principals: ["did:mf:echo"],
      local_scope: ["federated.b.>"],
      max_capabilities: [],
    };
    expect(validateScopeMapping(mapping).valid).toBe(false);
  });
});

/**
 * R4 transition (vocabulary migration 2026-05, PR-8) — `SovereigntyPolicy`
 * is local operator config persisted in the `SOVEREIGNTY_POLICY` KV
 * bucket; it does NOT travel inside the signed envelope `sovereignty`
 * wire field (that is the unrelated `Sovereignty` interface in
 * `src/types.ts`). It is therefore not signed-canonical content — the
 * validator simply accepts the deprecated `org` / `partner_org` keys on
 * read for one minor cycle so a pre-migration policy JSON still loads.
 * The strict `dual_field_conflict` rejection (used at signed-envelope
 * trust boundaries) deliberately does NOT apply here: a config object
 * has no signature-bytes boundary to defend, so the reader simply
 * prefers the canonical key when both are present.
 */
describe("R4 config-rename transition (org/network, partner_org/partner_network)", () => {
  it("accepts a policy carrying the deprecated `org` key", () => {
    const { network: _network, ...rest } = validPolicy as unknown as Record<string, unknown>;
    const oldShape = { ...rest, org: "metafactory" };
    const result = validatePolicy(oldShape);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("accepts a policy carrying the canonical `network` key", () => {
    expect(validatePolicy(validPolicy).valid).toBe(true);
  });

  it("rejects a policy missing both `org` and `network`", () => {
    const { network: _network, ...rest } = validPolicy as unknown as Record<string, unknown>;
    const result = validatePolicy(rest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "network")).toBe(true);
  });

  it("prefers the canonical `network` key when both are present", () => {
    // Config is not a signed-envelope trust boundary — both-keys is not
    // rejected; the reader resolves to the canonical value.
    const bothKeys = { ...validPolicy, org: "Bad_Old_Value" } as unknown;
    expect(validatePolicy(bothKeys).valid).toBe(true);
  });

  it("accepts a scope mapping carrying the deprecated `partner_org` key", () => {
    const oldShape = {
      partner_org: "principal-b",
      imported_principals: ["did:mf:echo"],
      local_scope: ["federated.principal-b.>"],
      max_capabilities: [],
    };
    expect(validateScopeMapping(oldShape).valid).toBe(true);
  });

  it("accepts a scope mapping carrying the canonical `partner_network` key", () => {
    const newShape = {
      partner_network: "principal-b",
      imported_principals: ["did:mf:echo"],
      local_scope: ["federated.principal-b.>"],
      max_capabilities: [],
    };
    expect(validateScopeMapping(newShape).valid).toBe(true);
  });

  it("rejects a scope mapping missing both `partner_org` and `partner_network`", () => {
    const noPartner = {
      imported_principals: ["did:mf:echo"],
      local_scope: ["federated.principal-b.>"],
      max_capabilities: [],
    };
    const result = validateScopeMapping(noPartner);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "mapping.partner_network")).toBe(true);
  });

  it("accepts an old-shape policy whose scope mapping also uses `partner_org`", () => {
    // End-to-end: a fully pre-migration policy JSON (top-level `org` +
    // mapping `partner_org`) still validates through the transition.
    const oldShape = {
      version: 1,
      org: "metafactory",
      egress: { block_local_escape: true, rules: [] },
      ingress: {
        scope_mappings: [
          {
            partner_org: "principal-b",
            imported_principals: ["did:mf:echo"],
            local_scope: ["federated.principal-b.tasks.>"],
            max_capabilities: ["code-review"],
          },
        ],
        reject_unknown_partners: true,
      },
      chain_of_stamps: { verify_delegation_sovereignty: false },
    };
    expect(validatePolicy(oldShape).valid).toBe(true);
  });
});

describe("assertPolicy", () => {
  it("throws on invalid", () => {
    expect(() => { assertPolicy({}); }).toThrow(/invalid sovereignty policy/);
  });

  it("does not throw on valid", () => {
    expect(() => { assertPolicy(validPolicy); }).not.toThrow();
  });
});
