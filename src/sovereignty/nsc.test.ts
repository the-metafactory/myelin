import { describe, expect, it } from "bun:test";
import {
  generateExportCommands,
  generateFederationScript,
  generateImportCommands,
} from "./nsc";
import { testPolicy } from "./test-fixtures";
import type { ScopeMapping, SovereigntyPolicy } from "./types";

describe("generateExportCommands", () => {
  it("emits header comments + delete-then-add for each exportable subject", () => {
    const lines = generateExportCommands(testPolicy);

    // Header
    expect(lines[0]).toBe("# myelin sovereignty exports for org: metafactory");
    expect(lines.some((l) => l.includes("Re-run safely"))).toBe(true);

    // testPolicy exports:
    //   federated.metafactory.>
    //   federated.operator-b.>
    //   public.>
    // local.metafactory.> is NOT exported (local classification excluded).
    expect(lines.some((l) => l.includes("--subject 'federated.metafactory.>'"))).toBe(true);
    expect(lines.some((l) => l.includes("--subject 'federated.operator-b.>'"))).toBe(true);
    expect(lines.some((l) => l.includes("--subject 'public.>'"))).toBe(true);

    // delete pairs precede add pairs for each subject
    const deletes = lines.filter((l) => l.startsWith("nsc delete export"));
    const adds = lines.filter((l) => l.startsWith("nsc add export"));
    expect(deletes.length).toBe(3);
    expect(adds.length).toBe(3);

    // Default stream kind
    for (const add of adds) {
      expect(add.endsWith(" --stream")).toBe(true);
    }
  });

  it("excludes local-classified subjects", () => {
    const lines = generateExportCommands(testPolicy);
    expect(lines.some((l) => l.includes("'local.metafactory.>'"))).toBe(false);
  });

  it("dedupes subjects appearing in multiple rules", () => {
    const policy: SovereigntyPolicy = {
      ...testPolicy,
      egress: {
        ...testPolicy.egress,
        rules: [
          { classification: "federated", allowed_subjects: ["federated.metafactory.>"] },
          { classification: "public", allowed_subjects: ["federated.metafactory.>", "public.>"] },
        ],
      },
    };
    const lines = generateExportCommands(policy);
    const adds = lines.filter((l) => l.startsWith("nsc add export"));
    expect(adds.length).toBe(2);
    expect(adds.filter((l) => l.includes("'federated.metafactory.>'")).length).toBe(1);
    expect(adds.filter((l) => l.includes("'public.>'")).length).toBe(1);
  });

  it("honors account override", () => {
    const lines = generateExportCommands(testPolicy, { account: "metafactory-prod" });
    const adds = lines.filter((l) => l.startsWith("nsc add export"));
    for (const add of adds) {
      expect(add).toContain("--account metafactory-prod");
    }
  });

  it("honors service export kind", () => {
    const lines = generateExportCommands(testPolicy, { exportKind: "service" });
    const adds = lines.filter((l) => l.startsWith("nsc add export"));
    for (const add of adds) {
      expect(add.endsWith(" --service")).toBe(true);
    }
  });

  it("uses ${ACCOUNT} shell placeholder by default", () => {
    const lines = generateExportCommands(testPolicy);
    expect(lines.some((l) => l.includes("--account ${ACCOUNT}"))).toBe(true);
  });

  it("is deterministic — same policy yields same output", () => {
    const a = generateExportCommands(testPolicy);
    const b = generateExportCommands(testPolicy);
    expect(a).toEqual(b);
  });

  it("idempotent: re-running the delete+add pair leaves the same end state", () => {
    // Each subject yields exactly one delete and one add — running the
    // script twice produces 2x deletes and 2x adds, but the delete
    // tolerates missing entries (|| true) and the add lands the same
    // entry, so the net state is identical.
    const lines = generateExportCommands(testPolicy);
    for (const subject of [
      "federated.metafactory.>",
      "federated.operator-b.>",
      "public.>",
    ]) {
      const deletePair = lines.find(
        (l) => l.startsWith("nsc delete export") && l.includes(`'${subject}'`),
      );
      const addPair = lines.find(
        (l) => l.startsWith("nsc add export") && l.includes(`'${subject}'`),
      );
      expect(deletePair).toBeDefined();
      expect(addPair).toBeDefined();
      expect(deletePair).toContain("|| true");
    }
  });

  it("emits no commands when egress rules are empty", () => {
    const policy: SovereigntyPolicy = {
      ...testPolicy,
      egress: { block_local_escape: true, rules: [] },
    };
    const lines = generateExportCommands(policy);
    // Header still emitted, but no nsc commands
    expect(lines.some((l) => l.startsWith("nsc "))).toBe(false);
  });
});

