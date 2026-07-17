#!/usr/bin/env bun
/**
 * flag-day-inventory.ts — deterministic Bucket-2 site scanner (myelin#287, epic #286).
 *
 * The flag-day-R cut is a "find every legacy-form site or the wire silently
 * breaks" problem (RFC-0001 §9.2 / RFC-0007 / RFC-0008). No agent enumerates
 * ~450 NAK-spelling + DID/segment/capability sites by hand without misses — the
 * missed-site failure mode is exactly the tail-chasing bug class the cut exists
 * to end. This tool replaces the hand scan with a committed, published-pattern
 * scanner that:
 *
 *   1. lists every Bucket-2 category's sites (file:line + matched token) + counts;
 *   2. classifies each site legacy | migrated | domain-legitimate (the hard part);
 *   3. emits a machine-readable summary (--json) + a human checklist;
 *   4. reconciles its counts against the conformance runner's 55-entry manifest;
 *   5. exits nonzero under --enforce iff any legacy-form site remains
 *      (0 legacy = the flag-day readiness go-signal).
 *
 * Scope: LIVE code only. `src` TypeScript (minus `*.test.ts` / `*.spec.ts` /
 * `src/wire/generated/**`) plus the one deployed `schemas/envelope.schema.json`.
 * Vectors, docs, node_modules, and generated artifacts are NOT sites — they are
 * spec fixtures, not the deployed wire.
 *
 * The classifier's unifying rule for hand-written regex COPIES (DID / segment /
 * capability / identity-type): a copy that lives UNDER `src/wire/` is the
 * canonical codec home (built #238) → migrated; a copy OUTSIDE `src/wire/` is a
 * pre-R hand-written duplicate the cut deletes → legacy. This is exactly the DoD
 * check "git grep finds zero LOCAL regex copies". NAK literals classify by
 * spelling: kebab → legacy, snake → migrated, minus a per-repo
 * `domainLegitimate` exclude set (empty for myelin; the cortex twin passes its
 * CC-substrate `DispatchTaskFailedReason` / `policy_denied` families so those
 * legitimate non-RFC enums are excluded, per epic #286 / cortex#2034 class-4).
 *
 * READ-ONLY: never mutates any scanned site. Pattern-to-copy: cortex
 * scripts/check-shippable-hygiene.ts (per-category rules, structured output,
 * nonzero-exit enforce mode). CI wiring: warn-only, mirroring vocab-gate.yml (#285).
 *
 * Exit codes: 0 = clean / report-only · 1 = --enforce with legacy sites remaining
 *             · 2 = internal error (fail-closed).
 *
 * Usage:
 *   bun scripts/flag-day-inventory.ts                # human checklist, exit 0
 *   bun scripts/flag-day-inventory.ts --json         # machine-readable summary
 *   bun scripts/flag-day-inventory.ts --enforce      # readiness gate (nonzero iff legacy remains)
 *   bun scripts/flag-day-inventory.ts --root <path>  # scan an explicit repo root
 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { MANIFEST } from "../src/conformance/manifest";

// ── model ────────────────────────────────────────────────────────────────────

export type Classification = "legacy" | "migrated" | "domain-legitimate";

export interface Site {
  file: string; // repo-relative POSIX path
  line: number; // 1-indexed
  match: string; // the matched token (code identifier, not a secret — safe to show)
  classification: Classification;
}

export interface FileContext {
  /** Repo-relative POSIX path of the file the site sits in. */
  file: string;
  /** True iff the file imports a codec from `./wire` (any relative wire path). */
  importsWire: boolean;
}

export interface SiteContext {
  match: string;
  line: string; // full source line (trimmed of trailing ws)
  file: string;
  importsWire: boolean;
}

