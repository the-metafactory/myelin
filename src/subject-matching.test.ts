import { describe, it, expect, beforeEach } from "bun:test";
import {
  compileSubjectPattern,
  subjectMatchesPattern,
  clearSubjectPatternCache,
  __subjectPatternCacheSize,
} from "./subject-matching";

describe("compileSubjectPattern cache", () => {
  beforeEach(() => {
    clearSubjectPatternCache();
  });

  it("returns the same RegExp instance for repeated pattern lookups", () => {
    const a = compileSubjectPattern("local.metafactory.>");
    const b = compileSubjectPattern("local.metafactory.>");
    expect(a).toBe(b);
  });

  it("compiles distinct patterns to distinct RegExp instances", () => {
    const a = compileSubjectPattern("local.metafactory.>");
    const b = compileSubjectPattern("federated.metafactory.>");
    expect(a).not.toBe(b);
  });

  it("clearSubjectPatternCache() empties the cache", () => {
    compileSubjectPattern("local.metafactory.>");
    compileSubjectPattern("federated.metafactory.>");
    expect(__subjectPatternCacheSize()).toBeGreaterThan(0);
    clearSubjectPatternCache();
    expect(__subjectPatternCacheSize()).toBe(0);
  });

  it("after clearing, a fresh compile produces a new RegExp instance", () => {
    const a = compileSubjectPattern("local.metafactory.>");
    clearSubjectPatternCache();
    const b = compileSubjectPattern("local.metafactory.>");
    expect(a).not.toBe(b);
    // But behavioural equivalence holds.
    expect(a.source).toBe(b.source);
  });

  it("invalid patterns still throw and are not cached", () => {
    expect(() => compileSubjectPattern("local.>.tasks")).toThrow();
    expect(__subjectPatternCacheSize()).toBe(0);
    // A subsequent valid call should compile normally.
    compileSubjectPattern("local.>");
    expect(__subjectPatternCacheSize()).toBe(1);
  });
});

describe("subjectMatchesPattern uses cache", () => {
  beforeEach(() => {
    clearSubjectPatternCache();
  });

  it("produces consistent results across repeated invocations", () => {
    expect(subjectMatchesPattern("local.metafactory.tasks.review", "local.metafactory.>")).toBe(true);
    expect(subjectMatchesPattern("local.metafactory.tasks.review", "local.metafactory.>")).toBe(true);
    expect(subjectMatchesPattern("federated.metafactory.tasks", "local.metafactory.>")).toBe(false);
    expect(__subjectPatternCacheSize()).toBe(1);
  });
});
