import { describe, it, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadCorpus } from "./resolver";
import { parseGrammar } from "./parser";
import { ruleRegex } from "./regex";
import { emitAll } from "./emit";

/**
 * Generator-internals acceptance for #237: determinism, cross-file resolution
 * across all 10 grammars, and the loud error on an unresolvable reference.
 * (The DID-pattern-vs-vectors proof lives in src/wire/generated.test.ts so it
 * runs in the `bun test src/` unit lane; the committed-artifact drift gate is
 * `bun tools/abnf-gen --check`, wired into CI.)
 */

const GRAMMAR_DIR = join(fileURLToPath(new URL("../../", import.meta.url)), "specs", "grammar");

describe("abnf-gen (#237)", () => {
  it("resolves cross-file references for ALL grammars and builds every regex", () => {
    const corpus = loadCorpus(GRAMMAR_DIR);
    expect(corpus.grammars.length).toBe(10);
    let rules = 0;
    for (const g of corpus.grammars) {
      for (const [, rule] of g.rules) {
        expect(() => ruleRegex(corpus, g, rule.node)).not.toThrow();
        rules++;
      }
    }
    expect(rules).toBeGreaterThan(150);
  });

  it("is deterministic — two emits are byte-identical", () => {
    const a = emitAll(loadCorpus(GRAMMAR_DIR), "r");
    const b = emitAll(loadCorpus(GRAMMAR_DIR), "r");
    expect(a.map((f) => `${f.path}\n${f.content}`)).toEqual(b.map((f) => `${f.path}\n${f.content}`));
  });

  it("raises a loud error naming file+rule on an unresolvable reference", () => {
    const corpus = loadCorpus(GRAMMAR_DIR);
    const bad = parseGrammar("bad-rule = no-such-rule\n", "synthetic.abnf");
    corpus.grammars.push(bad);
    corpus.byFile.set("synthetic.abnf", bad);
    const rule = bad.rules.get("bad-rule");
    expect(rule).toBeDefined();
    expect(() => ruleRegex(corpus, bad, rule!.node)).toThrow(/synthetic\.abnf.*no-such-rule/);
  });

  it("enforces README rule 5 single-owner: a rule cannot be both local and imported", () => {
    const dir = mkdtempSync(join(tmpdir(), "abnf-gen-"));
    writeFileSync(join(dir, "owner.abnf"), "lower = %x61-7A\n");
    writeFileSync(join(dir, "dup.abnf"), ";; imports lower FROM owner.abnf\nlower = %x61-7A\nx = lower\n");
    expect(() => loadCorpus(dir)).toThrow(/single-owner/);
  });

  it("errors when an import names an unknown file or missing rule", () => {
    const dir = mkdtempSync(join(tmpdir(), "abnf-gen-"));
    writeFileSync(join(dir, "a.abnf"), ";; imports ghost FROM nowhere.abnf\nx = ghost\n");
    expect(() => loadCorpus(dir)).toThrow(/unknown file/);
  });
});
