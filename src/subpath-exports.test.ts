import { describe, expect, test } from "bun:test";
import pkg from "../package.json";

/**
 * Smoke test for the package `exports` map (remediation E1). The list of
 * subpaths is DERIVED from `package.json` `exports` rather than hand-mirrored,
 * so adding an export without a matching expectation fails the drift guard
 * below instead of silently going untested (Sage review #212).
 *
 * `SYMBOLS` maps each export key to one known public symbol that subpath must
 * expose. Symbols can't be derived from `package.json`, so this map is the one
 * hand-maintained piece — and the drift guard forces it to stay in sync with
 * the exports map.
 */
const SYMBOLS: Record<string, string> = {
  ".": "createEnvelope",
  "./subjects": "deriveSubject",
  "./envelope": "validateEnvelope",
  "./identity": "verifyEnvelopeIdentity",
  "./sovereignty": "isSubstrateTrusted",
  "./transport": "WebSocketTransport",
  "./transport/websocket": "WebSocketTransport",
  "./discovery": "canonicalizeAdvertisement",
  "./composition": "validateWorkflow",
  "./bidding": "DEFAULT_BID_TIMEOUT_MS",
  "./edge": "subjectMatchesPattern",
};

const exportKeys = Object.keys(pkg.exports);
const specifierFor = (key: string): string =>
  key === "." ? pkg.name : `${pkg.name}${key.slice(1)}`;

describe("package subpath exports", () => {
  test("every package.json export key has a symbol expectation (drift guard)", () => {
    expect(Object.keys(SYMBOLS).sort()).toEqual([...exportKeys].sort());
  });

  for (const key of exportKeys) {
    const symbol = SYMBOLS[key];
    test(`${specifierFor(key)} resolves and exports ${symbol}`, async () => {
      const mod = (await import(specifierFor(key))) as Record<string, unknown>;
      expect(mod[symbol!]).toBeDefined();
    });
  }
});
