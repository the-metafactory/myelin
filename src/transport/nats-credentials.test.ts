import { describe, it, expect } from "bun:test";
import { NATSTransport, type NATSTransportOptions } from "./nats";
import { createTransport } from "./factory";

describe("NATSTransport credentials support", () => {
  it("accepts credentials option in constructor", () => {
    const transport = new NATSTransport({
      servers: "nats://localhost:4222",
      credentials: "/tmp/test-bot.creds",
    });
    expect(transport).toBeInstanceOf(NATSTransport);
  });

  it("accepts credentials alongside servers and name", () => {
    const transport = new NATSTransport({
      servers: "nats://localhost:4222",
      name: "test-bot",
      credentials: "/tmp/test-bot.creds",
      streamName: "TEST_STREAM",
    });
    expect(transport).toBeInstanceOf(NATSTransport);
  });

  it("accepts user/pass without credentials (backwards compat)", () => {
    const transport = new NATSTransport({
      servers: "nats://localhost:4222",
      user: "test",
      pass: "secret",
    });
    expect(transport).toBeInstanceOf(NATSTransport);
  });

  it("type allows credentials field", () => {
    const opts: NATSTransportOptions = {
      servers: "nats://localhost:4222",
      credentials: "~/.config/nats/jc-pilot.creds",
    };
    expect(opts.credentials).toBe("~/.config/nats/jc-pilot.creds");
  });

  it("factory passes credentials through to NATSTransport", () => {
    const transport = createTransport({
      type: "nats",
      servers: "nats://localhost:4222",
      credentials: "/tmp/test.creds",
    });
    expect(transport).toBeInstanceOf(NATSTransport);
  });
});
