import { encode as msgpackEncode, decode as msgpackDecode } from "@msgpack/msgpack";
import type { MyelinEnvelope } from "../types";
import type { Codec } from "./types";

/**
 * F-3: MessagePack codec. Wire bytes are typically 30-50% smaller than
 * JSON for the same envelope. Encoded envelopes carry
 * `extensions.codec = "msgpack"` so subscribers can verify the wire
 * format after decode (in addition to first-byte detection).
 *
 * Consumers must register this codec explicitly:
 *   createCodecRegistry({ codecs: [new MsgpackCodec()] })
 *
 * The msgpack package is an optional runtime cost — only paid when the
 * codec is instantiated.
 */
export class MsgpackCodec implements Codec {
  readonly id = "msgpack" as const;

  encode(envelope: MyelinEnvelope): Uint8Array {
    const tagged: MyelinEnvelope = {
      ...envelope,
      extensions: { ...(envelope.extensions ?? {}), codec: "msgpack" },
    };
    return msgpackEncode(tagged);
  }

  decode(data: Uint8Array): MyelinEnvelope {
    let parsed: unknown;
    try {
      parsed = msgpackDecode(data);
    } catch (err) {
      throw new Error(
        `MsgpackCodec.decode: invalid MessagePack (${err instanceof Error ? err.message : String(err)})`,
      );
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      const actual = parsed === null ? "null" : Array.isArray(parsed) ? "array" : typeof parsed;
      throw new Error("MsgpackCodec.decode: expected an envelope object, got " + actual);
    }
    return parsed as MyelinEnvelope;
  }
}

export const msgpackCodec = new MsgpackCodec();
