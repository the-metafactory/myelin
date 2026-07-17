import { describe, expect, test } from "bun:test";
import pkg from "../package.json";

/**
 * Smoke test for the package `exports` map (remediation E1). The list of
 * subpaths is DERIVED from `package.json` `exports` rather than hand-mirrored,
 * so adding an export without a matching expectation fails the drift guard
 * below instead of silently going untested (Sage review #212).
 *
 * Two kinds of export are registered:
 *  - CODE modules (`SYMBOLS`): each maps to one known public symbol the subpath
 *    must expose.
 *  - JSON WILDCARDS (`JSON_WILDCARDS`, myelin#259): pattern subpaths like
 *    `./vectors/*.json` and `./schemas/*.json` are not importable literally, so
 *    each registers a CONCRETE example file that must resolve through the
 *    package path (as an out-of-repo consumer / CONFORMANCE.md MUST-1 does).
 *    Rich shape assertions live in `tests/package-exports.smoke.test.ts`.
 *
 * Symbols/examples can't be derived from `package.json`, so these maps are the
 * one hand-maintained piece — and the drift guard forces them to stay in sync
 * with the exports map.
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
  "./wire": "identity",
  "./wire/identity": "parseDid",
  "./wire/subjects": "validatePublishedSubject",
  "./wire/canonicalize": "canonicalizeForSigning",
  "./wire/envelope": "validateEnvelope",
  "./wire/refusal": "parseRefusalObject",
  "./wire/capability": "matchSovereigntyMode",
  "./wire/admission": "parseRequestId",
};

// JSON wildcard exports (myelin#259): pattern key → a concrete example subpath
// (with the `*` substituted) that must resolve through the package path.
const JSON_WILDCARDS: Record<string, string> = {
  "./vectors/*.json": "./vectors/identifiers/valid.json",
  "./schemas/*.json": "./schemas/envelope.schema.json",
};

const exportKeys = Object.keys(pkg.exports);
const specifierFor = (key: string): string =>
  key === "." ? pkg.name : `${pkg.name}${key.slice(1)}`;

describe("package subpath exports", () => {
  test("every package.json export key has a registered expectation (drift guard)", () => {
    const registered = [...Object.keys(SYMBOLS), ...Object.keys(JSON_WILDCARDS)].sort();
    expect(registered).toEqual([...exportKeys].sort());
  });

  for (const key of Object.keys(SYMBOLS)) {
    const symbol = SYMBOLS[key];
    test(`${specifierFor(key)} resolves and exports ${symbol}`, async () => {
      const mod = (await import(specifierFor(key))) as Record<string, unknown>;
      expect(mod[symbol!]).toBeDefined();
    });
  }

  for (const [key, example] of Object.entries(JSON_WILDCARDS)) {
    const specifier = specifierFor(example);
    test(`${key} resolves a concrete example (${specifier}) through the package`, async () => {
      const mod = (await import(specifier, { with: { type: "json" } })) as {
        default: unknown;
      };
      expect(mod.default).toBeDefined();
      expect(typeof mod.default).toBe("object");
    });
  }
});
