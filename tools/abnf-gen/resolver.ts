/**
 * Corpus resolver (#237). Loads every `specs/grammar/*.abnf`, then resolves a
 * rule reference to its definition using the D1 composition convention:
 *
 *   1. LOCAL — a rule defined in the same file wins (a file may restate an
 *      alphabet locally; that local owns its own references).
 *   2. IMPORTED — a `;; imports <rule> FROM <file>` header names the owner file.
 *   3. CORE — the RFC 5234 Appendix B built-ins (ALPHA, DIGIT, HEXDIG, …).
 *
 * A reference that is none of these is a LOUD error naming file+rule (the
 * acceptance's "unresolvable name = loud error"). Single-owner (README rule 5)
 * is enforced at resolve time: an imported rule MUST exist in exactly the named
 * file, and a file MUST NOT import a rule it also defines locally.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseGrammar } from "./parser";
import type { Grammar, Node, Rule } from "./ast";

/** RFC 5234 Appendix B core rules used by the corpus, as ABNF fragments. */
export const CORE_RULES: Record<string, Node> = {
  ALPHA: { t: "alt", opts: [{ t: "range", lo: 0x41, hi: 0x5a }, { t: "range", lo: 0x61, hi: 0x7a }] },
  DIGIT: { t: "range", lo: 0x30, hi: 0x39 },
  HEXDIG: {
    t: "alt",
    opts: [{ t: "range", lo: 0x30, hi: 0x39 }, { t: "range", lo: 0x41, hi: 0x46 }, { t: "range", lo: 0x61, hi: 0x66 }],
  },
};

export interface Corpus {
  grammars: Grammar[];
  byFile: Map<string, Grammar>;
}

export function loadCorpus(grammarDir: string): Corpus {
  const files = readdirSync(grammarDir).filter((f) => f.endsWith(".abnf")).sort();
  const grammars = files.map((f) => parseGrammar(readFileSync(join(grammarDir, f), "utf8"), f));
  const byFile = new Map(grammars.map((g) => [g.file, g]));

  // Validate imports up front (single-owner, README rule 5) so a bad header is
  // a loud error before any emit.
  for (const g of grammars) {
    for (const imp of g.imports) {
      const owner = byFile.get(imp.fromFile);
      if (!owner) throw new Error(`${g.file}: import of '${imp.rule}' names unknown file '${imp.fromFile}'`);
      if (!owner.rules.has(imp.rule)) {
        throw new Error(`${g.file}: import '${imp.rule} FROM ${imp.fromFile}' — no such rule in ${imp.fromFile}`);
      }
      if (g.rules.has(imp.rule)) {
        throw new Error(
          `${g.file}: rule '${imp.rule}' is both defined locally and imported FROM ${imp.fromFile} (README rule 5 single-owner)`,
        );
      }
    }
  }
  return { grammars, byFile };
}

/** Resolve a rule reference used INSIDE `grammar` to its defining Node. */
export function resolveRef(corpus: Corpus, grammar: Grammar, name: string): Node {
  const local = grammar.rules.get(name);
  if (local) return local.node;
  const imp = grammar.imports.find((im) => im.rule === name);
  if (imp) {
    const owner = corpus.byFile.get(imp.fromFile)!;
    return owner.rules.get(name)!.node;
  }
  if (CORE_RULES[name]) return CORE_RULES[name]!;
  throw new Error(
    `${grammar.file}: unresolved rule reference '${name}' — not local, not a declared import ` +
      `(add ';; imports ${name} FROM <file>'), and not an RFC 5234 core rule`,
  );
}

/** Which file+node a reference resolves to, for cross-file recursion. */
export function resolveRefCtx(
  corpus: Corpus,
  grammar: Grammar,
  name: string,
): { grammar: Grammar; node: Node } {
  if (grammar.rules.has(name)) return { grammar, node: grammar.rules.get(name)!.node };
  const imp = grammar.imports.find((im) => im.rule === name);
  if (imp) {
    const owner = corpus.byFile.get(imp.fromFile)!;
    return { grammar: owner, node: owner.rules.get(name)!.node };
  }
  if (CORE_RULES[name]) return { grammar, node: CORE_RULES[name]! };
  throw new Error(
    `${grammar.file}: unresolved rule reference '${name}' — not local, not a declared import ` +
      `(add ';; imports ${name} FROM <file>'), and not an RFC 5234 core rule`,
  );
}

export type { Rule };
