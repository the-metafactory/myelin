import { describe, it, expect } from "bun:test";
import {
  parseCapabilityId,
  matchCapabilityId,
  validatePresenceAnnouncement,
  crossGrammarAgreement,
  matchSovereigntyMode,
} from "./capability";

/**
 * Defensive unit coverage for the converged capability-id codec (RFC-0008
 * §4.1/§4.2/§4.3/§7). The conformance suite already asserts the pack vectors;
 * this file targets the adversarial edges those vectors do not enumerate —
 * whole-segment boundaries, matcher directionality, dot/underscore/empty
 * degenerates — so the segment-prefix matcher cannot be broken by a crafted id.
 */

describe("parseCapabilityId — accept", () => {
  it("single-segment tags return the tag form", () => {
    expect(parseCapabilityId("code-review")).toEqual({ ok: true, value: { tag: "code-review" } });
    expect(parseCapabilityId("ts")).toEqual({ ok: true, value: { tag: "ts" } });
  });

  it("dotted compounds return ordered segments", () => {
    expect(parseCapabilityId("dev.implement")).toEqual({ ok: true, value: { segments: ["dev", "implement"] } });
    expect(parseCapabilityId("deploy.k8s.prod")).toEqual({ ok: true, value: { segments: ["deploy", "k8s", "prod"] } });
  });
});

describe("parseCapabilityId — kebab-strict rejects", () => {
  const cases: [string, string][] = [
    ["a", "single-char-forbidden"],
    ["Code-Review", "uppercase-not-allowed"],
    ["code--review", "consecutive-hyphen"],
    ["code-review-", "trailing-hyphen"],
    ["-code", "leading-hyphen"],
    ["2d", "digit-prefix"],
    ["code_review", "underscore-not-allowed"],
    ["federated.subject_dispatch", "underscore-in-segment"],
  ];
  for (const [id, reason] of cases) {
    it(`${id} → ${reason}`, () => {
      expect(parseCapabilityId(id)).toEqual({ ok: false, reason });
    });
  }

  it("empty, dot-edge, and non-string inputs reject (never accept)", () => {
    expect(parseCapabilityId("")).toEqual({ ok: false, reason: "empty" });
    expect(parseCapabilityId(".")).toEqual({ ok: false, reason: "empty-segment" });
    expect(parseCapabilityId(".foo")).toEqual({ ok: false, reason: "empty-segment" });
    expect(parseCapabilityId("foo.")).toEqual({ ok: false, reason: "empty-segment" });
    expect(parseCapabilityId("foo..bar")).toEqual({ ok: false, reason: "empty-segment" });
    expect(parseCapabilityId(42).ok).toBe(false);
    expect(parseCapabilityId(null).ok).toBe(false);
    expect(parseCapabilityId(undefined).ok).toBe(false);
  });
});

describe("matchCapabilityId — directional segment-prefix (§4.2)", () => {
  it("a required parent matches a more-specific advertisement", () => {
    expect(matchCapabilityId({ required: "code-review", advertised: "code-review.typescript" }))
      .toEqual({ ok: true, value: { match: true } });
  });

  it("the reverse direction does NOT match", () => {
    expect(matchCapabilityId({ required: "code-review.typescript", advertised: "code-review" }))
      .toEqual({ ok: true, value: { match: false } });
  });

  it("equal ids match", () => {
    expect(matchCapabilityId({ required: "deploy.k8s", advertised: "deploy.k8s" }))
      .toEqual({ ok: true, value: { match: true } });
  });

  it("string startsWith false-positive is rejected (whole-segment only)", () => {
    // "code-review".startsWith("code-rev") is true; segment-wise it is NOT.
    expect(matchCapabilityId({ required: "code-rev", advertised: "code-review" }))
      .toEqual({ ok: true, value: { match: false } });
    // A partial trailing segment must not match either.
    expect(matchCapabilityId({ required: "code-review.type", advertised: "code-review.typescript" }))
      .toEqual({ ok: true, value: { match: false } });
  });

  it("a shared prefix that diverges deeper does not match", () => {
    expect(matchCapabilityId({ required: "deploy.k8s", advertised: "deploy.docker" }))
      .toEqual({ ok: true, value: { match: false } });
  });

  it("an ungrammatical id can never yield match:true", () => {
    expect(matchCapabilityId({ required: "code_review", advertised: "code-review" }).ok).toBe(false);
    expect(matchCapabilityId({ required: "code-review", advertised: "Code-Review" }).ok).toBe(false);
    expect(matchCapabilityId({ required: "", advertised: "code-review" }).ok).toBe(false);
  });
});

describe("validatePresenceAnnouncement — fold-gate (§7 D5)", () => {
  it("folds a well-formed announcement", () => {
    expect(validatePresenceAnnouncement({ capabilities: ["code-review.typescript"] }))
      .toEqual({ ok: true, value: { folded: true } });
  });

  it("rejects a reserved tag before fold", () => {
    expect(validatePresenceAnnouncement({ capabilities: ["dead-letter"] }))
      .toEqual({ ok: false, reason: "reserved-capability-tag" });
    expect(validatePresenceAnnouncement({ capabilities: ["@luna"] }).ok).toBe(false);
  });

  it("rejects an ungrammatical capability before fold", () => {
    expect(validatePresenceAnnouncement({ capabilities: ["Bad_Cap"] }))
      .toEqual({ ok: false, reason: "ungrammatical-capability-id" });
  });

  it("rejects a non-array capabilities field", () => {
    expect(validatePresenceAnnouncement({ capabilities: "code-review" }).ok).toBe(false);
    expect(validatePresenceAnnouncement({}).ok).toBe(false);
  });
});

describe("crossGrammarAgreement — masking diagnostic (§4.2)", () => {
  it("a seed tag is admitted by both pre-convergence grammars", () => {
    expect(crossGrammarAgreement("code-review"))
      .toEqual({ ok: true, value: { acceptedByTag: true, acceptedByCompound: true } });
  });

  it("an underscore compound is admitted only by the retired cortex grammar", () => {
    const r = crossGrammarAgreement("federated.subject_dispatch");
    expect(r).toEqual({ ok: true, value: { acceptedByTag: false, acceptedByCompound: true } });
  });
});

describe("matchSovereigntyMode — plain equality (§6.5)", () => {
  it("byte-equal modes match; there is no implied ordering", () => {
    expect(matchSovereigntyMode({ required: "strict", declared: "strict" }))
      .toEqual({ ok: true, value: { match: true } });
    expect(matchSovereigntyMode({ required: "selective", declared: "strict" }))
      .toEqual({ ok: true, value: { match: false } });
  });
});
