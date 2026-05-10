import { describe, it, expect } from "bun:test";
import { MsgpackCodec, msgpackCodec } from "./msgpack";
import { JsonCodec } from "./json";
import { detectCodec } from "./detect";
import type { MyelinEnvelope } from "../types";

const sampleEnvelope: MyelinEnvelope = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  source: "metafactory.cortex.dispatch",
  type: "tasks.code-review",
  timestamp: "2026-05-10T10:00:00Z",
  sovereignty: { classification: "local", data_residency: "CH", max_hop: 0, frontier_ok: false, model_class: "any" },
  payload: { prUrl: "https://example.com/pr/1" },
};

describe("MsgpackCodec", () => {
  it("round-trips a basic envelope (with codec extension)", () => {
    const codec = new MsgpackCodec();
    const bytes = codec.encode(sampleEnvelope);
    const decoded = codec.decode(bytes);
    expect(decoded).toEqual({
      ...sampleEnvelope,
      extensions: { codec: "msgpack" },
    });
  });

  it("sets extensions.codec='msgpack' on encode", () => {
    const decoded = msgpackCodec.decode(msgpackCodec.encode(sampleEnvelope));
    expect(decoded.extensions?.codec).toBe("msgpack");
  });

  it("preserves caller-provided extensions and adds codec", () => {
    const env: MyelinEnvelope = {
      ...sampleEnvelope,
      extensions: { trace: "abc-123" },
    };
    const decoded = msgpackCodec.decode(msgpackCodec.encode(env));
    expect(decoded.extensions).toEqual({ trace: "abc-123", codec: "msgpack" });
  });

  it("does NOT mutate input envelope", () => {
    const env: MyelinEnvelope = { ...sampleEnvelope, extensions: { trace: "x" } };
    const before = JSON.stringify(env);
    msgpackCodec.encode(env);
    expect(JSON.stringify(env)).toBe(before);
  });

  it("produces fewer bytes than JSON for typical envelope", () => {
    const json = new JsonCodec().encode(sampleEnvelope);
    const msgpack = msgpackCodec.encode(sampleEnvelope);
    expect(msgpack.byteLength).toBeLessThan(json.byteLength);
  });

  it("first byte is a MessagePack map header (detectable)", () => {
    const bytes = msgpackCodec.encode(sampleEnvelope);
    expect(detectCodec(bytes)).toBe("msgpack");
  });

  it("preserves nested payload structures (objects, arrays, mixed types)", () => {
    const env: MyelinEnvelope = {
      ...sampleEnvelope,
      payload: {
        nested: { a: 1, b: [2, 3, { c: 4 }] },
        bool: true,
        nullField: null,
        big: 9_007_199_254_740_991,
        str: "unicode 🦠 ✓",
      },
    };
    const decoded = msgpackCodec.decode(msgpackCodec.encode(env));
    expect(decoded.payload).toEqual(env.payload);
  });

  it("throws on malformed MessagePack bytes", () => {
    const codec = new MsgpackCodec();
    expect(() => codec.decode(new Uint8Array([0xc1]))).toThrow(/MsgpackCodec.decode: invalid MessagePack/);
  });

  it("throws when decoded value is not an object", () => {
    const codec = new MsgpackCodec();
    expect(() => codec.decode(new Uint8Array([0x91, 0x01]))).toThrow(/expected an envelope object/);
    expect(() => codec.decode(new Uint8Array([0x2a]))).toThrow(/expected an envelope object/);
    expect(() => codec.decode(new Uint8Array([0xc0]))).toThrow(/expected an envelope object/);
  });
});