export interface CategoryRule {
  /** Stable category id (kebab). */
  id: string;
  /** Human title for the checklist. */
  title: string;
  /** Per-line detection patterns (JS regexes; global so every hit on a line counts). */
  patterns: RegExp[];
  /** Which files this category scans. Defaults to the live-code scope. */
  fileScope: (relPath: string) => boolean;
  /** legacy | migrated | domain-legitimate for one matched site. */
  classify: (ctx: SiteContext) => Classification;
  /** Published 2026-07-17 calibration estimates (NOT acceptance targets). */
  calibration?: { myelin?: number; cortex?: number };
  /** Manifest issues this category's migration is tracked under (for reconciliation). */
  manifestIssues?: string[];
}

export interface CategoryResult {
  id: string;
  title: string;
  counts: { legacy: number; migrated: number; domainLegitimate: number; total: number };
  sites: Site[];
  calibration?: { myelin?: number; cortex?: number };
  manifestIssues?: string[];
}

export interface ManifestReconciliation {
  manifestEntryCount: number;
  linkages: {
    category: string;
    issues: string[];
    manifestEntries: number;
    toolLegacySites: number;
    /** presence-of-legacy-sites ⟺ presence-of-manifest-entries (bidirectional honesty guard). */
    agrees: boolean;
  }[];
  ok: boolean;
}

export interface InventoryReport {
  categories: CategoryResult[];
  totals: { legacy: number; migrated: number; domainLegitimate: number };
  manifestReconciliation: ManifestReconciliation;
  legacyRemaining: number;
}

// ── scope ──────────────────────────────────────────────────────────────────

/** Live deployed TypeScript: src/**\/*.ts minus tests, specs, and generated. */
export function isLiveCode(rel: string): boolean {
  if (!rel.startsWith("src/")) return false;
  if (!rel.endsWith(".ts")) return false;
  if (/\.(test|spec)\.ts$/.test(rel)) return false;
  if (rel.startsWith("src/wire/generated/")) return false;
  return true;
}

/** The one deployed envelope schema (the schema-DID category scopes to it). */
export function isDeployedSchema(rel: string): boolean {
  return rel === "schemas/envelope.schema.json";
}

/** A hand-written regex/enum copy is legacy unless it lives in the canonical
 *  codec home (src/wire/, built #238), where it is the migration destination. */
function copyClassifier(ctx: SiteContext): Classification {
  return ctx.file.startsWith("src/wire/") ? "migrated" : "legacy";
}

// ── categories ──────────────────────────────────────────────────────────────

const KEBAB_NAK = /\b(cant-do|wont-do|not-now|compliance-block)\b/g;
const SNAKE_NAK = /\b(cant_do|wont_do|not_now|compliance_block)\b/g;

/**
 * Build the Bucket-2 category rules. `domainLegitimate` lets a repo mark
 * matched lines as legitimate non-RFC enums (empty for myelin; the cortex twin
 * passes its CC-substrate families). A line matching any exclude is classified
 * `domain-legitimate` regardless of spelling — it is not a migration site.
 */
