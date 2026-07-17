import { describe, it, expect, afterAll } from "bun:test";
import { loadAllVectors } from "./load-vectors";
import { runVector, type RunResult } from "./runner";
import { MANIFEST } from "./manifest";

/**
 * The conformance runner (myelin#239, W2). Loads every vector under
 * `specs/vectors/**`, dispatches each on its TOP-LEVEL `kind` to today's
 * hand-written implementation, and asserts `expect.{ok,value,reason}`.
 *
 * A vector is GREEN when it passes, or when it fails but is recorded in the
 * known-defects manifest (spec-ahead-of-code — burn-down is the progress
 * meter). It is RED (loud) when it fails and is NOT manifested, when its kind is
 * unknown, or when a manifest entry has gone stale (the vector now passes).
 */

const loaded = loadAllVectors();
const results: RunResult[] = [];

describe("wire conformance runner (#239)", () => {
  it("loads the full vector corpus", () => {
    expect(loaded.length).toBeGreaterThan(300); // ~326 today
  });

  for (const lv of loaded) {
    it(`${lv.dir} · ${lv.vector.id} [${lv.vector.kind}]`, async () => {
      const r = await runVector(lv);
      results.push(r);
      if (r.outcome === "loud-fail") {
        throw new Error(`LOUD FAIL ${lv.vector.id} (${lv.vector.kind}): ${r.detail}`);
      }
      // pass | known are both green.
      expect(["pass", "known"]).toContain(r.outcome);
    });
  }

  it("fabricated unknown-kind vector fails loudly, naming the kind", async () => {
    const r = await runVector({
      vector: { id: "synthetic/unknown-kind", kind: "thisKindDoesNotExist", input: {}, expect: { ok: true } },
      file: "synthetic",
      dir: "synthetic",
    });
    expect(r.outcome).toBe("loud-fail");
    expect(r.detail).toContain("thisKindDoesNotExist");
  });

  afterAll(() => {
    const pass = results.filter((r) => r.outcome === "pass").length;
    const known = results.filter((r) => r.outcome === "known").length;
    const loud = results.filter((r) => r.outcome === "loud-fail").length;
    const manifestSize = Object.keys(MANIFEST).length;
    // Burn-down meter — visible in CI logs.
    // eslint-disable-next-line no-console
    console.log(
      `\n[conformance #239] ${results.length} vectors: ${pass} pass · ${known} known-defect · ${loud} loud-fail` +
        `  |  manifest entries: ${manifestSize}`,
    );
  });
});
