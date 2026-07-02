import { describe, expect, test } from "bun:test";

/**
 * Smoke test for the package `exports` map (remediation E1). Each declared
 * subpath must resolve and expose at least one known public symbol, so a typo
 * or a deleted `index.ts` fails here instead of in a consumer's build.
 */
const SUBPATHS: { subpath: string; symbol: string }[] = [
  { subpath: "@the-metafactory/myelin", symbol: "createEnvelope" },
  { subpath: "@the-metafactory/myelin/subjects", symbol: "deriveSubject" },
  { subpath: "@the-metafactory/myelin/envelope", symbol: "validateEnvelope" },
  { subpath: "@the-metafactory/myelin/identity", symbol: "verifyEnvelopeIdentity" },
  { subpath: "@the-metafactory/myelin/sovereignty", symbol: "isSubstrateTrusted" },
  { subpath: "@the-metafactory/myelin/transport", symbol: "WebSocketTransport" },
  { subpath: "@the-metafactory/myelin/transport/websocket", symbol: "WebSocketTransport" },
  { subpath: "@the-metafactory/myelin/discovery", symbol: "canonicalizeAdvertisement" },
  { subpath: "@the-metafactory/myelin/composition", symbol: "validateWorkflow" },
  { subpath: "@the-metafactory/myelin/bidding", symbol: "DEFAULT_BID_TIMEOUT_MS" },
  { subpath: "@the-metafactory/myelin/edge", symbol: "subjectMatchesPattern" },
];

describe("package subpath exports", () => {
  for (const { subpath, symbol } of SUBPATHS) {
    test(`${subpath} resolves and exports ${symbol}`, async () => {
      const mod = (await import(subpath)) as Record<string, unknown>;
      expect(mod[symbol]).toBeDefined();
    });
  }
});
