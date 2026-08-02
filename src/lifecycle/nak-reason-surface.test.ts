import { describe, it, expect } from "bun:test";

import type { NakReason as PublicNakReason } from "../index";
import {
  NAK_REASON_VALUES,
  type NakReason as WireNakReason,
} from "../wire/generated/r/transport";

/**
 * Public-surface guard for the `NakReason` re-export (myelin#235).
 *
 * #302 moved this type's definition from a hand-written union in
 * `lifecycle/types.ts` to the abnf-gen terminal in `./wire`, and asserted the
 * public surface was unchanged. Review (correctly) pointed out that the claim
 * was taken on faith: `tsc --noEmit` alone does NOT flag a WIDENED generated
 * union, and it cannot speak for consumers importing the package's public type.
 *
 * These assertions close that gap, and they are also the structural guard the
 * PR originally over-claimed for `abnf-gen --check`. That gate compares
 * generated output against the ABNF; it is blind to someone re-introducing a
 * hand-written union in another module. This file is not blind to it: if any
 * future definition makes the PUBLIC `NakReason` diverge from the generated
 * terminal — widened, narrowed, or re-spelled — `MutuallyAssignable` stops
 * resolving to `true` and the build fails here.
 *
 * Scope, stated honestly: this guards the exported `NakReason` specifically, not
 * "no duplicate token union may exist anywhere in the tree".
 */

type MutuallyAssignable<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false;
type Assert<T extends true> = T;

// Fails to compile if the public type and the generated terminal drift apart
// in EITHER direction.
type _PublicMatchesWire = Assert<MutuallyAssignable<PublicNakReason, WireNakReason>>;

describe("NakReason public surface (myelin#235)", () => {
  it("every generated terminal is a valid public NakReason", () => {
    // Compile-time: each member must be assignable to the public type.
    // Runtime: the set is non-empty, so a generated file emptied by a broken
    // codegen run cannot make the assertion vacuously true.
    const all: PublicNakReason[] = [...NAK_REASON_VALUES];
    expect(all.length).toBeGreaterThan(0);
    expect(new Set(all).size).toBe(all.length);
  });

  it("carries the snake spelling the RFC-0007 §3.1 set requires", () => {
    // Not a re-declaration of the union — a directional check that the flip
    // landed and no kebab alias leaked into the CANONICAL set (the aliases live
    // in NAK_REASON_ALIAS_VALUES and are receive-only).
    for (const v of NAK_REASON_VALUES) {
      expect(v).not.toContain("-");
    }
  });
});
