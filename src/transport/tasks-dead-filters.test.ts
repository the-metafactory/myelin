import { describe, expect, it } from "bun:test";
import { DEAD_LETTER_STREAM_FILTERS } from "./jetstream-base";
import { deriveDeadLetterSubject } from "./dead-letter";

/**
 * RFC-0007 §5.2 / D19 — the TASKS_DEAD stream must retain EVERY dead-letter
 * subject the deriver can emit. The deriver preserves an optional `{stack}`
 * segment, so it emits both a legacy 5-segment and a stack-aware 6-segment
 * shape; the filter set has to cover both for `local` and `federated`.
 */

/**
 * NATS subject-filter match semantics: `*` matches exactly one token, `>`
 * matches one-or-more trailing tokens (and may only appear last). Literals
 * match by equality. This is the same matching JetStream applies when
 * deciding whether a published subject lands in a stream.
 */
function natsFilterMatches(filter: string, subject: string): boolean {
  const f = filter.split(".");
  const s = subject.split(".");
  for (let i = 0; i < f.length; i++) {
    const token = f[i]!;
    if (token === ">") {
      // `>` requires at least one remaining subject token.
      return s.length > i;
    }
    if (i >= s.length) return false;
    if (token === "*") continue;
    if (token !== s[i]) return false;
  }
  return f.length === s.length;
}

const CLASSIFICATIONS = ["local", "federated"] as const;
const PRINCIPALS = ["acme", "metafactory"] as const;
const STACKS = ["default", "research"] as const;
const CAPABILITIES = ["code-review", "pr-merge"] as const;

describe("TASKS_DEAD dead-letter stream filters (RFC-0007 §5.2 / D19)", () => {
  it("covers the legacy 5-segment pair AND the stack-aware 6-segment pair for local + federated", () => {
    expect(DEAD_LETTER_STREAM_FILTERS).toEqual([
      "local.*.tasks.dead-letter.>",
      "federated.*.tasks.dead-letter.>",
      "local.*.*.tasks.dead-letter.>",
      "federated.*.*.tasks.dead-letter.>",
    ]);
  });

  it("deriver output ⊆ filters: every classification × stack-form derived subject matches ≥1 filter", () => {
    for (const cls of CLASSIFICATIONS) {
      for (const principal of PRINCIPALS) {
        for (const capability of CAPABILITIES) {
          // Legacy 5-segment original → 5-segment dead-letter subject.
          const legacyOriginal = `${cls}.${principal}.tasks.${capability}.typescript`;
          const legacyDead = deriveDeadLetterSubject(legacyOriginal);
          expect(
            DEAD_LETTER_STREAM_FILTERS.some((f) => natsFilterMatches(f, legacyDead)),
            `no filter matched legacy dead-letter subject ${legacyDead}`,
          ).toBe(true);

          // Stack-aware 6-segment originals → 6-segment dead-letter subjects.
          for (const stack of STACKS) {
            const stackOriginal = `${cls}.${principal}.${stack}.tasks.${capability}.typescript`;
            const stackDead = deriveDeadLetterSubject(stackOriginal);
            expect(
              DEAD_LETTER_STREAM_FILTERS.some((f) => natsFilterMatches(f, stackDead)),
              `no filter matched stack-aware dead-letter subject ${stackDead}`,
            ).toBe(true);
          }
        }
      }
    }
  });

  it("the legacy 5-seg filter alone would MISS stack-aware subjects (the D19 defect this closes)", () => {
    const legacyOnly = DEAD_LETTER_STREAM_FILTERS.filter((f) => f.split(".").length === 5);
    const stackDead = deriveDeadLetterSubject("local.acme.default.tasks.code-review.typescript");
    // Proves the widening is load-bearing: the pre-fix filter set drops it.
    expect(legacyOnly.some((f) => natsFilterMatches(f, stackDead))).toBe(false);
    // And the full (widened) set catches it.
    expect(DEAD_LETTER_STREAM_FILTERS.some((f) => natsFilterMatches(f, stackDead))).toBe(true);
  });

  it("filter shapes are disjoint — no 6-seg filter matches a 5-seg subject and vice-versa", () => {
    const fiveSegDead = deriveDeadLetterSubject("federated.acme.tasks.pr-merge.x");
    const sixSegDead = deriveDeadLetterSubject("federated.acme.research.tasks.pr-merge.x");
    const sixSegFilters = DEAD_LETTER_STREAM_FILTERS.filter((f) => f.split(".").length === 6);
    const fiveSegFilters = DEAD_LETTER_STREAM_FILTERS.filter((f) => f.split(".").length === 5);
    expect(sixSegFilters.some((f) => natsFilterMatches(f, fiveSegDead))).toBe(false);
    expect(fiveSegFilters.some((f) => natsFilterMatches(f, sixSegDead))).toBe(false);
  });
});
