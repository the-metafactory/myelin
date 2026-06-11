import { wsconnect, credsAuthenticator } from "@nats-io/nats-core";
import type { NatsConnection, ConnectionOptions } from "@nats-io/nats-core";
import { BaseJetStreamTransport, type JetStreamTransportOptions } from "./jetstream-base";

/**
 * True for hostnames where plaintext traffic never leaves the machine:
 * `localhost`, the 127.0.0.0/8 IPv4 loopback block, and IPv6 `::1`
 * (with or without URL brackets — WHATWG URL keeps them in `hostname`).
 */
function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === "localhost" || h === "::1" || h === "[::1]" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

export interface WebSocketTransportOptions extends JetStreamTransportOptions {
  /**
   * WebSocket server URL(s). Scheme MUST be `wss://`; plaintext
   * `ws://` is accepted ONLY for loopback hosts (localhost,
   * 127.0.0.0/8, ::1) — enforced in the constructor, because
   * credentials would otherwise transit unencrypted. The NATS hub
   * must expose a WebSocket listener (`websocket {}` server config
   * block) — plain `nats://` TCP listeners do not speak this protocol.
   */
  servers: string | string[];
  name?: string;
  user?: string;
  pass?: string;
  /**
   * NKey/JWT credentials as INLINE `.creds` file CONTENT — not a path.
   *
   * Edge runtimes (Cloudflare Workers, Durable Objects, browsers) have
   * no filesystem, so this transport never reads files. Load the creds
   * from the platform's secret store (e.g. a Workers secret binding)
   * and pass the string through. When set, user/pass are ignored.
   */
  credsContent?: string;
  /**
   * Refuse to connect without credentials. Same contract as
   * `NATSTransportOptions.requireAuth` (myelin#136) minus the
   * file-path soft-fallback (there are no files here):
   * - `true` + neither `credsContent` nor `user`/`pass` set → throws
   *   on first connect attempt.
   * Default `false` for dev parity with `NATSTransport`.
   */
  requireAuth?: boolean;
  reconnect?: boolean;
  maxReconnectAttempts?: number;
}

/**
 * WebSocket NATS transport for runtimes without raw TCP — browsers,
 * Cloudflare Workers, and Durable Objects (myelin#188). Connects via
 * `wsconnect` from `@nats-io/nats-core`; everything above the
 * connection (JetStream publish/subscribe, durable consumers,
 * request/reply, envelope codecs, NAK handling) is the shared
 * `BaseJetStreamTransport` machinery — identical semantics to
 * `NATSTransport`.
 *
 * Edge notes:
 * - **Import via the edge-safe subpath on Workers/DO/browser:**
 *   `import { WebSocketTransport } from "@the-metafactory/myelin/transport/websocket"`.
 *   The package root and `./transport` barrels eagerly export
 *   `NATSTransport`/`createTransport`, which import
 *   `@nats-io/transport-node` + `node:fs`/`node:os` at module load —
 *   bundling those into a Worker fails or silently drags in Node
 *   polyfills. The subpath pulls only this file + the shared base.
 * - JetStream works over WS with the official client; durable
 *   consumers carry over unchanged.
 * - On Cloudflare, a **Durable Object** is the natural host for a
 *   persistent subscription: it can hold the WS connection open
 *   (hibernation API) while stateless Workers come and go.
 * - This file must stay free of Node-only APIs (`process`, `node:fs`,
 *   `node:os`) — that constraint is the reason it exists.
 *
 * Sovereignty: transport selection does not change envelope
 * classification semantics. Whether `classification: local` traffic
 * may transit an edge-hosted consumer at all is governed by the
 * sovereignty policy under discussion in the-metafactory/meta-factory#552.
 */
export class WebSocketTransport extends BaseJetStreamTransport {
  private readonly wsOptions: WebSocketTransportOptions;

  constructor(options: WebSocketTransportOptions) {
    super(options);
    const servers = Array.isArray(options.servers) ? options.servers : [options.servers];
    for (const server of servers) {
      let url: URL;
      try {
        url = new URL(server);
      } catch {
        throw new Error(`WebSocketTransport: invalid server URL "${server}"`);
      }
      // URL schemes are case-insensitive — compare the parsed,
      // lowercased protocol rather than regex-matching the raw string.
      const protocol = url.protocol.toLowerCase();
      if (protocol !== "ws:" && protocol !== "wss:") {
        throw new Error(
          `WebSocketTransport: server URL must use ws:// or wss:// scheme, got "${server}". ` +
            `For nats:// TCP servers use NATSTransport (createTransport({type: "nats"})).`,
        );
      }
      // Plaintext WS would carry user/pass or credsContent unencrypted —
      // permit it only where the bytes never leave the machine.
      if (protocol === "ws:" && !isLoopbackHost(url.hostname)) {
        throw new Error(
          `WebSocketTransport: plaintext ws:// is allowed only for localhost/loopback, ` +
            `got "${server}" — use wss:// so credentials are not sent unencrypted.`,
        );
      }
    }
    this.wsOptions = options;
  }

  protected async establishConnection(): Promise<NatsConnection> {
    const connectOpts: ConnectionOptions = this.buildConnectionOptions(this.wsOptions);

    const requireAuth = this.wsOptions.requireAuth ?? false;

    if (this.wsOptions.credsContent) {
      connectOpts.authenticator = credsAuthenticator(
        new TextEncoder().encode(this.wsOptions.credsContent),
      );
    } else if (this.wsOptions.user) {
      connectOpts.user = this.wsOptions.user;
      connectOpts.pass = this.wsOptions.pass;
    } else if (requireAuth) {
      throw new Error(
        `requireAuth=true but no NATS credentials configured ` +
          `(neither \`credsContent\` nor \`user\`/\`pass\` set in WebSocketTransportOptions)`,
      );
    }

    return wsconnect(connectOpts);
  }
}