describe("generateImportCommands", () => {
  const mapping: ScopeMapping = testPolicy.ingress.scope_mappings[0]!;

  it("emits header comments including imported principals", () => {
    const lines = generateImportCommands(mapping);
    expect(lines[0]).toBe("# myelin sovereignty imports from partner: operator-b");
    expect(lines.some((l) => l.includes("did:mf:echo"))).toBe(true);
  });

  it("emits delete-then-add per local_scope subject", () => {
    const lines = generateImportCommands(mapping);
    const deletes = lines.filter((l) => l.startsWith("nsc delete import"));
    const adds = lines.filter((l) => l.startsWith("nsc add import"));
    expect(deletes.length).toBe(1);
    expect(adds.length).toBe(1);
    expect(adds[0]!).toContain("--subject 'federated.operator-b.tasks.>'");
  });

  it("uses partner-org-derived shell placeholder for partner account key", () => {
    const lines = generateImportCommands(mapping);
    expect(lines.some((l) => l.includes("${PARTNER_ACCOUNT_OPERATOR_B}"))).toBe(true);
    const adds = lines.filter((l) => l.startsWith("nsc add import"));
    for (const add of adds) {
      expect(add).toContain("--src-account ${PARTNER_ACCOUNT_OPERATOR_B}");
    }
  });

  it("handles partner orgs with hyphens and digits in placeholder normalization", () => {
    const partnerMapping: ScopeMapping = {
      partner_org: "operator-c-2",
      imported_principals: ["did:mf:agent"],
      local_scope: ["federated.operator-c-2.tasks.>"],
      max_capabilities: ["search"],
    };
    const lines = generateImportCommands(partnerMapping);
    expect(lines.some((l) => l.includes("${PARTNER_ACCOUNT_OPERATOR_C_2}"))).toBe(true);
  });

  it("handles empty imported_principals gracefully", () => {
    const emptyMapping: ScopeMapping = {
      partner_org: "operator-x",
      imported_principals: [],
      local_scope: ["federated.operator-x.tasks.>"],
      max_capabilities: [],
    };
    const lines = generateImportCommands(emptyMapping);
    expect(lines.some((l) => l.includes("(none configured)"))).toBe(true);
  });

  it("dedupes repeated local_scope subjects", () => {
    const dupMapping: ScopeMapping = {
      partner_org: "operator-b",
      imported_principals: ["did:mf:echo"],
      local_scope: ["federated.operator-b.tasks.>", "federated.operator-b.tasks.>"],
      max_capabilities: ["code-review"],
    };
    const lines = generateImportCommands(dupMapping);
    const adds = lines.filter((l) => l.startsWith("nsc add import"));
    expect(adds.length).toBe(1);
  });

  it("delete commands tolerate missing entries via || true", () => {
    const lines = generateImportCommands(mapping);
    const deletes = lines.filter((l) => l.startsWith("nsc delete import"));
    for (const del of deletes) {
      expect(del).toContain("|| true");
    }
  });

  it("emits commands using ${ACCOUNT} placeholder by default", () => {
    const lines = generateImportCommands(mapping);
    const adds = lines.filter((l) => l.startsWith("nsc add import"));
    expect(adds.length).toBeGreaterThan(0);
    for (const add of adds) {
      expect(add).toContain("--account ${ACCOUNT}");
    }
  });

  it("honors account override", () => {
    const lines = generateImportCommands(mapping, { account: "myelin" });
    const adds = lines.filter((l) => l.startsWith("nsc add import"));
    for (const add of adds) {
      expect(add).toContain("--account myelin");
    }
  });

  it("is deterministic — same mapping yields same output", () => {
    const a = generateImportCommands(mapping);
    const b = generateImportCommands(mapping);
    expect(a).toEqual(b);
  });
});

describe("generateFederationScript", () => {
  it("concatenates exports + imports for every scope mapping", () => {
    const lines = generateFederationScript(testPolicy);
    // Exports first
    expect(lines.some((l) => l.startsWith("nsc add export"))).toBe(true);
    // Then imports
    expect(lines.some((l) => l.startsWith("nsc add import"))).toBe(true);
    // Imports header for operator-b
    expect(lines.some((l) => l.includes("from partner: operator-b"))).toBe(true);
  });

  it("emits exports before imports", () => {
    const lines = generateFederationScript(testPolicy);
    const firstAddExport = lines.findIndex((l) => l.startsWith("nsc add export"));
    const firstAddImport = lines.findIndex((l) => l.startsWith("nsc add import"));
    expect(firstAddExport).toBeGreaterThanOrEqual(0);
    expect(firstAddImport).toBeGreaterThan(firstAddExport);
  });

  it("emits exports only when no scope mappings are configured", () => {
    const policy: SovereigntyPolicy = {
      ...testPolicy,
      ingress: { scope_mappings: [], reject_unknown_partners: true },
    };
    const lines = generateFederationScript(policy);
    expect(lines.some((l) => l.startsWith("nsc add export"))).toBe(true);
    expect(lines.some((l) => l.startsWith("nsc add import"))).toBe(false);
  });

  it("multiple scope mappings produce multiple import sections", () => {
    const policy: SovereigntyPolicy = {
      ...testPolicy,
      ingress: {
        scope_mappings: [
          {
            partner_org: "operator-b",
            imported_principals: ["did:mf:echo"],
            local_scope: ["federated.operator-b.tasks.>"],
            max_capabilities: ["code-review"],
          },
          {
            partner_org: "operator-c",
            imported_principals: ["did:mf:gamma"],
            local_scope: ["federated.operator-c.tasks.>"],
            max_capabilities: ["search"],
          },
        ],
        reject_unknown_partners: true,
      },
    };
    const lines = generateFederationScript(policy);
    expect(lines.some((l) => l.includes("from partner: operator-b"))).toBe(true);
    expect(lines.some((l) => l.includes("from partner: operator-c"))).toBe(true);
  });

  it("is deterministic — same policy yields same output", () => {
    const a = generateFederationScript(testPolicy);
    const b = generateFederationScript(testPolicy);
    expect(a).toEqual(b);
  });
});

