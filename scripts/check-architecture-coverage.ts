#!/usr/bin/env bun
/**
 * Doc-drift guard (remediation D8).
 *
 * Asserts that every top-level module under `src/` is named somewhere in
 * `docs/architecture.md`. The architecture doc carries a "maintenance
 * obligation" that has drifted before; this makes the obligation enforceable
 * in CI instead of relying on reviewer memory.
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
// Match the qualified `src/<name>` form, not the bare basename — otherwise a
// module named `bidding` would be "covered" by unrelated prose mentioning the
// word "bidding", and deleting its real code-mapping entry would go unnoticed.
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
