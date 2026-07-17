import { describe, it, expect } from "bun:test";

// Import THROUGH the package export map (self-reference), exactly as an
// out-of-repo consumer would per CONFORMANCE.md MUST-1. This proves the
// `./vectors/*.json` and `./schemas/*.json` exports added in myelin#259
// actually resolve — the born-non-conformant meta-defect (audit §2), where
// the MUST-1 verbatim import could not resolve, is closed ONLY if these
// package-path imports load. Importing the raw `./specs/...` path would
// prove nothing about the export map, so these deliberately go through the
// published subpaths.
import valid from "@the-metafactory/myelin/vectors/identifiers/valid.json" with { type: "json" };
import crossing from "@the-metafactory/myelin/vectors/sovereignty/crossing.json" with { type: "json" };
import envelopeSchema from "@the-metafactory/myelin/schemas/envelope.schema.json" with { type: "json" };

describe("package exports — ./vectors + ./schemas (#259)", () => {
  it("resolves the CONFORMANCE MUST-1 vector path to a non-empty vector array", () => {
    expect(Array.isArray(valid)).toBe(true);
    expect(valid.length).toBeGreaterThan(0);
    // Conformance vectors carry the {id, rfc, why} shape the runner keys on.
    const v = valid[0] as Record<string, unknown>;
    expect(typeof v.id).toBe("string");
    expect(typeof v.rfc).toBe("number");
    expect(typeof v.why).toBe("string");
  });

  it("resolves a nested vector subpath (sovereignty/crossing) through the package", () => {
    expect(Array.isArray(crossing)).toBe(true);
    expect(crossing.length).toBeGreaterThan(0);
  });

  it("resolves the envelope schema through the package path as a JSON Schema", () => {
    const s = envelopeSchema as Record<string, unknown>;
    expect(typeof s).toBe("object");
    expect(typeof s.$schema).toBe("string");
    expect(s.type).toBe("object");
    expect(s.properties).toBeDefined();
  });
});
