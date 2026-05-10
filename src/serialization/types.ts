import type { MyelinEnvelope } from "../types";

/**
 * F-3: pluggable wire-format codec for envelope serialization.
 *
 * Codec encodes/decodes the *wire* representation. JCS canonicalization
 * (src/jcs.ts) is for *signing* and is independent of the wire codec —
 * an envelope can be signed once and then re-encoded across different
 * wire formats without re-signing.
 *
 * Implementations MUST be:
 *   - Pure: same input → same output bytes (within the codec's freedom).
 *   - Symmetric: decode(encode(envelope)) deep-equals envelope.
 *   - Self-describing OR carry codec metadata via envelope.extensions.codec
 *     so subscribers can detect the wire format.
 */
export type CodecId = "json" | "msgpack";

export interface Codec {
  readonly id: CodecId;
  encode(envelope: MyelinEnvelope): Uint8Array;
  decode(data: Uint8Array): MyelinEnvelope;
}

export interface CodecRegistry {
  get(id: CodecId): Codec;
  list(): CodecId[];
  register(codec: Codec): void;
}
