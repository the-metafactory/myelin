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

  it("exhaustive check rejects unknown type at compile time", () => {
    // This is a compile-time check. If a new variant is added to TransportConfig
    // but not handled in the switch, TypeScript will error on the never assignment.
    // We verify the runtime path throws for safety.
    expect(() =>
      createTransport({ type: "unknown" } as unknown as TransportConfig),
    ).toThrow();
  });
});
