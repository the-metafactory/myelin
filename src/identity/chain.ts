import type { MyelinEnvelope } from "../types";
import type { SignedBy } from "./types";

/**
 * myelin#31 — chain-of-stamps helpers.
 *
 * The wire format accepts two shapes for `signed_by`:
 * 1. A single `SignedBy` object (legacy / single-stamp envelopes).
 * 2. An array of `SignedBy` (the canonical post-#31 chain form).
 *
 * Internally the library treats `signed_by` as `SignedBy[]`. These
 * helpers are the back-compat shim — they coerce shape (1) into (2)
 * without mutating the input.
 */

/**
 * Coerce a raw `signed_by` value (single object, array, undefined, or
 * unrecognized) into a stamp chain. Unrecognized shapes return an empty
 * chain — call sites that care about shape validity use
 * {@link validateEnvelope} from the envelope module first.
 */
export function toSignedByChain(value: unknown): SignedBy[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value as SignedBy[];
  if (typeof value === "object") return [value as SignedBy];
  return [];
}

/**
 * Return the stamp chain attached to an envelope, normalizing the
 * single-object back-compat shim into an array. Never returns
 * `undefined` — an unsigned envelope returns `[]`.
 */
export function getSignedByChain(envelope: MyelinEnvelope): SignedBy[] {
  return toSignedByChain(envelope.signed_by as unknown);
}

/**
 * Return a new envelope with `signed_by` normalized to the canonical
 * array form. The input is not mutated. Idempotent — calling this on
 * an already-normalized envelope produces an equal-by-shape result.
 */
export function normalizeSignedBy(envelope: MyelinEnvelope): MyelinEnvelope {
  const chain = getSignedByChain(envelope);
  if (chain.length === 0) {
    if (envelope.signed_by === undefined) return envelope;
    const { signed_by: _sb, ...rest } = envelope;
    return rest as MyelinEnvelope;
  }
  return { ...envelope, signed_by: chain };
}
