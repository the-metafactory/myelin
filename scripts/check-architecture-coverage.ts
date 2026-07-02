#!/usr/bin/env bun
/**
 * Doc-drift guard (remediation D8).
 *
 * Asserts that every top-level module under `src/` is named somewhere in
 * `docs/architecture.md`. The architecture doc carries a "maintenance
 * obligation" that has drifted before; this catches the specific drift of a
 * NEW module never being mentioned at all. It is a presence check, not a
 * semantic one — it cannot tell whether an existing mention still describes
 * the code accurately, so it complements reviewer judgement rather than
 * replacing it.
 *
 * A module is "top-level" if it is a directory or a `.ts` file directly under
 * `src/`. Test files (`*.test.ts`) and the `fixtures/` directory are excluded —
 * they are not part of the public architecture.
 *
 * Exit 0 if every module is mentioned; exit 1 listing the misses otherwise.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(repoRoot, "src");
const archDoc = join(repoRoot, "docs", "architecture.md");

const entries = readdirSync(srcDir, { withFileTypes: true })
  .filter((e) => e.name !== "fixtures")
  .filter((e) => e.isDirectory() || (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")))
  .map((e) => e.name)
  .sort();

const doc = readFileSync(archDoc, "utf8");
// Match the qualified `src/<name>` form rather than the bare basename: a module
// named `bidding` should not count as "covered" just because the prose mentions
// the word "bidding". This is a presence check, not a placement check — any
// `src/<name>` occurrence in the doc satisfies it, so it catches a wholly
// unmentioned module, not a mention that drifted to the wrong section.
const missing = entries.filter((name) => !doc.includes(`src/${name}`));

if (missing.length > 0) {
  console.error(
    `docs/architecture.md is missing ${missing.length} top-level src/ module(s):`,
  );
  for (const name of missing) console.error(`  - src/${name}`);
  console.error(
    "\nAdd each module to docs/architecture.md (the maintenance obligation in §0).",
  );
  process.exit(1);
}

console.log(`architecture.md covers all ${entries.length} top-level src/ modules.`);
