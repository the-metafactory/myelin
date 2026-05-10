// F-020: correlation-id utilities. UUIDv4 by construction.
// F-9: trace propagation + reconstruction helpers built on top of
//      correlation_id alone (no new envelope field — causation derives
//      from the correlation_id sequence + chain-of-stamps history).

import type { MyelinEnvelope, CreateEnvelopeInput } from "../types";
import { isValidUUID } from "../uuid";
import { createEnvelope } from "../envelope";

export function generateCorrelationId(): string {
  return crypto.randomUUID();
}

export function isValidCorrelationId(id: string): boolean {
  return isValidUUID(id);
}

/**
 * F-9: ensure an envelope-input carries a correlation_id. If absent,
 * generate one. If present, validate. Returns a new object — does not
 * mutate input.
 */
export function ensureCorrelationId<T extends { correlation_id?: string }>(
  envelopeOrInput: T,
): T & { correlation_id: string } {
  if (envelopeOrInput.correlation_id) {
    if (!isValidCorrelationId(envelopeOrInput.correlation_id)) {
      throw new Error(`ensureCorrelationId: invalid correlation_id '${envelopeOrInput.correlation_id}'`);
    }
    return envelopeOrInput as T & { correlation_id: string };
  }
  return { ...envelopeOrInput, correlation_id: generateCorrelationId() };
}

/**
 * F-9: build a child envelope that shares the parent's correlation_id.
 * If the parent has no correlation_id, generates a fresh one and the
 * child carries it (root of a new chain). The child gets a fresh `id`
 * via createEnvelope; causation derives from the timestamp ordering of
 * envelopes sharing the same correlation_id (and from chain-of-stamps
 * when signed-delegation history is present), not from a separate field.
 */
export function deriveChildEnvelope(
  parent: MyelinEnvelope,
  input: Omit<CreateEnvelopeInput, "correlation_id">,
): MyelinEnvelope {
  const correlation_id = parent.correlation_id ?? generateCorrelationId();
  return createEnvelope({ ...input, correlation_id });
}

/**
 * F-9: semantic alias for request/reply flows. Same propagation rule as
 * deriveChildEnvelope — separate name documents intent at call sites.
 */
export function createReplyEnvelope(
  parent: MyelinEnvelope,
  input: Omit<CreateEnvelopeInput, "correlation_id">,
): MyelinEnvelope {
  return deriveChildEnvelope(parent, input);
}

export interface TraceNode {
  envelope: MyelinEnvelope;
  /** Index in the trace, after stable timestamp sort. Useful for stable rendering. */
  index: number;
}

/**
 * F-9: reconstruct a trace from a flat envelope collection, scoped to
 * one correlation_id. Returns the matching envelopes sorted by timestamp
 * (lexical ISO-8601 ordering — UTC-normalized). Same-timestamp envelopes
 * preserve input order (stable sort).
 *
 * Causation-style "tree" reconstruction is intentionally NOT done here:
 * correlation_id alone does not carry parent links. The chain shape
 * comes from chain-of-stamps (myelin#31) which signs delegation hops,
 * or from event-type semantics consumers know about. A pure helper
 * should not invent structure it doesn't see in the data.
 */
export function reconstructTrace(
  envelopes: ReadonlyArray<MyelinEnvelope>,
  correlation_id: string,
): TraceNode[] {
  if (!isValidCorrelationId(correlation_id)) {
    throw new Error(`reconstructTrace: invalid correlation_id '${correlation_id}'`);
  }
  const indexed = envelopes
    .map((envelope, originalIndex) => ({ envelope, originalIndex }))
    .filter(({ envelope }) => envelope.correlation_id === correlation_id);
  indexed.sort((a, b) => {
    if (a.envelope.timestamp < b.envelope.timestamp) return -1;
    if (a.envelope.timestamp > b.envelope.timestamp) return 1;
    return a.originalIndex - b.originalIndex;
  });
  return indexed.map(({ envelope }, index) => ({ envelope, index }));
}

/**
 * F-9: convenience predicate — is this envelope the root (earliest by
 * timestamp) of its correlation_id sequence in the given collection?
 */
export function isRootOfTrace(
  envelope: MyelinEnvelope,
  envelopes: ReadonlyArray<MyelinEnvelope>,
): boolean {
  if (!envelope.correlation_id) return true;
  const trace = reconstructTrace(envelopes, envelope.correlation_id);
  return trace.length > 0 && trace[0]!.envelope.id === envelope.id;
}
