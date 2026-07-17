/**
 * Tests for flag-day-inventory (myelin#287) — proves the three things acceptance
 * turns on: (1) the classifier's states are correct on fixture strings (the hard
 * part — kebab/snake/domain-legitimate + the src/wire copy rule), (2) --enforce
 * exit codes track legacy-remaining, (3) the --json shape is stable, and (4) the
 * manifest reconciliation is a real bidirectional presence guard.
 */
import { describe, expect, test } from "bun:test";
import {
  buildCategories,
  buildReport,
  fileImportsWire,
  isDeployedSchema,
  isLiveCode,
  main,
  reconcileManifest,
  scanTree,
  type CategoryResult,
} from "./flag-day-inventory";

/** A fixture repo: rel-path → file content, driven through the injected IO. */
function fixtureScan(files: Record<string, string>, categories = buildCategories()): CategoryResult[] {
  return scanTree({
    root: "/fake",
    categories,
    listFiles: () => Object.keys(files),
    readFile: (rel) => files[rel] ?? "",
  });
}

function byId(results: CategoryResult[], id: string): CategoryResult {
  const c = results.find((r) => r.id === id);
  if (!c) throw new Error(`category ${id} not found`);
  return c;
}

describe("scope predicates", () => {
  test("live code is src/**/*.ts minus tests + generated", () => {
    expect(isLiveCode("src/transport/nak.ts")).toBe(true);
    expect(isLiveCode("src/transport/nak.test.ts")).toBe(false);
    expect(isLiveCode("src/transport/nak.spec.ts")).toBe(false);
    expect(isLiveCode("src/wire/generated/r/foo.ts")).toBe(false);
    expect(isLiveCode("tests/integration/x.ts")).toBe(false);
    expect(isLiveCode("docs/plan.md")).toBe(false);
    expect(isLiveCode("specs/rfc/vectors/x.ts")).toBe(false);
  });

  test("deployed schema is only the one envelope schema", () => {
    expect(isDeployedSchema("schemas/envelope.schema.json")).toBe(true);
    expect(isDeployedSchema("src/wire/generated/r/envelope.schema.json")).toBe(false);
  });

  test("fileImportsWire detects a relative ./wire import", () => {
    expect(fileImportsWire('import { parseDid } from "./wire";')).toBe(true);
    expect(fileImportsWire('import { parseDid } from "../wire/identity";')).toBe(true);
    expect(fileImportsWire('import { parseDid } from "./local-codec";')).toBe(false);
  });
});

describe("NAK classifier — kebab/snake/domain-legitimate", () => {
  const files = {
    "src/transport/nak.ts": [
      `const a = "cant-do";`, // kebab → legacy
      `const b = "compliance-block";`, // kebab → legacy
      `const c = "cant_do";`, // snake → migrated
      `const d = "not_now";`, // snake → migrated
    ].join("\n"),
  };

  test("kebab is legacy, snake is migrated", () => {
    const nak = byId(fixtureScan(files), "nak-literals");
    expect(nak.counts.legacy).toBe(2);
    expect(nak.counts.migrated).toBe(2);
    expect(nak.counts.domainLegitimate).toBe(0);
    const legacy = nak.sites.filter((s) => s.classification === "legacy").map((s) => s.match).sort();
    expect(legacy).toEqual(["cant-do", "compliance-block"]);
  });

  test("domainLegitimate excludes mark a line as domain-legitimate (cortex-twin path)", () => {
    // Simulate the cortex CC-substrate exclude: a snake token on a DispatchTaskFailedReason line.
    const excludeFiles = {
      "src/runner/dispatch.ts": `const r: DispatchTaskFailedReason = "compliance_block";`,
    };
    const cats = buildCategories({ domainLegitimate: [/DispatchTaskFailedReason/] });
    const nak = byId(fixtureScan(excludeFiles, cats), "nak-literals");
    expect(nak.counts.domainLegitimate).toBe(1);
    expect(nak.counts.legacy).toBe(0);
    expect(nak.counts.migrated).toBe(0);
  });
});

describe("regex-copy classifier — src/wire is the migrated home", () => {
  const files = {
    "src/wire/identity.ts": `const DID_RE = /did:mf:[a-z]/; export const CAPABILITY_TAG_RE = /x/;`,
    "src/identity/helpers.ts": `const DID_RE = /did:mf:[a-z]/;`, // hand-written copy → legacy
  };

  test("a DID regex in src/wire is migrated, a copy outside is legacy", () => {
    const results = fixtureScan(files);
    const did = byId(results, "did-regex-defs");
    // Two DID_RE + two did:mf:[a-z] literals across the two files.
    const wireSites = did.sites.filter((s) => s.file.startsWith("src/wire/"));
    const copySites = did.sites.filter((s) => !s.file.startsWith("src/wire/"));
    expect(wireSites.every((s) => s.classification === "migrated")).toBe(true);
    expect(copySites.every((s) => s.classification === "legacy")).toBe(true);
    expect(did.counts.legacy).toBeGreaterThan(0);
    expect(did.counts.migrated).toBeGreaterThan(0);
  });

  test("codec call migrated iff file imports ./wire or lives in src/wire", () => {
    const callFiles = {
      "src/engine/a.ts": `import { parseDid } from "./wire";\nparseDid(x);`, // migrated
      "src/engine/b.ts": `parseDid(x); // local hand-written codec`, // legacy
    };
    const calls = byId(fixtureScan(callFiles), "did-codec-calls");
    // a.ts imports the codec from ./wire — every parseDid reference there
    // (including the import line) is migrated; b.ts calls a local copy → legacy.
    const migrated = [...new Set(calls.sites.filter((s) => s.classification === "migrated").map((s) => s.file))];
    const legacy = [...new Set(calls.sites.filter((s) => s.classification === "legacy").map((s) => s.file))];
    expect(migrated).toEqual(["src/engine/a.ts"]);
    expect(legacy).toEqual(["src/engine/b.ts"]);
  });
});

