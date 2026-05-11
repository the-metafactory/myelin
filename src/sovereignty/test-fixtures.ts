import type { SovereigntyPolicy } from "./types";

/**
 * Shared sovereignty test fixture — the canonical valid policy used by
 * both unit and integration test suites. Local egress to
 * `local.metafactory.>`, federated egress to metafactory + operator-b,
 * one operator-b scope mapping for `did:mf:echo` with `code-review`
 * capability, chain-of-stamps verification off (default per spec).
 */
export const testPolicy: SovereigntyPolicy = {
  version: 1,
  org: "metafactory",
  egress: {
    block_local_escape: true,
    rules: [
      { classification: "local", allowed_subjects: ["local.metafactory.>"] },
      {
        classification: "federated",
        allowed_subjects: ["federated.metafactory.>", "federated.operator-b.>"],
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
