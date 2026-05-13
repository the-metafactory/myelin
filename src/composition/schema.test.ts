import { describe, it, expect } from "bun:test";
import {
  compileSchema,
  validateData,
  validateSchemaCompatibility,
} from "./schema";

describe("validateData", () => {
  it("accepts data matching a simple schema", () => {
    const schema = { type: "object", required: ["name"], properties: { name: { type: "string" } } };
    const result = validateData({ name: "alpha" }, schema);
    expect(result.valid).toBe(true);
  });

  it("rejects data missing a required field", () => {
    const schema = { type: "object", required: ["name"], properties: { name: { type: "string" } } };
    const result = validateData({}, schema);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0].keyword).toBe("required");
      expect(result.errors[0].message).toContain("name");
    }
  });

  it("rejects data with a type mismatch", () => {
    const schema = { type: "object", properties: { count: { type: "number" } } };
    const result = validateData({ count: "not-a-number" }, schema);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0].keyword).toBe("type");
      expect(result.errors[0].path).toBe("/count");
    }
  });

  it("reports all errors via allErrors mode", () => {
    const schema = {
      type: "object",
      required: ["name", "age"],
      properties: { name: { type: "string" }, age: { type: "number" } },
    };
    const result = validateData({}, schema);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBe(2);
    }
  });

  it("validates uri format via ajv-formats", () => {
    const schema = { type: "string", format: "uri" };
    expect(validateData("https://example.com", schema).valid).toBe(true);
    expect(validateData("not a uri", schema).valid).toBe(false);
  });

  it("validates date-time format via ajv-formats", () => {
    const schema = { type: "string", format: "date-time" };
    expect(validateData("2026-05-12T00:00:00Z", schema).valid).toBe(true);
    expect(validateData("not-a-timestamp", schema).valid).toBe(false);
  });

  it("accepts arbitrary data against an empty schema", () => {
    expect(validateData({ anything: 1 }, {}).valid).toBe(true);
    expect(validateData(null, {}).valid).toBe(true);
    expect(validateData("string", {}).valid).toBe(true);
  });

  it("path is '' for root-level type errors (RFC 6901)", () => {
    const result = validateData("string", { type: "number" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0].path).toBe("");
    }
  });

  it("does not mutate input data even when schema declares default", () => {
    // Ajv defaults are OFF in this layer — input must round-trip.
    const schema = {
      type: "object",
      properties: { x: { type: "string", default: "fallback" } },
    };
    const data: Record<string, unknown> = {};
    validateData(data, schema);
    expect(data).toEqual({});
  });

  it("resolves $ref via $defs", () => {
    const schema = {
      $defs: {
        Address: {
          type: "object",
          required: ["city"],
          properties: { city: { type: "string" } },
        },
      },
      type: "object",
      properties: { home: { $ref: "#/$defs/Address" } },
    };
    expect(validateData({ home: { city: "Zurich" } }, schema).valid).toBe(true);
    expect(validateData({ home: {} }, schema).valid).toBe(false);
  });

  it("supports nullable types via array form (draft 2020-12)", () => {
    const schema = { type: ["string", "null"] };
    expect(validateData("hello", schema).valid).toBe(true);
    expect(validateData(null, schema).valid).toBe(true);
    expect(validateData(42, schema).valid).toBe(false);
  });
});

describe("compileSchema", () => {
  it("returns a reusable validator", () => {
    const schema = { type: "object", required: ["id"], properties: { id: { type: "string" } } };
    const validate = compileSchema(schema);
    expect(validate({ id: "a" }).valid).toBe(true);
    expect(validate({ id: "b" }).valid).toBe(true);
    expect(validate({}).valid).toBe(false);
  });

  it("emits the same errors as validateData", () => {
    const schema = { type: "object", required: ["x"], properties: { x: { type: "number" } } };
    const compiled = compileSchema(schema);
    const oneShot = validateData({ x: "wrong" }, schema);
    const reused = compiled({ x: "wrong" });
    expect(oneShot.valid).toBe(reused.valid);
  });

  it("repeated calls with the same compiled validator do not leak across invocations", () => {
    // Regression guard for the cycle-1 cache-growth issue: each
    // compileSchema call creates its own Ajv instance. Reusing the
    // same compiled validator across many calls is the recommended
    // hot-path shape; this test exercises that without asserting
    // memory directly.
    const validate = compileSchema({ type: "object", properties: { i: { type: "number" } } });
    for (let i = 0; i < 1000; i++) {
      expect(validate({ i }).valid).toBe(true);
    }
  });
});

