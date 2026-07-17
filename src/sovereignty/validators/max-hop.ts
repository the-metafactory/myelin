import type { MyelinEnvelope } from "../../types";
import { getSignedByChain } from "../../identity/chain";
import type { SovereigntyValidationResult } from "../types";

/**
 * max_hop forwarding-TTL enforcement (RFC-0005 §2.4, grill D3).
 *
 * `max_hop` is an origin-declared forwarding TTL enforced against the observed
 * RFC-0004 `signed_by` signature chain — never a mutable counter, never
 * decremented (the block is signable, §3, so a forwarder cannot rewrite it
 * without breaking every prior stamp). The origin's stamp is chain position 1
 * and each forwarding hop appends one stamp, so:
 *
 *     forwards = len(signed_by chain) − 1
 *     reject  ⇔  forwards > max_hop
 *
 * `max_hop: 0` therefore means origin-only: a directly-signed 1-stamp envelope
 * (0 forwards) is ACCEPTED, any forwarded copy REJECTED. This is the exact
 * off-by-one the deployed cortex gate (`chain.length > max_hop`) got wrong — it
 * rejected the 1-stamp origin envelope at `max_hop: 0`; ours must not.
 */

/** Kebab reason token — the snake flip is staged separately (myelin#233). */
export type MaxHopReason = "max-hop-exceeded";

export type MaxHopResult =
  | { valid: true; forwards: number }
  | { valid: false; reason: MaxHopReason };

/**
 * Pure TTL check. `chainLength` is the number of `signed_by` stamps observed
 * (RFC-0004 chain length); `maxHop` is the origin-declared forwarding budget.
 * Conformance-vector entrypoint (`crossing.json` kind `enforceMaxHop`).
 */
export function enforceMaxHop(maxHop: number, chainLength: number): MaxHopResult {
  const forwards = chainLength - 1;
  if (forwards > maxHop) {
    return { valid: false, reason: "max-hop-exceeded" };
  }
  return { valid: true, forwards };
}

/**
 * Envelope-bound wrapper for the ingress/forward path. Extracts the observed
 * chain length and enforces the origin-declared `max_hop` TTL, mapping a
 * rejection into the `compliance-block:*` nak family.
 *
 * An unsigned envelope (empty chain) has no origin stamp and no forwarding
 * evidence — the TTL does not apply; the unsigned-envelope rejection is owned
 * by the ingress principal check, so this wrapper defers (returns valid).
 */
export function enforceMaxHopEnvelope(
  envelope: MyelinEnvelope,
): SovereigntyValidationResult {
  const chainLength = getSignedByChain(envelope).length;
  if (chainLength === 0) return { valid: true };
  const result = enforceMaxHop(envelope.sovereignty.max_hop, chainLength);
  if (result.valid) return { valid: true };
  return {
    valid: false,
    code: "compliance-block:max-hop-exceeded",
    reason: `max_hop ${envelope.sovereignty.max_hop} exceeded: ${chainLength - 1} forward(s) observed in signed_by chain`,
  };
}
