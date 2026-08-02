import { describe, it, expect } from "bun:test";

import { resolveNakReason } from "./transport";
import { NAK_REASON_VALUES, NAK_REASON_ALIAS_VALUES } from "./generated/r/transport";

/**
 * RFC-0007 §3.4 dual-accept window — the receive-side contract that makes the
 * §3.1 EMITTER flip (myelin#233) safe to land before flag-day R.
 *
 * Why this file exists: the emitter flip changed the same string literals in 33
 * files at once, so the rest of the suite passes identically under either
 * spelling — it proves internal consistency, not wire compatibility. These
 * assertions are the ones that would FAIL if the alias table were dropped, i.e.
 * if a peer still emitting the kebab spelling stopped being understood.
 */
describe("resolveNakReason — RFC-0007 §3.4 receive window", () => {
  it("normalizes every kebab alias to its snake canonical (a pre-cut peer is still understood)", () => {
    // Index-aligned by construction in ./generated/r/transport.
    NAK_REASON_ALIAS_VALUES.forEach((alias, i) => {
      const canonical = NAK_REASON_VALUES[i];
      const r = resolveNakReason(alias);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.reason).toBe(canonical!);
    });
  });

  it("accepts the snake canonicals unchanged (a post-flip peer is understood)", () => {
    for (const snake of NAK_REASON_VALUES) {
      const r = resolveNakReason(snake);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.reason).toBe(snake);
    }
  });

  it("coerces an unknown or missing reason to cant_do, never throwing", () => {
    for (const bad of ["nonsense", "", "  ", undefined, null, 42, {}]) {
      const r = resolveNakReason(bad);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.reason).toBe("cant_do");
    }
  });

  it("normalizes BEFORE coercing — a kebab alias must not fall through to cant_do", () => {
    // Guards grill D5: a blanket coerce applied first would silently reroute
    // every live kebab token to `cant_do` mid-window. `compliance-block` is the
    // sharpest case — it dead-letters fast-path, `cant_do` retries.
    const r = resolveNakReason("compliance-block");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.reason).toBe("compliance_block");
  });
});
