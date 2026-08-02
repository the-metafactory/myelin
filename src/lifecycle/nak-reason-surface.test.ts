import { describe, it, expect } from "bun:test";

import type { NakReason as PublicNakReason } from "../index";
import {
  NAK_REASON_VALUES,
  type NakReason as WireNakReason,
} from "../wire/generated/r/transport";

/**
 * Guards for the public `NakReason` export.
 *
 * Two DIFFERENT properties, caught by two DIFFERENT gates. Neither subsumes the
 * other, and the type-level one is invisible to `bun test`:
 *
 * 1. **Member set** (runtime, caught by `bun test`) — the generated terminal
 *    carries exactly the four RFC-0007 §3.1 values. Restating them here is
 *    deliberate: a test is an INDEPENDENT statement of expectation, so a
 *    codegen run that widens, narrows, or re-spells the set fails against a
 *    fixed baseline rather than silently redefining what "correct" means.
 *    `abnf-gen --check` cannot do this — it proves generated-matches-ABNF, so
 *    an ABNF edit propagates through it unnoticed.
 *
 * 2. **No divergent re-duplication** (compile-time, caught by `tsc --noEmit`,
 *    which CI runs in the lint job — NOT by `bun test`, which strips types) —
 *    the package's exported `NakReason` stays interchangeable with the
 *    generated terminal. Today it IS that type by re-export, so this holds by
 *    construction; the assertion earns its place if someone later reintroduces
 *    a local definition, which is exactly how the kebab/snake divergence
 *    myelin#233 had to unwind arose.
 *
 * What (2) explicitly does NOT do: detect a widened GENERATED union. The public
 * type is the generated type, so both sides move together and mutual
 * assignability stays true. That case is (1)'s job.
 */

type MutuallyAssignable<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false;
type Assert<T extends true> = T;

// Compile-time only. Fails `tsc`, not `bun test`.
type _PublicStaysInterchangeableWithWire = Assert<
  MutuallyAssignable<PublicNakReason, WireNakReason>
>;

describe("NakReason public surface", () => {
  it("the generated terminal carries exactly the RFC-0007 §3.1 four-value set", () => {
    expect([...NAK_REASON_VALUES].sort()).toEqual([
      "cant_do",
      "compliance_block",
      "not_now",
      "wont_do",
    ]);
  });

  it("every canonical value is snake_case, never a kebab alias", () => {
    // The kebab renderings are receive-only aliases and live in
    // NAK_REASON_ALIAS_VALUES; none may leak into the canonical set.
    for (const v of NAK_REASON_VALUES) {
      expect(v).toMatch(/^[a-z]+(?:_[a-z]+)*$/);
    }
  });

  it("a generated value is assignable to the package's exported type", () => {
    const sample: PublicNakReason = NAK_REASON_VALUES[0];
    expect(NAK_REASON_VALUES).toContain(sample);
  });
});
