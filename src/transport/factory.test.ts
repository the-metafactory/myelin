import { describe, it, expect } from "bun:test";
import { createTransport, type TransportConfig } from "./factory";
import { NATSTransport } from "./nats";
import { InMemoryTransport } from "./in-memory";

describe("createTransport", () => {
  it("returns InMemoryTransport for type 'memory'", () => {
    const transport = createTransport({ type: "memory" });
    expect(transport).toBeInstanceOf(InMemoryTransport);
  });

  it("returns NATSTransport for type 'nats'", () => {
    const transport = createTransport({
      type: "nats",
      servers: "nats://localhost:4222",
    });
    expect(transport).toBeInstanceOf(NATSTransport);
  });

  it("throws at runtime for unknown type", () => {
    expect(() =>
      createTransport({ type: "unknown" } as unknown as TransportConfig),
    ).toThrow();
  });
});