export function buildCategories(opts: { domainLegitimate?: RegExp[] } = {}): CategoryRule[] {
  const domainLegitimate = opts.domainLegitimate ?? [];
  const isExcludedLine = (line: string): boolean => domainLegitimate.some((re) => re.test(line));

  return [
    {
      id: "capability-regexes",
      title: "Capability-tag / converged-id regexes (RFC-0008)",
      patterns: [/\bCAPABILITY_TAG_RE\b/g, /\bCAPABILITY_ID\b/g],
      fileScope: isLiveCode,
      classify: copyClassifier,
      calibration: { myelin: 29, cortex: 5 },
      manifestIssues: ["myelin#234"],
    },
    {
      id: "did-codec-calls",
      title: "DID codec call sites (encode/decode/parse/render)",
      patterns: [/\b(encodeDidSegment|decodeDidSegment|parseDid|renderDid)\b/g],
      fileScope: isLiveCode,
      // A call is migrated when it resolves to the ./wire codec: either the call
      // lives inside src/wire itself, or its file imports the codec from ./wire.
      classify: (ctx) =>
        ctx.file.startsWith("src/wire/") || ctx.importsWire ? "migrated" : "legacy",
      calibration: { myelin: 39, cortex: 25 },
    },
    {
      id: "did-regex-defs",
      title: "Hand-written DID grammar regexes (classless did:mf:)",
      patterns: [/did:mf:\[a-z\]/g, /\bDID_RE\b/g],
      fileScope: isLiveCode,
      classify: copyClassifier,
      calibration: { myelin: 27 },
    },
    {
      id: "f11-symbols",
      title: "F-11 pull-registry symbols (retirement pending — rework, don't delete)",
      patterns: [
        /\b(registerCapabilities|verifyCapabilityRegistration|SignedCapabilityRegistration|AGENT_CAPABILITIES)\b/g,
      ],
      fileScope: isLiveCode,
      // F-11 symbols are the pull-registry surface the cut retires; every live
      // occurrence is un-migrated until the rework lands (epic #286 Wave 3).
      classify: () => "legacy",
      calibration: { myelin: 34 },
    },
    {
      id: "identity-type-enums",
      title: "IdentityType / VALID_TYPES (classless → class-explicit identity)",
      patterns: [/\bIdentityType\b/g, /\bVALID_TYPES\b/g],
      fileScope: isLiveCode,
      classify: copyClassifier,
    },
    {
      id: "nak-literals",
      title: "NakReason literals (kebab → snake, RFC-0007 §11.3)",
      patterns: [KEBAB_NAK, SNAKE_NAK],
      fileScope: isLiveCode,
      classify: (ctx) => {
        if (isExcludedLine(ctx.line)) return "domain-legitimate";
        // Kebab spelling is the pre-R legacy form; snake is the migrated pack form.
        return ctx.match.includes("-") ? "legacy" : "migrated";
      },
      calibration: { myelin: 96, cortex: 354 },
      manifestIssues: ["myelin#233", "myelin#11"],
    },
    {
      id: "schema-did-patterns",
      title: "Schema DID patterns (deployed envelope.schema.json)",
      patterns: [/\^did:mf:/g],
      fileScope: isDeployedSchema,
      // The deployed schema carries the classless grammar pre-cut; it flips as
      // part of the HELD atomic DID cut (RFC-0001 §9.2, two-party fire).
      classify: () => "legacy",
      calibration: { myelin: 6 },
    },
    {
      id: "segment-slug-regexes",
      title: "Segment / slug / stack-id regexes",
      patterns: [/\b(SLUG_RE|STACK_SLUG_RE|STACK_ID_RE|PRINCIPAL_ID_RE|SEGMENT_RE)\b/g],
      fileScope: isLiveCode,
      classify: copyClassifier,
    },
    {
      id: "subject-retargets",
      title: "Subject retargets (code.pr.*, assigned — RFC-0002 §5)",
      patterns: [/code\.pr\./g, /['"`]assigned['"`]/g],
      fileScope: isLiveCode,
      // Subject @-segment retarget rides the HELD atomic cut; live tokens are legacy.
      classify: () => "legacy",
    },
  ];
}

// ── file discovery ──────────────────────────────────────────────────────────

/** Tracked + untracked-non-ignored files, POSIX-relative, via git (fail-closed). */
export function listRepoFiles(root: string): string[] {
  const git = spawnSync(
    "git",
    ["-C", root, "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (git.status !== 0 || typeof git.stdout !== "string") {
    throw new Error(`git ls-files failed in ${root}: ${git.stderr || `status ${git.status}`}`);
  }
  return git.stdout.split("\0").filter(Boolean);
}

const IMPORTS_WIRE_RE = /\bfrom\s+["'][^"']*\/wire(?:\/[^"']*)?["']/;

/** Detect whether a file pulls a codec from ./wire (any relative wire specifier). */
export function fileImportsWire(content: string): boolean {
  return IMPORTS_WIRE_RE.test(content);
}

// ── scan ─────────────────────────────────────────────────────────────────────

export interface ScanOptions {
  root: string;
  categories?: CategoryRule[];
  /** Injected file reader (tests). Defaults to reading from disk. */
  readFile?: (rel: string) => string;
  /** Injected file lister (tests). Defaults to git ls-files. */
  listFiles?: (root: string) => string[];
}

export function scanTree(opts: ScanOptions): CategoryResult[] {
  const categories = opts.categories ?? buildCategories();
  const listFiles = opts.listFiles ?? listRepoFiles;
  const readFile =
    opts.readFile ??
    ((rel: string): string => {
      const abs = join(opts.root, rel);
      if (statSync(abs).size > 8 * 1024 * 1024) return ""; // skip pathological blobs
      return readFileSync(abs, "utf8");
    });

  const files = listFiles(opts.root);
  const sitesByCategory = new Map<string, Site[]>();
  for (const c of categories) sitesByCategory.set(c.id, []);

  // Only read a file once even though many categories may want it.
  const relevant = files.filter((rel) => categories.some((c) => c.fileScope(rel)));
  for (const rel of relevant) {
    let content: string;
    try {
      content = readFile(rel);
    } catch {
      // A file we cannot read cannot be verified. Skip it here but keep going;
      // the scan is a report, not a security boundary (that is CI's checkout).
      continue;
    }
    if (!content) continue;
    const importsWire = fileImportsWire(content);
    const lines = content.split(/\r?\n/);

    for (const c of categories) {
      if (!c.fileScope(rel)) continue;
      const bucket = sitesByCategory.get(c.id);
      if (!bucket) continue; // unreachable — every category id is seeded above
      lines.forEach((raw, i) => {
        const line = raw.replace(/\s+$/, "");
        for (const pat of c.patterns) {
          pat.lastIndex = 0;
          for (const m of line.matchAll(pat)) {
            const match = m[0];
            const classification = c.classify({ match, line, file: rel, importsWire });
            bucket.push({ file: rel, line: i + 1, match, classification });
          }
        }
      });
    }
  }

  return categories.map((c) => {
    const sites = sitesByCategory.get(c.id) ?? [];
    sites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.match.localeCompare(b.match));
    const counts = { legacy: 0, migrated: 0, domainLegitimate: 0, total: sites.length };
    for (const s of sites) {
      if (s.classification === "legacy") counts.legacy++;
      else if (s.classification === "migrated") counts.migrated++;
      else counts.domainLegitimate++;
    }
    return {
      id: c.id,
      title: c.title,
      counts,
      sites,
      calibration: c.calibration,
      manifestIssues: c.manifestIssues,
    };
  });
}

// ── manifest reconciliation ────────────────────────────────────────────────

/**
 * Bidirectional honesty guard (epic #286): a category with legacy sites MUST
 * still be tracked in the conformance manifest, and a manifest-tracked category
 * with zero legacy sites is a half-completed flip (its manifest entries should
 * have been deleted). Site count ≠ vector count by design — the epic states
 * counts are calibration, not 1:1 — so we reconcile PRESENCE, not magnitude.
 */
export function reconcileManifest(
  categories: CategoryResult[],
  manifest: Record<string, { issue: string }> = MANIFEST,
): ManifestReconciliation {
  const entriesByIssue = new Map<string, number>();
  for (const { issue } of Object.values(manifest)) {
    entriesByIssue.set(issue, (entriesByIssue.get(issue) ?? 0) + 1);
  }
  const linkages = categories
    .filter((c) => c.manifestIssues?.length)
    .map((c) => {
      const issues = c.manifestIssues ?? [];
      const manifestEntries = issues.reduce((n, i) => n + (entriesByIssue.get(i) ?? 0), 0);
      const toolLegacySites = c.counts.legacy;
      return {
        category: c.id,
        issues,
        manifestEntries,
        toolLegacySites,
        agrees: manifestEntries > 0 === toolLegacySites > 0,
      };
    });
  return {
    manifestEntryCount: Object.keys(manifest).length,
    linkages,
    ok: linkages.every((l) => l.agrees),
  };
}

// ── report assembly ──────────────────────────────────────────────────────────

export function buildReport(opts: ScanOptions): InventoryReport {
  const categories = scanTree(opts);
  const totals = { legacy: 0, migrated: 0, domainLegitimate: 0 };
  for (const c of categories) {
    totals.legacy += c.counts.legacy;
    totals.migrated += c.counts.migrated;
    totals.domainLegitimate += c.counts.domainLegitimate;
  }
  const manifestReconciliation = reconcileManifest(categories);
  return { categories, totals, manifestReconciliation, legacyRemaining: totals.legacy };
}

// ── rendering ────────────────────────────────────────────────────────────────

export function formatChecklist(report: InventoryReport): string {
  const out: string[] = [];
  out.push("flag-day-inventory — Bucket-2 un-migrated site scan (myelin#287)");
  out.push("");
  for (const c of report.categories) {
    const { legacy, migrated, domainLegitimate, total } = c.counts;
    const cal = c.calibration?.myelin != null ? ` (2026-07-17 est. ${c.calibration.myelin})` : "";
    out.push(
      `## ${c.title} [${c.id}]${cal}`,
    );
    out.push(
      `   legacy ${legacy} · migrated ${migrated} · domain-legit ${domainLegitimate} · total ${total}`,
    );
    for (const s of c.sites) {
      const box = s.classification === "legacy" ? "[ ]" : "[x]";
      out.push(`   ${box} ${s.file}:${s.line}  ${s.match}  (${s.classification})`);
    }
    out.push("");
  }
  const r = report.manifestReconciliation;
  out.push(`## Manifest reconciliation (${r.manifestEntryCount} entries) — ${r.ok ? "OK" : "MISMATCH"}`);
  for (const l of r.linkages) {
    out.push(
      `   ${l.agrees ? "MATCH   " : "MISMATCH"} ${l.category} ↔ ${l.issues.join("+")}: ` +
        `${l.manifestEntries} manifest entr${l.manifestEntries === 1 ? "y" : "ies"}, ${l.toolLegacySites} legacy site(s)`,
    );
  }
  out.push("");
  out.push(
    `TOTAL: ${report.totals.legacy} legacy · ${report.totals.migrated} migrated · ` +
      `${report.totals.domainLegitimate} domain-legitimate`,
  );
  out.push(
    report.legacyRemaining === 0
      ? "READY: 0 legacy-form sites remain — flag-day readiness gate is GREEN."
      : `NOT READY: ${report.legacyRemaining} legacy-form site(s) remain (readiness gate would fail under --enforce).`,
  );
  return out.join("\n");
}

// ── CLI ────────────────────────────────────────────────────────────────────

export function main(argv: string[]): number {
  let root = process.cwd();
  let json = false;
  let enforce = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") root = argv[++i] ?? root;
    else if (a === "--json") json = true;
    else if (a === "--enforce") enforce = true;
    else if (a === "--help" || a === "-h") {
      process.stdout.write(
        "usage: bun scripts/flag-day-inventory.ts [--root <path>] [--json] [--enforce]\n",
      );
      return 0;
    }
  }
  let report: InventoryReport;
  try {
    report = buildReport({ root });
  } catch (err) {
    process.stderr.write(`flag-day-inventory: internal error — ${(err as Error).message}\n`);
    return 2; // fail-closed on our own error
  }
  if (json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    process.stdout.write(formatChecklist(report) + "\n");
  }
  if (enforce && report.legacyRemaining > 0) return 1;
  return 0;
}

// Auto-run only when invoked directly (not when imported by the test).
if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
