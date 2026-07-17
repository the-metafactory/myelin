#!/usr/bin/env bun
/**
 * abnf-gen (#237) — the myelin grammar generator + drift gate.
 *
 *   bun tools/abnf-gen                 generate committed artifacts
 *   bun tools/abnf-gen --check         regenerate in-memory, byte-diff, exit 1 on drift
 *   bun tools/abnf-gen --era pre-R|r   select the generated era root (default: r)
 *
 * ERA MODEL (design-rfc-alignment.md D6). The `.abnf` grammars are the RATIFIED
 * (flag-day-R) forms, so their generated artifacts are POST-R and are STAGED
 * under `src/wire/generated/r/` — gated there by `--check` until the flag-day
 * cut swaps them into `src/wire/generated/`. The PRE-R artifacts are the
 * hand-written regexes/enums still live in `src/` today (pinned by the #239
 * conformance runner); they are NOT generated, so there is no unconditional
 * regenerate-and-diff of pre-R. `--era` selects the output root; the mechanism
 * is here for the flag-day runbook.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCorpus } from "./resolver";
import { emitAll, type OutFile } from "./emit";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface Args {
  check: boolean;
  era: string;
  grammarDir: string;
  outRoot: string; // absolute
}

function parseArgs(argv: string[]): Args {
  let check = false;
  let era = "r";
  let grammarDir = join(REPO_ROOT, "specs", "grammar");
  let outRoot = "";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--check") check = true;
    else if (a === "--era") era = argv[++i] ?? "r";
    else if (a === "--grammar-dir") grammarDir = resolve(argv[++i]!);
    else if (a === "--out-root") outRoot = resolve(argv[++i]!);
    else throw new Error(`unknown argument: ${a}`);
  }
  if (era !== "r" && era !== "pre-R") throw new Error(`--era must be 'r' or 'pre-R', got '${era}'`);
  if (!outRoot) outRoot = join(REPO_ROOT, "src", "wire", "generated", era);
  return { check, era, grammarDir, outRoot };
}

/** Every committed file currently under the era root, relative to it. */
function listCommitted(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(root, p));
    }
  };
  walk(root);
  return out.sort();
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const corpus = loadCorpus(args.grammarDir);
  const files: OutFile[] = emitAll(corpus, args.era);
  const wanted = new Map(files.map((f) => [f.path, f.content]));

  if (args.check) {
    const drift: string[] = [];
    const committed = listCommitted(args.outRoot);
    for (const [path, content] of wanted) {
      const abs = join(args.outRoot, path);
      if (!existsSync(abs)) { drift.push(`MISSING  ${path}`); continue; }
      if (readFileSync(abs, "utf8") !== content) drift.push(`CHANGED  ${path}`);
    }
    for (const path of committed) {
      if (!wanted.has(path)) drift.push(`STALE    ${path} (no longer generated)`);
    }
    if (drift.length) {
      process.stderr.write(
        `abnf-gen --check: ${drift.length} drift(s) in src/wire/generated/${args.era}/ — run 'bun tools/abnf-gen':\n`,
      );
      for (const d of drift.sort()) process.stderr.write(`  ${d}\n`);
      process.exit(1);
    }
    process.stdout.write(`abnf-gen --check: src/wire/generated/${args.era}/ up to date (${files.length} files).\n`);
    return;
  }

  // Write mode: create/update wanted files, delete stale ones.
  mkdirSync(args.outRoot, { recursive: true });
  for (const [path, content] of wanted) {
    const abs = join(args.outRoot, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  for (const path of listCommitted(args.outRoot)) {
    if (!wanted.has(path)) rmSync(join(args.outRoot, path));
  }
  process.stdout.write(
    `abnf-gen: wrote ${files.length} files to src/wire/generated/${args.era}/ from ${corpus.grammars.length} grammars.\n`,
  );
}

main();
