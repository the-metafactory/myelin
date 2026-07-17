#!/usr/bin/env bun
/**
 * Vocab gate (domain-grounding standard §5) — the myelin#240 notation decision
 * as CI. Flags the banned layer-model aliases in tracked prose:
 *
 *   V1  "the Myelin stack"        → "the Myelin layer model"
 *   V2  "the seven-layer stack"   → "the Myelin layer model"
 *   V3  "protocol stack"          → "M2–M6 protocol layers"
 *   V4  a bare `L[1-7]` used as a live Myelin-layer reference → the matching `M[1-7]`
 *
 * Canonical: M-notation (M1–M7); reconciled name "Myelin layer model". The
 * L-prefix is a LEGAL historical alias (CONTEXT-MAP declares `L1–L7 ≡ M1–M7`),
 * so V4 flags only a bare live reference and honours the §5.2 allowlist:
 *   - historical-record / audit / planning files (verbatim, illegal to alter) — skipped whole;
 *   - the declared-equivalence / glossary-ban line (`_Avoid_`, `≡`, "historical alias") — skipped;
 *   - foreign layer namespaces (governance / confidentiality / data-classification / a `§n` marker) — skipped;
 *   - fenced code + blockquote / `<sub>` lines — skipped;
 *   - an inline `vocab-allow:` marker naming a reason — skipped.
 *
 * BURN-IN: warn-only by default (exit 0), mirroring myelin's confidentiality-gate.
 * The live RFC pack + README carry residuals catalogued as open MAJOR findings
 * (specs/rfc/SERIES-COMPLETION-AUDIT.md); a principal flips this to blocking with
 * `--strict` (and enrols it as a required check) once those are burned down.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const strict = process.argv.includes("--strict");

// Directories never scanned.
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "coverage"]);

// Historical records / verbatim quotes / planning scratch — §5.2 class 2.
// Rewriting these to "fix" the wording would falsify the record.
const SKIP_FILES = new Set([
  "CHANGELOG.md",
  "specs/rfc/SERIES-COMPLETION-AUDIT.md",
  "specs/rfc/CURRENT-STATE-VS-RFC-GAP.md",
  "specs/rfc/REVISIONS.md",
  "specs/rfc/REVIEWING.md",
  "specs/rfc/PLAN.md",
]);
const SKIP_PREFIXES = ["Plans/", "specs/rfc/grill-logs/"];

interface Rule {
  id: string;
  pattern: RegExp;
  canonical: string;
}
const RULES: Rule[] = [
  { id: "V1", pattern: /the Myelin stack/i, canonical: 'use "the Myelin layer model"' },
  { id: "V2", pattern: /seven-layer stack/i, canonical: 'use "the Myelin layer model"' },
  { id: "V3", pattern: /protocol stack/i, canonical: 'use "M2–M6 protocol layers"' },
  { id: "V4", pattern: /\bL[1-7]\b/, canonical: "use the matching M[1-7] (L is a historical alias)" },
];

// A line the gate must leave alone even outside a skipped file — §5.2.
const FOREIGN_OR_DECLARED =
  /_Avoid_|≡|historical alias|vocab-allow:|governance|data-classification|confidentiality|§\d/i;

function isSkippedPath(rel: string): boolean {
  if (SKIP_FILES.has(rel)) return true;
  return SKIP_PREFIXES.some((p) => rel.startsWith(p));
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name), out);
    } else if (entry.name.endsWith(".md")) {
      out.push(join(dir, entry.name));
    }
  }
}

interface Finding {
  file: string;
  line: number;
  id: string;
  text: string;
  canonical: string;
}

function scan(file: string): Finding[] {
  const rel = relative(repoRoot, file).replaceAll("\\", "/");
  if (isSkippedPath(rel)) return [];
  const findings: Finding[] = [];
  const lines = readFileSync(file, "utf8").split("\n");
  let inFence = false;
  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    if (/^\s*>/.test(line) || line.includes("<sub>")) return; // blockquote / verbatim
    if (FOREIGN_OR_DECLARED.test(line)) return; // declared-alias / foreign namespace / inline allow
    for (const rule of RULES) {
      if (rule.pattern.test(line)) {
        findings.push({ file: rel, line: i + 1, id: rule.id, text: line.trim(), canonical: rule.canonical });
      }
    }
  });
  return findings;
}

const files: string[] = [];
walk(repoRoot, files);

const findings = files.flatMap(scan);

if (findings.length === 0) {
  console.log(`vocab gate: clean across ${files.length} tracked markdown file(s).`);
  process.exit(0);
}

const label = strict ? "ERROR" : "warning";
for (const f of findings.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)))) {
  console.error(`${label} ${f.file}:${f.line} [${f.id}] ${f.canonical}`);
  console.error(`    ${f.text}`);
}
console.error(
  `\nvocab gate: ${findings.length} banned-alias residual(s) in ${new Set(findings.map((f) => f.file)).size} file(s).`,
);

if (strict) {
  console.error("Running in --strict mode: failing. Fix the residuals or allowlist genuine verbatim records (§5.2).");
  process.exit(1);
}
console.error("Warn-only burn-in (mirrors confidentiality-gate): not failing. Flip to blocking with --strict once residuals are burned down.");
process.exit(0);
