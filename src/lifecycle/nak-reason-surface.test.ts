import { describe, it, expect } from "bun:test";

import type { NakReason as PublicNakReason } from "../index";
import {
  NAK_REASON_VALUES,
  type NakReason as WireNakReason,
} from "../wire/generated/r/transport";

/**
 * Two guards on the public `NakReason`, run by two different commands:
 *
 * - **Member set** — `bun test`. The generated terminal must equal a fixed
 *   baseline, so an ABNF edit that widens or re-spells it fails here.
 *   `abnf-gen --check` cannot catch that: it proves generated-matches-ABNF.
 * - **No divergent re-duplication** — `tsc --noEmit` (CI lint job; `bun test`
 *   strips types and never sees it). Holds by construction while this is a
 *   re-export; it earns its place if a local definition reappears.
 *
 * The second cannot detect a widened GENERATED union — the public type is the
 * generated type, so both move together. That is the first's job.
 */

type MutuallyAssignable<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false;
type Assert<T extends true> = T;

type _PublicStaysInterchangeableWithWire = Assert<
  MutuallyAssignable<PublicNakReason, WireNakReason>
>;

describe("NakReason public surface", () => {
  it("the generated terminal is exactly the RFC-0007 §3.1 snake_case set", () => {
    // One assertion covers membership, arity, and spelling: a kebab alias, a
    // fifth value, or a dropped value all fail against this baseline. (The
    // kebab renderings are receive-only and live in NAK_REASON_ALIAS_VALUES.)
    expect([...NAK_REASON_VALUES].sort()).toEqual([
      "cant_do",
      "compliance_block",
      "not_now",
      "wont_do",
    ]);
  });
});
