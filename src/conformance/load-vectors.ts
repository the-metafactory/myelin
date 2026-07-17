import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { LoadedVector, Vector } from "./types";

/**
 * Load EVERY `specs/vectors/**\/*.json` as a flat list of vectors, tagged with
 * their file and set. A file is either a bare array of vectors or an object with
 * a `vectors` array (both layouts exist in the pack). Non-vector files
 * (`generate.ts`, `README.md`) are ignored by the `.json` filter.
 *
 * Mixed-layout sets (subject-namespace, capability-discovery, sovereignty) put
 * accept and reject cases in ONE array — the runner never keys on valid/invalid
 * filenames; it partitions on each vector's `expect.ok` (amendment item 4).
 */

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const VECTORS_ROOT = join(REPO_ROOT, "specs", "vectors");

function walkJson(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walkJson(p));
    else if (entry.endsWith(".json")) out.push(p);
  }
  return out.sort();
}

export function loadAllVectors(): LoadedVector[] {
  const files = walkJson(VECTORS_ROOT);
  const loaded: LoadedVector[] = [];
  for (const abs of files) {
    const rel = relative(REPO_ROOT, abs);
    const raw = JSON.parse(readFileSync(abs, "utf8")) as Vector[] | { vectors?: Vector[] };
    const arr: Vector[] = Array.isArray(raw) ? raw : (raw.vectors ?? []);
    const dir = relative(VECTORS_ROOT, abs).split("/")[0] ?? "";
    for (const vector of arr) loaded.push({ vector, file: rel, dir });
  }
  return loaded;
}
