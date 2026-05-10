import type { MyelinEnvelope } from "../types";
import type { Codec } from "./types";

/**
 * F-3: default JSON codec. Backwards-compatible with all existing
 * transports — JSON has been the implicit wire format since v1, so a
 * JsonCodec MUST NOT set extensions.codec (subscribers don't expect it
 * on a JSON envelope).
 */
export class JsonCodec implements Codec {
  readonly id = "json" as const;
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();

  encode(envelope: MyelinEnvelope): Uint8Array {
    return this.encoder.encode(JSON.stringify(envelope));
  }

  decode(data: Uint8Array): MyelinEnvelope {
    const text = this.decoder.decode(data);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error(
        `JsonCodec.decode: invalid JSON (${err instanceof Error ? err.message : String(err)})`,
      );
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("JsonCodec.decode: expected an envelope object, got " + typeof parsed);
    }
    return parsed as MyelinEnvelope;
  }
}

export const jsonCodec = new JsonCodec();
