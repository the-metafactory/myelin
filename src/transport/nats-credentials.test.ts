import { describe, it, expect, spyOn } from "bun:test";
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

    it("NATSTransportOptions accepts requireAuth flag (myelin#136)", () => {
      const opts: NATSTransportOptions = {
        servers: "nats://localhost:4222",
        credentials: "~/.config/nats/agent.creds",
        requireAuth: true,
      };
      expect(opts.requireAuth).toBe(true);
    });

    it("requireAuth field is optional (default false preserves backwards compat)", () => {
      const opts: NATSTransportOptions = {
        servers: "nats://localhost:4222",
      };
      expect(opts.requireAuth).toBeUndefined();
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

    it("createTransport passes requireAuth to NATSTransport (myelin#136)", () => {
      const transport = createTransport({
        type: "nats",
        servers: "nats://localhost:4222",
        credentials: "/tmp/test.creds",
        requireAuth: true,
      });
      expect(transport).toBeInstanceOf(NATSTransport);
    });
  });

  describe("ensureConnected behavior — strict mode (requireAuth=true)", () => {
    it("rejects when creds file does not exist", async () => {
      const transport = new NATSTransport({
        servers: "nats://localhost:4222",
        credentials: "/tmp/nonexistent-creds-file-12345.creds",
        requireAuth: true,
      });

      await expect(transport.publish("test.subject", {} as any)).rejects.toThrow(
        /Failed to read NATS credentials file.*nonexistent-creds-file-12345/,
      );
    });

    it("expands tilde in credentials path in the error message", async () => {
      const transport = new NATSTransport({
        servers: "nats://localhost:4222",
        credentials: "~/nonexistent-creds-test.creds",
        requireAuth: true,
      });

      try {
        await transport.publish("test.subject", {} as any);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).not.toContain("~/");
        expect((err as Error).message).toContain("nonexistent-creds-test.creds");
      }
    });

    it("rejects when neither credentials nor user/pass is set", async () => {
      // myelin#136 — the primary failure surface cedar+sage's per-repo
      // `requireAuth` guards were designed to catch.
      const transport = new NATSTransport({
        servers: "nats://localhost:4222",
        requireAuth: true,
      });

      await expect(transport.publish("test.subject", {} as any)).rejects.toThrow(
        /requireAuth=true but no NATS credentials configured/,
      );
    });

    it("rejects when neither credentials nor user/pass is set, even with a user field unset", async () => {
      // Defensive: an empty-string `user` is also non-credentialled.
      const transport = new NATSTransport({
        servers: "nats://localhost:4222",
        user: undefined,
        pass: undefined,
        requireAuth: true,
      });

      await expect(transport.publish("test.subject", {} as any)).rejects.toThrow(
        /requireAuth=true but no NATS credentials configured/,
      );
    });
  });

  describe("ensureConnected behavior — soft mode (requireAuth=false default, myelin#136)", () => {
    it("warns and continues unauthenticated when creds file is missing", async () => {
      // The visibility matters in dev. Cedar logs this case in its per-repo
      // connectNats today — myelin preserves that semantics under the
      // default `requireAuth=false`.
      const warnSpy = spyOn(console, "warn").mockImplementation(() => undefined);
      try {
        const transport = new NATSTransport({
          // Use an unreachable server so the subsequent connect attempt
          // fails (no NATS running in unit tests), but with a DIFFERENT
          // error than the "Failed to read NATS credentials" path.
          servers: "nats://127.0.0.1:1", // RFC 6890 reserved + closed port
          credentials: "/tmp/nonexistent-creds-soft-12345.creds",
          // requireAuth omitted — defaults to false
          reconnect: false,
          maxReconnectAttempts: 0,
        });

        // ensureNc should NOT throw with "Failed to read NATS credentials";
        // it should warn-log + continue to connect(), which will fail with
        // a connection error (different surface).
        await expect(transport.publish("t", {} as any)).rejects.toThrow();
        await expect(transport.publish("t", {} as any)).rejects.not.toThrow(
          /Failed to read NATS credentials file/,
        );
        expect(warnSpy).toHaveBeenCalled();
        const warnArgs = warnSpy.mock.calls.flat().join(" ");
        expect(warnArgs).toContain("nonexistent-creds-soft-12345");
        expect(warnArgs).toContain("requireAuth=false");
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("connects unauthenticated silently when no credentials at all are configured", async () => {
      // No `credentials`, no `user`/`pass`, no `requireAuth` — matches the
      // pre-myelin#136 default behavior. Should not throw on auth resolution
      // (will still fail on the unreachable connect attempt).
      const transport = new NATSTransport({
        servers: "nats://127.0.0.1:1",
        reconnect: false,
        maxReconnectAttempts: 0,
      });

      // The throw, when it comes, must NOT be about credentials.
      await expect(transport.publish("t", {} as any)).rejects.not.toThrow(
        /requireAuth|Failed to read NATS credentials/,
      );
    });
  });
});