describe("F-11 + schema + subject categories are legacy-by-presence", () => {
  test("F-11 symbols are all legacy until retired", () => {
    const files = { "src/agent-identity/helpers.ts": `export function registerCapabilities() {}` };
    const f11 = byId(fixtureScan(files), "f11-symbols");
    expect(f11.counts.legacy).toBe(1);
    expect(f11.counts.migrated).toBe(0);
  });

  test("schema DID category scopes to the deployed schema only", () => {
    const files = {
      "schemas/envelope.schema.json": `{ "pattern": "^did:mf:[a-z]" }`,
      "src/wire/generated/r/envelope.schema.json": `{ "pattern": "^did:mf:[a-z]" }`,
    };
    const schema = byId(fixtureScan(files), "schema-did-patterns");
    expect(schema.sites).toHaveLength(1);
    expect(schema.sites[0]!.file).toBe("schemas/envelope.schema.json");
    expect(schema.sites[0]!.classification).toBe("legacy");
  });
});

describe("manifest reconciliation — bidirectional presence guard", () => {
  test("legacy sites present AND manifest entries present → agrees", () => {
    const categories: CategoryResult[] = [
      {
        id: "nak-literals",
        title: "t",
        counts: { legacy: 5, migrated: 0, domainLegitimate: 0, total: 5 },
        sites: [],
        manifestIssues: ["myelin#233"],
      },
    ];
    const manifest = { "v/1": { issue: "myelin#233" }, "v/2": { issue: "myelin#233" } };
    const r = reconcileManifest(categories, manifest);
    expect(r.manifestEntryCount).toBe(2);
    expect(r.linkages[0]!.agrees).toBe(true);
    expect(r.ok).toBe(true);
  });

  test("legacy sites gone but manifest still lists the issue → MISMATCH (half-completed flip)", () => {
    const categories: CategoryResult[] = [
      {
        id: "nak-literals",
        title: "t",
        counts: { legacy: 0, migrated: 3, domainLegitimate: 0, total: 3 },
        sites: [],
        manifestIssues: ["myelin#233"],
      },
    ];
    const manifest = { "v/1": { issue: "myelin#233" } };
    const r = reconcileManifest(categories, manifest);
    expect(r.linkages[0]!.agrees).toBe(false);
    expect(r.ok).toBe(false);
  });
});

describe("report shape + enforce exit codes", () => {
  test("--json report has stable top-level shape", () => {
    const report = buildReport({
      root: "/fake",
      listFiles: () => ["src/transport/nak.ts"],
      readFile: () => `const a = "cant-do";`,
    });
    expect(report).toHaveProperty("categories");
    expect(report).toHaveProperty("totals");
    expect(report).toHaveProperty("manifestReconciliation");
    expect(report).toHaveProperty("legacyRemaining");
    expect(report.totals).toEqual({ legacy: 1, migrated: 0, domainLegitimate: 0 });
    expect(report.legacyRemaining).toBe(1);
    // Categories are sorted deterministically and each carries counts + sites.
    const ids = report.categories.map((c) => c.id);
    expect([...ids].sort()).toEqual(ids); // buildCategories emits sorted-by-id order
  });

  test("sites are sorted by file then line deterministically", () => {
    const results = fixtureScan({
      "src/b.ts": `const x = "cant-do";`,
      "src/a.ts": `\nconst y = "wont-do";`,
    });
    const nak = byId(results, "nak-literals");
    expect(nak.sites.map((s) => `${s.file}:${s.line}`)).toEqual(["src/a.ts:2", "src/b.ts:1"]);
  });

  test("main --enforce exits 1 while legacy sites remain; without it, exits 0", () => {
    // Runs against the actual repo root (main self-discovers via cwd). Silence
    // the report so the CI log stays clean; we only care about the exit codes.
    const orig = process.stdout.write.bind(process.stdout);
    (process.stdout as unknown as { write: () => boolean }).write = () => true;
    try {
      // Pre-cut the tree still holds legacy NAK/DID sites, so enforce is nonzero.
      expect(main(["--enforce"])).toBe(1);
      // Warn-only (no --enforce) is always green — it is a report, not a gate.
      expect(main([])).toBe(0);
    } finally {
      process.stdout.write = orig;
    }
  });
});
