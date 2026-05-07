import { describe, it, expect } from "bun:test";
import { NATSTransport, type NATSTransportOptions } from "./nats";
import { createTransport } from "./factory";

describe("NATSTransport credentials support", () => {
  describe("type contract", () => {
    it("NATSTransportOptions accepts credentials field", () => {
      const opts: NATSTransportOptions = {
        servers: "nats://localhost:4222",
        credentials: "~/.config/nats/jc-pilot.creds",
      };
      expect(opts.credentials).toBe("~/.config/nats/jc-pilot.creds");
      expect(opts.user).toBeUndefined();
      expect(opts.pass).toBeUndefined();
    });

    it("credentials field is optional (backwards compat)", () => {
      const opts: NATSTransportOptions = {
        servers: "nats://localhost:4222",
        user: "test",
        pass: "secret",
      };
      expect(opts.credentials).toBeUndefined();
    });
  });

  describe("factory passthrough", () => {
    it("createTransport passes credentials to NATSTransport", () => {
      const transport = createTransport({
        type: "nats",
        servers: "nats://localhost:4222",
        credentials: "/tmp/test.creds",
      });
      expect(transport).toBeInstanceOf(NATSTransport);
    });
  });

  describe("ensureConnected behavior", () => {
    it("rejects with clear error when creds file does not exist", async () => {
      const transport = new NATSTransport({
        servers: "nats://localhost:4222",
        credentials: "/tmp/nonexistent-creds-file-12345.creds",
      });

      await expect(transport.publish("test.subject", {} as any)).rejects.toThrow(
        /Failed to read NATS credentials file.*nonexistent-creds-file-12345/,
      );
    });

    it("expands tilde in credentials path", async () => {
      const transport = new NATSTransport({
        servers: "nats://localhost:4222",
        credentials: "~/nonexistent-creds-test.creds",
      });

      // Should expand ~ to homedir in the error message
      try {
        await transport.publish("test.subject", {} as any);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).not.toContain("~/");
        expect((err as Error).message).toContain("nonexistent-creds-test.creds");
      }
    });
  });
});
