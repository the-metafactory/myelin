import { describe, it, expect } from "bun:test";
import { canonicalizeForSigning } from "./canonicalize";
import type { MyelinEnvelope } from "../types";

const testEnvelope: MyelinEnvelope = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  source: "metafactory.echo.local",
  type: "test.identity.verify",
  timestamp: "2026-05-07T12:00:00Z",
  sovereignty: {
    classification: "local",
    data_residency: "CH",
    max_hop: 0,
    frontier_ok: false,
    model_class: "local-only",
  },
  payload: { message: "hello" },
};

const expectedCanonical =
  '{"id":"550e8400-e29b-41d4-a716-446655440000","payload":{"message":"hello"},"source":"metafactory.echo.local","sovereignty":{"classification":"local","data_residency":"CH","frontier_ok":false,"max_hop":0,"model_class":"local-only"},"timestamp":"2026-05-07T12:00:00Z","type":"test.identity.verify"}';

describe("canonicalizeForSigning", () => {
  it("produces expected canonical bytes for test vector", () => {
    const bytes = canonicalizeForSigning(testEnvelope);
    const decoded = new TextDecoder().decode(bytes);
    expect(decoded).toBe(expectedCanonical);
  });

  it("returns Uint8Array", () => {
    const bytes = canonicalizeForSigning(testEnvelope);
    expect(bytes).toBeInstanceOf(Uint8Array);
  });

  it("produces identical bytes regardless of original key order", () => {
    // Build the same envelope with keys in a different order
    const reordered = {
      payload: { message: "hello" },
      type: "test.identity.verify",
      sovereignty: {
        model_class: "local-only",
        frontier_ok: false,
        max_hop: 0,
        data_residency: "CH",
        classification: "local",
      },
      timestamp: "2026-05-07T12:00:00Z",
      source: "metafactory.echo.local",
      id: "550e8400-e29b-41d4-a716-446655440000",
    } as MyelinEnvelope;

    const bytes1 = canonicalizeForSigning(testEnvelope);
    const bytes2 = canonicalizeForSigning(reordered);
    expect(bytes1).toEqual(bytes2);
  });

  it("excludes correlation_id from canonical form", () => {
    const withCorrelation: MyelinEnvelope = {
      ...testEnvelope,
      correlation_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    };
    const bytes = canonicalizeForSigning(withCorrelation);
    const decoded = new TextDecoder().decode(bytes);
    expect(decoded).not.toContain("correlation_id");
    // Should still produce the same bytes as the base envelope
    expect(bytes).toEqual(canonicalizeForSigning(testEnvelope));
  });

  it("excludes economics from canonical form", () => {
    const withEconomics: MyelinEnvelope = {
      ...testEnvelope,
      economics: { cost: 0.01 },
    };
    const bytes = canonicalizeForSigning(withEconomics);
    const decoded = new TextDecoder().decode(bytes);
    expect(decoded).not.toContain("economics");
    expect(bytes).toEqual(canonicalizeForSigning(testEnvelope));
  });

  it("excludes extensions from canonical form", () => {
    const withExtensions: MyelinEnvelope = {
      ...testEnvelope,
      extensions: { debug: true },
    };
    const bytes = canonicalizeForSigning(withExtensions);
    const decoded = new TextDecoder().decode(bytes);
    expect(decoded).not.toContain("extensions");
    expect(bytes).toEqual(canonicalizeForSigning(testEnvelope));
  });

  it("excludes signed_by from canonical form", () => {
    const withSignedBy: MyelinEnvelope = {
      ...testEnvelope,
      signed_by: {
        method: "ed25519",
        principal: "did:mf:echo",
        signature: "fakesig==",
        at: "2026-05-07T12:00:00Z",
      },
    };
    const bytes = canonicalizeForSigning(withSignedBy);
    const decoded = new TextDecoder().decode(bytes);
    expect(decoded).not.toContain("signed_by");
    expect(bytes).toEqual(canonicalizeForSigning(testEnvelope));
  });

  it("sorts nested payload keys lexicographically", () => {
    const nestedPayload: MyelinEnvelope = {
      ...testEnvelope,
      payload: { zebra: 1, alpha: 2, middle: 3 },
    };
    const bytes = canonicalizeForSigning(nestedPayload);
    const decoded = new TextDecoder().decode(bytes);
    // In the canonical JSON, payload keys should be sorted
    expect(decoded).toContain('"payload":{"alpha":2,"middle":3,"zebra":1}');
  });

  it("handles deeply nested objects with deterministic ordering", () => {
    const deepPayload: MyelinEnvelope = {
      ...testEnvelope,
      payload: {
        z: { b: 2, a: 1 },
        a: { d: 4, c: 3 },
      },
    };
    const bytes = canonicalizeForSigning(deepPayload);
    const decoded = new TextDecoder().decode(bytes);
    expect(decoded).toContain('"payload":{"a":{"c":3,"d":4},"z":{"a":1,"b":2}}');
  });

  it("serializes numbers without trailing zeros", () => {
    const numPayload: MyelinEnvelope = {
      ...testEnvelope,
      payload: { value: 1.0, count: 10 },
    };
    const bytes = canonicalizeForSigning(numPayload);
    const decoded = new TextDecoder().decode(bytes);
    // 1.0 should serialize as 1, 10 as 10
    expect(decoded).toContain('"value":1');
    expect(decoded).not.toContain('"value":1.0');
  });
});