describe("validateSchemaCompatibility", () => {
  describe("type matching", () => {
    it("accepts identical primitive types", () => {
      expect(validateSchemaCompatibility({ type: "string" }, { type: "string" }).valid).toBe(true);
    });

    it("rejects mismatched primitive types", () => {
      const result = validateSchemaCompatibility({ type: "string" }, { type: "number" });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0].keyword).toBe("type");
        expect(result.errors[0].message).toContain("string");
        expect(result.errors[0].message).toContain("number");
      }
    });

    it("accepts when only the upstream declares a type", () => {
      expect(validateSchemaCompatibility({ type: "string" }, {}).valid).toBe(true);
    });

    it("accepts when only the downstream declares a type", () => {
      expect(validateSchemaCompatibility({}, { type: "string" }).valid).toBe(true);
    });

    it("treats type as a set — array form accepted when subset", () => {
      // Upstream emits string. Downstream accepts string-or-null. OK.
      const result = validateSchemaCompatibility(
        { type: "string" },
        { type: ["string", "null"] },
      );
      expect(result.valid).toBe(true);
    });

    it("rejects nullable upstream against non-null downstream", () => {
      // Upstream emits string or null. Downstream only accepts string.
      // Upstream null would crash the downstream — reject.
      const result = validateSchemaCompatibility(
        { type: ["string", "null"] },
        { type: "string" },
      );
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0].keyword).toBe("type");
        expect(result.errors[0].message).toContain("null");
      }
    });

    it("accepts identical array-form types", () => {
      expect(
        validateSchemaCompatibility(
          { type: ["string", "null"] },
          { type: ["string", "null"] },
        ).valid,
      ).toBe(true);
    });
  });

  describe("object required fields", () => {
    it("accepts when upstream requires every downstream-required field", () => {
      const result = validateSchemaCompatibility(
        { type: "object", required: ["a", "b"], properties: { a: { type: "string" }, b: { type: "number" } } },
        { type: "object", required: ["a"], properties: { a: { type: "string" } } },
      );
      expect(result.valid).toBe(true);
    });

    it("rejects when a downstream-required field is absent from upstream", () => {
      const result = validateSchemaCompatibility(
        { type: "object", required: [], properties: { a: { type: "string" } } },
        { type: "object", required: ["missing"], properties: { missing: { type: "string" } } },
      );
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0].keyword).toBe("required");
        expect(result.errors[0].message).toContain("missing");
      }
    });

    it("rejects when downstream requires a field that upstream lists only as a property (strict requiredness)", () => {
      // Strict rule: optional upstream is not sufficient. The
      // upstream value `{}` (no `maybe` key) is valid upstream output
      // but invalid downstream input — that's exactly what the
      // load-time check exists to catch.
      const result = validateSchemaCompatibility(
        { type: "object", properties: { maybe: { type: "string" } } },
        { type: "object", required: ["maybe"], properties: { maybe: { type: "string" } } },
      );
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0].keyword).toBe("required");
        expect(result.errors[0].message).toContain("maybe");
      }
    });
  });

  describe("nested object properties", () => {
    it("recursively checks shared property schemas", () => {
      const result = validateSchemaCompatibility(
        { type: "object", properties: { inner: { type: "string" } } },
        { type: "object", properties: { inner: { type: "number" } } },
      );
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0].path).toBe("/inner");
        expect(result.errors[0].keyword).toBe("type");
      }
    });

    it("accepts upstream properties not present in downstream", () => {
      const result = validateSchemaCompatibility(
        { type: "object", properties: { a: { type: "string" }, b: { type: "number" } } },
        { type: "object", properties: { a: { type: "string" } } },
      );
      expect(result.valid).toBe(true);
    });
  });

  describe("array item schemas", () => {
    it("recurses into items when both declare them as a schema object", () => {
      const result = validateSchemaCompatibility(
        { type: "array", items: { type: "string" } },
        { type: "array", items: { type: "number" } },
      );
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0].path).toBe("/items");
      }
    });

    it("accepts matching item schemas", () => {
      const result = validateSchemaCompatibility(
        { type: "array", items: { type: "string" } },
        { type: "array", items: { type: "string" } },
      );
      expect(result.valid).toBe(true);
    });

    it("does not recurse into tuple-form items (documented limitation)", () => {
      // items: [...] is the tuple form. Walker treats both as opaque.
      const result = validateSchemaCompatibility(
        { type: "array", items: [{ type: "string" }] },
        { type: "array", items: [{ type: "number" }] },
      );
      expect(result.valid).toBe(true);
    });
  });

  describe("enum subset", () => {
    it("accepts upstream enum that is a subset of downstream enum", () => {
      const result = validateSchemaCompatibility(
        { enum: ["a", "b"] },
        { enum: ["a", "b", "c"] },
      );
      expect(result.valid).toBe(true);
    });

    it("rejects upstream enum values not in downstream enum", () => {
      const result = validateSchemaCompatibility(
        { enum: ["a", "x"] },
        { enum: ["a", "b"] },
      );
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0].keyword).toBe("enum");
        expect(result.errors[0].message).toContain("x");
      }
    });

    it("rejects unconstrained upstream when downstream has enum", () => {
      // Upstream is `{ type: 'string' }` — can emit any string.
      // Downstream restricts to enum — upstream's freedom would
      // crash downstream at runtime.
      const result = validateSchemaCompatibility(
        { type: "string" },
        { type: "string", enum: ["a", "b"] },
      );
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0].keyword).toBe("enum");
        expect(result.errors[0].message).toContain("unconstrained");
      }
    });

    it("accepts upstream-only enum (downstream is unconstrained)", () => {
      const result = validateSchemaCompatibility(
        { enum: ["a", "b"] },
        { type: "string" },
      );
      expect(result.valid).toBe(true);
    });
  });

  describe("documented limitations", () => {
    it("does NOT reject on oneOf differences (opaque combinator)", () => {
      const result = validateSchemaCompatibility(
        { type: "object", oneOf: [{ properties: { a: { type: "string" } } }] },
        { type: "object", oneOf: [{ properties: { b: { type: "number" } } }] },
      );
      expect(result.valid).toBe(true);
    });

    it("does NOT enforce additionalProperties: false rejection of upstream extras", () => {
      const result = validateSchemaCompatibility(
        { type: "object", properties: { a: { type: "string" }, extra: { type: "number" } } },
        { type: "object", properties: { a: { type: "string" } }, additionalProperties: false },
      );
      expect(result.valid).toBe(true);
    });

    it("does NOT resolve $ref — recursive schemas terminate via opaque treatment", () => {
      // Walker only recurses into resolved properties/items, never $ref.
      // A self-referential schema should not infinite-loop.
      const recursive: Record<string, unknown> = {
        $defs: { Tree: { type: "object", properties: { child: { $ref: "#/$defs/Tree" } } } },
        type: "object",
        properties: { root: { $ref: "#/$defs/Tree" } },
      };
      // Must terminate.
      const result = validateSchemaCompatibility(recursive, recursive);
      expect(result.valid).toBe(true);
    });

    it("collects multiple compatibility errors", () => {
      const result = validateSchemaCompatibility(
        { type: "object", properties: { a: { type: "string" }, b: { type: "string" } } },
        { type: "object", properties: { a: { type: "number" }, b: { type: "number" } } },
      );
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.length).toBe(2);
        const paths = result.errors.map((e) => e.path).sort();
        expect(paths).toEqual(["/a", "/b"]);
      }
    });
  });

  describe("compatibility errors carry path information", () => {
    it("reports nested path for incompatible deep property", () => {
      const result = validateSchemaCompatibility(
        { type: "object", properties: { outer: { type: "object", properties: { inner: { type: "string" } } } } },
        { type: "object", properties: { outer: { type: "object", properties: { inner: { type: "number" } } } } },
      );
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0].path).toBe("/outer/inner");
      }
    });

    it("emits '' for root-level type mismatch (RFC 6901)", () => {
      const result = validateSchemaCompatibility({ type: "string" }, { type: "number" });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0].path).toBe("");
      }
    });
  });
});
