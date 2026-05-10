import { describe, it, expect } from "bun:test";
import { NATSTransport, type NATSTransportOptions } from "./nats";
import { JsonCodec, MsgpackCodec, jsonCodec, createCodecRegistry } from "../serialization";

describe("NATSTransport codec option", () => {
  describe("type contract", () => {
    it("NATSTransportOptions accepts codec field", () => {
      const opts: NATSTransportOptions = {
        servers: "nats://localhost:4222",
        codec: new MsgpackCodec(),
      };
      expect(opts.codec?.id).toBe("msgpack");
    });

    it("codec field is optional (defaults to JSON)", () => {
      const opts: NATSTransportOptions = {
        servers: "nats://localhost:4222",
      };
      expect(opts.codec).toBeUndefined();
    });

    it("NATSTransportOptions accepts codecRegistry field", () => {
      const registry = createCodecRegistry({ codecs: [new MsgpackCodec()] });
      const opts: NATSTransportOptions = {
        servers: "nats://localhost:4222",
        codec: new MsgpackCodec(),
        codecRegistry: registry,
      };
      expect(opts.codecRegistry?.list().sort()).toEqual(["json", "msgpack"]);
    });
  });

  describe("constructor", () => {
    it("constructs with no codec (default JSON)", () => {
      const t = new NATSTransport({ servers: "nats://localhost:4222" });
      expect(t).toBeInstanceOf(NATSTransport);
    });

    it("constructs with msgpack codec", () => {
      const t = new NATSTransport({
        servers: "nats://localhost:4222",
        codec: new MsgpackCodec(),
      });
      expect(t).toBeInstanceOf(NATSTransport);
    });

    it("constructs with explicit JSON codec", () => {
      const t = new NATSTransport({
        servers: "nats://localhost:4222",
        codec: jsonCodec,
      });
      expect(t).toBeInstanceOf(NATSTransport);
    });

    it("constructs with explicit codecRegistry override", () => {
      const t = new NATSTransport({
        servers: "nats://localhost:4222",
        codec: new MsgpackCodec(),
        codecRegistry: createCodecRegistry({
          codecs: [new JsonCodec(), new MsgpackCodec()],
        }),
      });
      expect(t).toBeInstanceOf(NATSTransport);
    });
  });
});
