import { describe, it, expect } from "bun:test";
import { WebSocketTransport } from "./websocket";
import { BaseJetStreamTransport } from "./jetstream-base";
import { NATSTransport } from "./nats";
import { createTransport } from "./factory";

describe("WebSocketTransport", () => {
  describe("construction + factory", () => {
    it("factory returns WebSocketTransport for type 'ws'", () => {
      const transport = createTransport({
        type: "ws",
        servers: "wss://hub.example.com:443",
      });
      expect(transport).toBeInstanceOf(WebSocketTransport);
    });

    it("shares the JetStream machinery base with NATSTransport", () => {
      const ws = new WebSocketTransport({ servers: "ws://localhost:8080" });
      const nats = new NATSTransport({ servers: "nats://localhost:4222" });
      expect(ws).toBeInstanceOf(BaseJetStreamTransport);
      expect(nats).toBeInstanceOf(BaseJetStreamTransport);
    });
  });

  describe("server URL scheme validation", () => {
    it("accepts ws:// URLs on loopback hosts", () => {
      expect(() => new WebSocketTransport({ servers: "ws://localhost:8080" })).not.toThrow();
      expect(() => new WebSocketTransport({ servers: "ws://127.0.0.1:8080" })).not.toThrow();
      expect(() => new WebSocketTransport({ servers: "ws://[::1]:8080" })).not.toThrow();
    });

    it("accepts wss:// URLs", () => {
      expect(() => new WebSocketTransport({ servers: "wss://hub.example.com" })).not.toThrow();
    });

    it("accepts uppercase schemes (URL schemes are case-insensitive)", () => {
      expect(() => new WebSocketTransport({ servers: "WSS://hub.example.com" })).not.toThrow();
      expect(() => new WebSocketTransport({ servers: "WS://localhost:8080" })).not.toThrow();
    });

    it("accepts a list of wss + loopback-ws URLs", () => {
      expect(
        () =>
          new WebSocketTransport({
            servers: ["wss://hub-a.example.com", "ws://localhost:8080"],
          }),
      ).not.toThrow();
    });

    it("rejects plaintext ws:// off loopback (credentials would transit unencrypted)", () => {
      expect(() => new WebSocketTransport({ servers: "ws://hub.example.com:8080" })).toThrow(
        /plaintext ws:\/\/ is allowed only for localhost\/loopback/,
      );
    });

    it("rejects nats:// URLs with a pointer to NATSTransport", () => {
      expect(() => new WebSocketTransport({ servers: "nats://localhost:4222" })).toThrow(
        /ws:\/\/ or wss:\/\/.*NATSTransport/,
      );
    });

    it("rejects unparseable server URLs", () => {
      expect(() => new WebSocketTransport({ servers: "not a url" })).toThrow(/invalid server URL/);
    });

    it("rejects a mixed list containing a non-ws URL", () => {
      expect(
        () =>
          new WebSocketTransport({
            servers: ["wss://hub.example.com", "nats://localhost:4222"],
          }),
      ).toThrow(/nats:\/\/localhost:4222/);
    });
  });

  describe("legacy error-text preservation", () => {
    it("NATSTransport streamName error keeps its historical prefix", () => {
      const nats = new NATSTransport({ servers: "nats://localhost:4222" });
      expect(() => nats.streamName).toThrow(/^NATSTransport: streamName is required/);
    });

    it("WebSocketTransport streamName error names its own class", () => {
      const ws = new WebSocketTransport({ servers: "wss://hub.example.com" });
      expect(() => ws.streamName).toThrow(/^WebSocketTransport: streamName is required/);
    });
  });

  describe("requireAuth contract", () => {
    it("requireAuth=true with no credentials rejects before any connect", async () => {
      const transport = new WebSocketTransport({
        servers: "wss://hub.example.com",
        requireAuth: true,
      });
      // publish() lazily establishes the connection; the auth guard must
      // fire first — no network I/O is attempted for this expectation.
      await expect(
        transport.publish("_INBOX.test", { id: "x" } as never),
      ).rejects.toThrow(/requireAuth=true but no NATS credentials configured/);
    });

    it("requireAuth=true with user/pass passes the guard (fails later on dial, not auth config)", async () => {
      const transport = new WebSocketTransport({
        servers: "ws://127.0.0.1:1", // nothing listens here — dial fails fast
        requireAuth: true,
        user: "u",
        pass: "p",
        reconnect: false,
        maxReconnectAttempts: 0,
      });
      await expect(
        transport.publish("_INBOX.test", { id: "x" } as never),
      ).rejects.not.toThrow(/requireAuth=true but no NATS credentials configured/);
    });

    it("requireAuth=true with inline credsContent passes the guard", async () => {
      // Malformed creds make credsAuthenticator/connect fail — but the
      // requireAuth guard must NOT be the error source.
      const transport = new WebSocketTransport({
        servers: "ws://127.0.0.1:1",
        requireAuth: true,
        credsContent: "-----BEGIN NATS USER JWT-----\nnot-a-real-jwt\n------END NATS USER JWT------\n",
        reconnect: false,
        maxReconnectAttempts: 0,
      });
      await expect(
        transport.publish("_INBOX.test", { id: "x" } as never),
      ).rejects.not.toThrow(/requireAuth=true but no NATS credentials configured/);
    });
  });

  describe("edge portability", () => {
    // Strip comments so JSDoc PROSE mentioning Node APIs doesn't trip the
    // probe — only actual code references count.
    const stripComments = (source: string): string =>
      source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    // The full module graph behind the `./transport/websocket` subpath
    // export — every file here is bundled into edge consumers.
    it.each(["./websocket.ts", "./jetstream-base.ts", "./nak.ts", "./request-reply.ts", "./types.ts"])(
      "%s has no Node-only code references (transport-node, node:fs, node:os, process.*)",
      async (file) => {
        const source = stripComments(await Bun.file(new URL(file, import.meta.url)).text());
        expect(source).not.toContain("@nats-io/transport-node");
        expect(source).not.toContain("node:fs");
        expect(source).not.toContain("node:os");
        expect(source).not.toMatch(/\bprocess\./);
      },
    );
  });
});
