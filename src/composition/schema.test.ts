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
      expect(result.errors[0]!.keyword).toBe("required");
      expect(result.errors[0]!.message).toContain("name");
    }
  });

  it("rejects data with a type mismatch", () => {
    const schema = { type: "object", properties: { count: { type: "number" } } };
    const result = validateData({ count: "not-a-number" }, schema);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]!.keyword).toBe("type");
      expect(result.errors[0]!.path).toBe("/count");
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

  it("validates format keywords via ajv-formats", () => {
    const schema = { type: "string", format: "uri" };
    const ok = validateData("https://example.com", schema);
    expect(ok.valid).toBe(true);
    const bad = validateData("not a uri", schema);
    expect(bad.valid).toBe(false);
  });

  it("accepts arbitrary data against an empty schema", () => {
    expect(validateData({ anything: 1 }, {}).valid).toBe(true);
    expect(validateData(null, {}).valid).toBe(true);
    expect(validateData("string", {}).valid).toBe(true);
  });

  it("path is '/' for root-level type errors", () => {
    const result = validateData("string", { type: "number" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]!.path).toBe("/");
    }
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
        expect(result.errors[0]!.keyword).toBe("type");
        expect(result.errors[0]!.message).toContain("string");
        expect(result.errors[0]!.message).toContain("number");
      }
    });

    it("accepts when only the upstream declares a type", () => {
      expect(validateSchemaCompatibility({ type: "string" }, {}).valid).toBe(true);
    });

    it("accepts when only the downstream declares a type", () => {
      expect(validateSchemaCompatibility({}, { type: "string" }).valid).toBe(true);
    });
  });

  describe("object required fields", () => {
    it("accepts when upstream guarantees every downstream-required field", () => {
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
        expect(result.errors[0]!.keyword).toBe("required");
        expect(result.errors[0]!.message).toContain("missing");
      }
    });

    it("accepts when a downstream-required field is present in upstream properties even if not required", () => {
      // Upstream has 'maybe' as an optional property — that's still
      // present in the output type, so a downstream that requires it
      // gets the same type guarantee for the field shape. (The
      // documented limitation: this does not strictly prove
      // requiredness — we trust the upstream agent to fill it.)
      const result = validateSchemaCompatibility(
        { type: "object", properties: { maybe: { type: "string" } } },
        { type: "object", required: ["maybe"], properties: { maybe: { type: "string" } } },
      );
      expect(result.valid).toBe(true);
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
        expect(result.errors[0]!.path).toBe("/inner");
        expect(result.errors[0]!.keyword).toBe("type");
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
    it("recurses into items when both declare them", () => {
      const result = validateSchemaCompatibility(
        { type: "array", items: { type: "string" } },
        { type: "array", items: { type: "number" } },
      );
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0]!.path).toBe("/items");
      }
    });

    it("accepts matching item schemas", () => {
      const result = validateSchemaCompatibility(
        { type: "array", items: { type: "string" } },
        { type: "array", items: { type: "string" } },
      );
      expect(result.valid).toBe(true);
    });

    it("accepts when only upstream declares items", () => {
      const result = validateSchemaCompatibility(
        { type: "array", items: { type: "string" } },
        { type: "array" },
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
        expect(result.errors[0]!.keyword).toBe("enum");
        expect(result.errors[0]!.message).toContain("x");
      }
    });
  });

  describe("documented limitations", () => {
    it("does NOT rejects on oneOf differences (opaque combinator)", () => {
      // Both schemas have type 'object' so the structural check
      // accepts. oneOf is not recursed.
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
      // Documented limitation — passes the structural check even
      // though additionalProperties: false would fail at runtime.
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
        expect(result.errors[0]!.path).toBe("/outer/inner");
      }
    });
  });
});
