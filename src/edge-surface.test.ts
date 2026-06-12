import { describe, expect, it } from "bun:test";

/**
 * The myelin#190 acceptance gate: BUNDLE the edge entrypoint and assert
 * the output carries zero Node-only references. Bundling follows the
 * transitive module graph, so a Node-only import smuggled in three hops
 * deep fails here where a per-file grep would not. Scope honestly: this
 * is evidence for ONE build path (Bun, browser target) — other bundlers
 * and resolution conditions can differ; consumers should keep their own
 * bundle checks (reflex#16 greps its wrangler output).
 */
describe("edge subpath surface (myelin#190)", () => {
  it("a bundle of src/edge.ts contains no transport-node / node:fs / node:net / node:os", async () => {
    const result = await Bun.build({
      entrypoints: [new URL("./edge.ts", import.meta.url).pathname],
      target: "browser",
      minify: false,
    });
    expect(result.success).toBe(true);
    const bundle = await result.outputs[0].text();
    for (const forbidden of ["@nats-io/transport-node", "node:fs", "node:net", "node:os", "node:tls"]) {
      expect(bundle).not.toContain(forbidden);
    }
    // No `process.` global references outside the nats-core vendor code's
    // own guarded feature detection (which checks typeof process safely).
    // Our own modules must not reference it at all — guarded by the
    // websocket portability test for first-party files; here we assert
    // the surface actually bundles for a browser-class target at all.
    expect(bundle).toContain("WebSocketTransport");
    expect(bundle).toContain("EnvelopeTransport");
    // myelin#192: pin the trusted-substrates self-assert surface in the
    // bundle. Presence check only — it proves the export survives
    // bundling, so the negative greps above (with their documented
    // single-build-path scope) apply to its import graph too.
    expect(bundle).toContain("isSubstrateTrusted");
  });
});
