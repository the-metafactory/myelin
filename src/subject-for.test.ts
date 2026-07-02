import { describe, expect, test } from "bun:test";
import { deriveSubject, subjectFor } from "./subjects";

/**
 * Tests for the ergonomic subjectFor() front door (remediation E3). Covers each
 * semantic branch plus equality with the underlying deriveSubject for the four
 * output forms, proving subjectFor adds no grammar logic of its own.
 */
describe("subjectFor", () => {
  test("public ignores principal/stack/legacy", () => {
    expect(subjectFor({ classification: "public", type: "registry.package.published" })).toBe(
      "public.registry.package.published",
    );
    expect(
      subjectFor({
        classification: "public",
        type: "registry.package.published",
        principal: "ignored",
        stack: "ignored",
      }),
    ).toBe("public.registry.package.published");
  });

  test("non-public without principal throws", () => {
    expect(() => subjectFor({ classification: "local", type: "ops.deploy.completed" })).toThrow(
      /principal required/,
    );
  });

  test("non-public without stack and without legacy throws", () => {
    expect(() =>
      subjectFor({ classification: "local", principal: "acme", type: "ops.deploy.completed" }),
    ).toThrow(/stack required; pass legacy:true/);
  });

  test("legacy:true emits the 5-segment form", () => {
    expect(
      subjectFor({ classification: "local", principal: "acme", type: "ops.deploy.completed", legacy: true }),
    ).toBe("local.acme.ops.deploy.completed");
  });

  test("stack emits the 6-segment stack-aware form", () => {
    expect(
      subjectFor({
        classification: "local",
        principal: "andreas",
        type: "experiments.run.completed",
        stack: "research",
      }),
    ).toBe("local.andreas.research.experiments.run.completed");
  });

  test("equals deriveSubject for the four forms", () => {
    // public
    expect(subjectFor({ classification: "public", type: "a.b.c" })).toBe(
      deriveSubject("public", "", "a.b.c"),
    );
    // local legacy (5-segment)
    expect(subjectFor({ classification: "local", principal: "acme", type: "a.b.c", legacy: true })).toBe(
      deriveSubject("local", "acme", "a.b.c"),
    );
    // local stack-aware (6-segment)
    expect(
      subjectFor({ classification: "local", principal: "acme", type: "a.b.c", stack: "s1" }),
    ).toBe(deriveSubject("local", "acme", "a.b.c", "s1"));
    // federated stack-aware
    expect(
      subjectFor({ classification: "federated", principal: "acme", type: "a.b.c", stack: "s1" }),
    ).toBe(deriveSubject("federated", "acme", "a.b.c", "s1"));
  });
});
