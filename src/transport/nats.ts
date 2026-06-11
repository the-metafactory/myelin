import { connect, credsAuthenticator } from "@nats-io/transport-node";
import type { NatsConnection, ConnectionOptions } from "@nats-io/transport-node";
import { BaseJetStreamTransport, type JetStreamTransportOptions } from "./jetstream-base";

// Shared JetStream types historically exported from this module — re-exported
// from the base so existing `from "./nats"` / package-root imports keep working.
export type {
  ConsumerHealth,
  EnsureStreamConfig,
  StreamStorage,
  StreamRetention,
  StreamDiscard,
} from "./jetstream-base";

export interface NATSTransportOptions extends JetStreamTransportOptions {
  servers: string | string[];
  name?: string;
  user?: string;
  pass?: string;
  /** Path to NKey/JWT .creds file. When set, user/pass are ignored. */
  credentials?: string;
  /**
   * Refuse to connect without a usable credentials file (myelin#136).
   *
   * Default `false` for dev compatibility — the transport falls back to
   * an unauthenticated connection when credentials are unset, and warns
   * but still connects unauthenticated when credentials are set but the
   * file is missing/unreadable.
   *
   * Set `true` in production to fail-fast on a misconfigured deployment:
   * - `credentials` unset → throws on first connect attempt
   * - `credentials` set but file missing/unreadable → throws with the
   *   underlying ENOENT/EACCES detail
   *
   * Operators typically wire this to an env var like
   * `AGENT_REQUIRE_NATS_AUTH` — the cedar (`CEDAR_REQUIRE_NATS_AUTH`)
   * and sage (`SAGE_REQUIRE_NATS_AUTH`) per-repo guards are being
   * replaced by this flag.
   */
  requireAuth?: boolean;
  reconnect?: boolean;
  maxReconnectAttempts?: number;
}

/**
 * Raw-TCP NATS transport for Node/Bun runtimes, via
 * `@nats-io/transport-node`. All JetStream/envelope machinery lives in
 * `BaseJetStreamTransport` (shared with `WebSocketTransport`, myelin#188);
 * this class owns only connection establishment and filesystem-based
 * credential loading — the two pieces that cannot run on edge runtimes.
 */
export class NATSTransport extends BaseJetStreamTransport {
  private readonly natsOptions: NATSTransportOptions;

  constructor(options: NATSTransportOptions) {
    super(options);
    this.natsOptions = options;
  }

  /**
   * Preserve the historical byte-exact stderr behavior of this transport
   * (the base defaults to `console.error` for edge portability).
   */
  protected override logError(message: string): void {
    process.stderr.write(`${message}\n`);
  }

  protected async establishConnection(): Promise<NatsConnection> {
    const connectOpts: ConnectionOptions = this.buildConnectionOptions(this.natsOptions);

    const requireAuth = this.natsOptions.requireAuth ?? false;

    if (this.natsOptions.credentials) {
      const { readFile } = await import("node:fs/promises");
      const { homedir } = await import("node:os");
      let credsPath = this.natsOptions.credentials;
      if (credsPath.startsWith("~/")) {
        credsPath = `${homedir()}${credsPath.slice(1)}`;
      }
      let credsContent: Buffer | null = null;
      try {
        credsContent = await readFile(credsPath);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        if (requireAuth) {
          // Strict mode: missing creds file is a deploy misconfiguration.
          throw new Error(
            `Failed to read NATS credentials file: ${credsPath} — ${detail}`,
            { cause: err },
          );
        }
        // Soft mode (myelin#136): warn and continue unauthenticated. Cedar
        // and sage both relied on this for dev: an absent creds file at
        // a documented path is a signal that the operator is running
        // without auth, not a hard failure.
        console.warn(
          `[myelin] NATS credentials file not readable (${credsPath}): ${detail}. ` +
            `Continuing unauthenticated because requireAuth=false. ` +
            `Set requireAuth=true to fail-fast in production.`,
        );
      }
      if (credsContent !== null) {
        connectOpts.authenticator = credsAuthenticator(credsContent);
      }
    } else if (this.natsOptions.user) {
      connectOpts.user = this.natsOptions.user;
      connectOpts.pass = this.natsOptions.pass;
    } else if (requireAuth) {
      // Strict mode + no credentials configured at all: refuse to connect.
      // This is the primary failure surface cedar+sage's per-repo
      // `requireAuth` guards were designed to catch — a deployment shipping
      // without ever wiring credentials through configuration.
      throw new Error(
        `requireAuth=true but no NATS credentials configured ` +
          `(neither \`credentials\` nor \`user\`/\`pass\` set in NATSTransportOptions)`,
      );
    }

    return connect(connectOpts);
  }
}
