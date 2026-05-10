import { describe, it, expect } from "bun:test";
import { JsonCodec, jsonCodec } from "./json";
import { detectCodec } from "./detect";
import { createCodecRegistry } from "./registry";
import type { Codec, CodecId } from "./types";
import type { MyelinEnvelope } from "../types";

const sampleEnvelope: MyelinEnvelope = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  source: "metafactory.cortex.dispatch",
  type: "tasks.code-review",
  timestamp: "2026-05-10T10:00:00Z",
  sovereignty: { classification: "local", data_residency: "CH", max_hop: 0, frontier_ok: false, model_class: "any" },
  payload: { prUrl: "https://example.com/pr/1" },
};

describe("JsonCodec", () => {
  it("round-trips a basic envelope", () => {
    const codec = new JsonCodec();
    const bytes = codec.encode(sampleEnvelope);
    const decoded = codec.decode(bytes);
    expect(decoded).toEqual(sampleEnvelope);
  });

  it("produces UTF-8 bytes that start with `{`", () => {
    const bytes = jsonCodec.encode(sampleEnvelope);
    expect(bytes[0]).toBe(0x7b);
  });

  it("does NOT mutate input envelope", () => {
    const before = JSON.stringify(sampleEnvelope);
    jsonCodec.encode(sampleEnvelope);
    expect(JSON.stringify(sampleEnvelope)).toBe(before);
  });

  it("does NOT set extensions.codec on encode (implicit JSON wire format)", () => {
    const codec = new JsonCodec();
    const bytes = codec.encode(sampleEnvelope);
    const decoded = codec.decode(bytes);
    expect(decoded.extensions).toBeUndefined();
  });

  it("throws on invalid JSON bytes", () => {
    const codec = new JsonCodec();
    expect(() => codec.decode(new TextEncoder().encode("{ broken"))).toThrow(/JsonCodec.decode: invalid JSON/);
  });

  it("throws when decoded value is not an object", () => {
    const codec = new JsonCodec();
    expect(() => codec.decode(new TextEncoder().encode("[1,2,3]"))).toThrow(/expected an envelope object/);
    expect(() => codec.decode(new TextEncoder().encode("42"))).toThrow(/expected an envelope object/);
    expect(() => codec.decode(new TextEncoder().encode("null"))).toThrow(/expected an envelope object/);
  });

  it("preserves nested payload structure", () => {
    const env: MyelinEnvelope = {
      ...sampleEnvelope,
      payload: { nested: { a: 1, b: [2, 3, { c: 4 }] } },
    };
    const decoded = jsonCodec.decode(jsonCodec.encode(env));
    expect(decoded.payload).toEqual(env.payload);
  });
});

describe("detectCodec", () => {
  function bytes(s: string): Uint8Array {
    return new TextEncoder().encode(s);
  }

  it("detects JSON from leading {", () => {
    expect(detectCodec(bytes('{"id": "abc"}'))).toBe("json");
  });

  it("skips leading whitespace before detecting JSON", () => {
    expect(detectCodec(bytes("  \n\t{\"x\":1}"))).toBe("json");
  });

  it("detects MessagePack fixmap header (0x80-0x8f)", () => {
    expect(detectCodec(new Uint8Array([0x80]))).toBe("msgpack");
    expect(detectCodec(new Uint8Array([0x85, 0xa2, 0x69, 0x64]))).toBe("msgpack");
    expect(detectCodec(new Uint8Array([0x8f]))).toBe("msgpack");
  });

  it("detects MessagePack map16 header (0xde) and map32 (0xdf)", () => {
    expect(detectCodec(new Uint8Array([0xde, 0x00, 0x10]))).toBe("msgpack");
    expect(detectCodec(new Uint8Array([0xdf, 0x00, 0x00, 0x10, 0x00]))).toBe("msgpack");
  });

  it("returns null on empty data", () => {
    expect(detectCodec(new Uint8Array())).toBeNull();
  });

  it("returns null on whitespace-only data", () => {
    expect(detectCodec(bytes("   "))).toBeNull();
  });

  it("returns null on ambiguous first byte", () => {
    // ASCII letter — neither JSON nor MessagePack-map header
    expect(detectCodec(new Uint8Array([0x41]))).toBeNull();
    // 0x90 is fixarray, not a map → not a valid envelope wire form
    expect(detectCodec(new Uint8Array([0x90]))).toBeNull();
  });

  it("does not confuse MessagePack 0x7b-anywhere with JSON", () => {
    // MessagePack fixmap with first key starting with 0x7b would have
    // header byte first, not the 0x7b byte. Confirm we look at first
    // non-whitespace byte only.
    expect(detectCodec(new Uint8Array([0x82, 0x7b]))).toBe("msgpack");
  });
});

describe("createCodecRegistry", () => {
  it("includes JsonCodec by default", () => {
    const registry = createCodecRegistry();
    expect(registry.list()).toContain("json");
    expect(registry.get("json")).toBeInstanceOf(JsonCodec);
  });

  it("can be created without defaults", () => {
    const registry = createCodecRegistry({ includeDefaults: false });
    expect(registry.list()).toEqual([]);
    expect(() => registry.get("json")).toThrow(/no codec registered/);
  });

  it("can register additional codecs", () => {
    const fakeMsgpack: Codec = {
      id: "msgpack",
      encode: () => new Uint8Array([0x80]),
      decode: () => sampleEnvelope,
    };
    const registry = createCodecRegistry({ codecs: [fakeMsgpack] });
    expect(registry.list().sort()).toEqual(["json", "msgpack"]);
    expect(registry.get("msgpack")).toBe(fakeMsgpack);
  });

  it("register() updates an existing codec id", () => {
    const registry = createCodecRegistry();
    const original = registry.get("json");
    const replacement: Codec = { id: "json", encode: () => new Uint8Array(), decode: () => sampleEnvelope };
    registry.register(replacement);
    expect(registry.get("json")).toBe(replacement);
    expect(registry.get("json")).not.toBe(original);
  });

  it("get() throws with helpful message listing registered codecs", () => {
    const registry = createCodecRegistry();
    expect(() => registry.get("msgpack" as CodecId)).toThrow(/registered: json/);
  });
});