describe("shell-safety guard", () => {
  it("throws on export subjects containing a literal single quote", () => {
    const policy: SovereigntyPolicy = {
      ...testPolicy,
      egress: {
        block_local_escape: true,
        rules: [
          { classification: "federated", allowed_subjects: ["federated.foo'bar.>"] },
        ],
      },
    };
    expect(() => generateExportCommands(policy)).toThrow(/single quote/i);
  });

  it("throws on import local_scope containing a literal single quote", () => {
    const mapping: ScopeMapping = {
      partner_org: "operator-b",
      imported_principals: ["did:mf:echo"],
      local_scope: ["federated.operator-b.foo'bar.>"],
      max_capabilities: ["code-review"],
    };
    expect(() => generateImportCommands(mapping)).toThrow(/single quote/i);
  });

  it("error message names the offending subject", () => {
    const policy: SovereigntyPolicy = {
      ...testPolicy,
      egress: {
        block_local_escape: true,
        rules: [
          { classification: "federated", allowed_subjects: ["federated.x'y.>"] },
        ],
      },
    };
    expect(() => generateExportCommands(policy)).toThrow(/federated\.x'y\.>/);
  });

  it("accepts subjects with all other shell metacharacters because they're inside single quotes", () => {
    // `$`, backtick, `\`, `*`, `>` are all valid inside single quotes
    // and are part of NATS subject grammar (wildcards). They must not
    // trigger the guard — only literal `'` does.
    const policy: SovereigntyPolicy = {
      ...testPolicy,
      egress: {
        block_local_escape: true,
        rules: [
          { classification: "federated", allowed_subjects: ["federated.*.>"] },
        ],
      },
    };
    expect(() => generateExportCommands(policy)).not.toThrow();
  });
});

describe("nsc command syntax sanity", () => {
  it("all generated nsc lines start with a recognized verb", () => {
    const lines = generateFederationScript(testPolicy);
    for (const line of lines) {
      if (!line.startsWith("nsc ")) continue;
      const isKnown =
        line.startsWith("nsc add export ") ||
        line.startsWith("nsc add import ") ||
        line.startsWith("nsc delete export ") ||
        line.startsWith("nsc delete import ");
      expect(isKnown).toBe(true);
    }
  });

  it("every subject argument is single-quoted (suppresses shell expansion)", () => {
    const lines = generateFederationScript(testPolicy);
    for (const line of lines) {
      if (!line.startsWith("nsc ")) continue;
      const subjectFlagIdx = line.indexOf("--subject ");
      if (subjectFlagIdx === -1) continue;
      const after = line.slice(subjectFlagIdx + "--subject ".length);
      expect(after.startsWith("'")).toBe(true);
    }
  });

  it("never emits double-quoted subject arguments — single-quote-only invariant", () => {
    // Defense-in-depth against shell expansion ($(...), backticks, \).
    // Single quotes are the only quoting form that suppresses ALL bash
    // expansion. A policy value smuggling shell metacharacters into a
    // subject would otherwise execute when the operator runs the script.
    const lines = generateFederationScript(testPolicy);
    for (const line of lines) {
      if (!line.startsWith("nsc ")) continue;
      expect(line.includes('--subject "')).toBe(false);
    }
  });

  it("every add export carries a stable --name", () => {
    const lines = generateExportCommands(testPolicy);
    const adds = lines.filter((l) => l.startsWith("nsc add export"));
    for (const add of adds) {
      expect(add).toMatch(/--name myelin-export-\S+/);
    }
  });

  it("every add import carries a stable --name", () => {
    const lines = generateImportCommands(testPolicy.ingress.scope_mappings[0]!);
    const adds = lines.filter((l) => l.startsWith("nsc add import"));
    for (const add of adds) {
      expect(add).toMatch(/--name myelin-import-\S+/);
    }
  });
});
