#!/usr/bin/env bun
/**
 * Wire-grounding drift gate (domain-grounding standard §2.2).
 *
 * The `wire_grounding` routing table copies a list of RFC filenames that the
 * myelin pack (`specs/rfc/`) owns. That copy must not drift: a route may never
 * name an RFC that does not exist. Here myelin IS the pack owner, so the check
 * resolves every routed path against this same checkout.
 *
 * Two artifacts carry the table until agents-md generation is wired: the
 * canonical section file (`docs/agents-md/wire-grounding.md`) and its render in
 * the root `CLAUDE.md` `wire_grounding` block. This gate asserts:
 *   (1) every `specs/rfc/rfc-*.md` path in EITHER artifact resolves to a real
 *       file in the pack — the hard rule of §2.2; and
 *   (2) the two artifacts route to the SAME set of RFCs — so the hand-kept
 *       render can't drift from its source before generation takes over.
 *
 * Exit 0 if clean; exit 1 listing the problems otherwise.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sectionFile = join(repoRoot, "docs", "agents-md", "wire-grounding.md");
const claudeFile = join(repoRoot, "CLAUDE.md");

const RFC_PATH = /specs\/rfc\/rfc-[a-z0-9-]+\.md/g;

function routedPaths(file: string): Set<string> {
  const text = readFileSync(file, "utf8");
  return new Set(text.match(RFC_PATH) ?? []);
}

const problems: string[] = [];

const sectionPaths = routedPaths(sectionFile);
const claudePaths = routedPaths(claudeFile);

if (sectionPaths.size === 0) {
  problems.push(`${sectionFile} names no specs/rfc/ routing targets — the wire_grounding table is empty or malformed.`);
}

// (1) Every routed path must resolve to a real file in the pack.
for (const [file, paths] of [
  [sectionFile, sectionPaths],
  [claudeFile, claudePaths],
] as const) {
  for (const p of [...paths].sort()) {
    if (!existsSync(join(repoRoot, p))) {
      problems.push(`${file}: routing target missing in the pack: ${p}`);
    }
  }
}

// (2) Section file and CLAUDE.md render must route to the same RFC set.
for (const p of [...sectionPaths].sort()) {
  if (!claudePaths.has(p)) problems.push(`CLAUDE.md wire_grounding table is missing a route present in the section file: ${p}`);
}
for (const p of [...claudePaths].sort()) {
  if (!sectionPaths.has(p)) problems.push(`docs/agents-md/wire-grounding.md is missing a route present in CLAUDE.md: ${p}`);
}

if (problems.length > 0) {
  console.error("wire-grounding drift check failed:");
  for (const line of problems) console.error(`  - ${line}`);
  process.exit(1);
}

console.log(`wire-grounding: ${sectionPaths.size} routed RFC(s), all resolve in specs/rfc/ and match across CLAUDE.md.`);
