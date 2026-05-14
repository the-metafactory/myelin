import { connect, credsAuthenticator } from "@nats-io/transport-node";
import type { NatsConnection, ConnectionOptions } from "@nats-io/transport-node";
import { jetstream, jetstreamManager, JetStreamApiError, JetStreamApiCodes } from "@nats-io/jetstream";
import type { JetStreamClient, JetStreamManager, AckPolicy, DeliverPolicy } from "@nats-io/jetstream";
import type { MyelinEnvelope } from "../types";
import { nakWithReasonSync } from "./nak";
import type { Codec, CodecRegistry } from "../serialization";
import { jsonCodec, buildDefaultRegistry, detectCodec } from "../serialization";
import type {
  TransportPublisher,
  TransportSubscriber,
  SubscribeOptions,
  Subscription,
  RequestOptions,
} from "./types";
import { executeRequestReply, DEFAULT_REQUEST_TIMEOUT_MS } from "./request-reply";

export interface NATSTransportOptions {
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
  streamName?: string;
  /**
   * Outbound wire codec. Default: jsonCodec (backwards compatible —
   * existing JetStream streams expect JSON envelope bytes).
   *
   * Switch to MsgpackCodec for ~30-50% smaller payloads, but only
   * after subscribers can decode the new format. Inbound decode
   * uses detectCodec + codecRegistry, so JSON publishers and msgpack
   * publishers can coexist on a single stream during rollout.
   */
  codec?: Codec;
  /**
   * Inbound codec registry. When omitted and `codec` is set to a
   * non-JSON codec, a registry with [jsonCodec, codec] is auto-built
   * so subscribers accept both wire formats during a rolling migration.
   */
  codecRegistry?: CodecRegistry;
}

/**
 * Snapshot of a JetStream consumer's delivery + ack state, returned
 * by `NATSTransport.getConsumerHealth`. All counts are absolute
 * (cumulative) — sample twice and subtract to compute throughput
 * between observation windows. `pending` and `ackPending` are the
 * key early-warning signals for a stuck consumer.
 *
 * Structurally identical to `ConsumerHealthSnapshot` in
 * `src/observability/types.ts`. The duplication is intentional —
 * `src/transport` does not depend on `src/observability` (layering
 * rule), so each module owns its own type. Keep field sets in sync
 * when adding new health fields here.
 */
export interface ConsumerHealth {
  durableName: string;
  streamName: string;
  /** Messages on the stream not yet delivered to this consumer. */
  pending: number;
  /** Messages delivered but not yet acked (in-flight on this consumer). */
  ackPending: number;
  /**
   * In-flight redelivered count. JetStream's `num_redelivered` tracks
   * messages CURRENTLY pending that have been redelivered at least
   * once — once the retried message acks, it returns to 0. Use
   * `deliveredConsumerSeq` for a monotonic cumulative signal.
   */
  redelivered: number;
  /** Pending pull requests on this consumer. */
  waiting: number;
  /** Highest delivered consumer sequence (cumulative count). */
  deliveredConsumerSeq: number;
  /** Highest contiguous-acked consumer sequence. */
  ackFloorConsumerSeq: number;
}

/** JetStream storage backend selection. */
export type StreamStorage = "file" | "memory";

/** JetStream retention policy selection. */
export type StreamRetention = "limits" | "interest" | "workqueue";

/** JetStream discard policy selection when a `max_*` limit is hit. */
export type StreamDiscard = "old" | "new";

/**
 * Operator-facing knobs for `NATSTransport.ensureStream`. Each field maps
 * to the matching `jsm.streams.add` argument; defaults reflect what
 * `ensureStream` applies when a field is omitted.
 */
export interface EnsureStreamConfig {
  /** Max total bytes the stream retains. Default: 512 MiB. */
  maxBytes?: number;
  /** Max age in nanoseconds. Default: 7 days. */
  maxAge?: number;
  /** JetStream storage backend. Default: `"file"`. */
  storage?: StreamStorage;
  /** JetStream retention policy. Default: `"limits"`. */
  retention?: StreamRetention;
  /** JetStream replica count. Default: `1` (production typically `3`). */
  numReplicas?: number;
  /**
   * JetStream discard policy when the stream hits a `max_*` limit.
   *
   * - `"old"` (default) — drop the oldest message to make room. Right for
   *   append-only event streams where the new publish must succeed.
   * - `"new"` — reject the new publish. Right for audit logs where stale
   *   data is preferable to silently losing history older than the
   *   retention window suggests, and for command / request streams where
   *   the producer needs the publish-error signal to drive its retry path.
   */
  discard?: StreamDiscard;
}

export class NATSTransport implements TransportPublisher, TransportSubscriber {
  private nc: NatsConnection | null = null;
  private js: JetStreamClient | null = null;
  private jsm: JetStreamManager | null = null;
  private options: NATSTransportOptions;
  private readonly codec: Codec;
  private readonly codecRegistry: CodecRegistry;

  constructor(options: NATSTransportOptions) {
    this.options = options;
    this.codec = options.codec ?? jsonCodec;
    this.codecRegistry = options.codecRegistry ?? buildDefaultRegistry(this.codec);
  }

  private decodeEnvelope(data: Uint8Array): MyelinEnvelope {
    const detected = detectCodec(data) ?? this.codec.id;
    return this.codecRegistry.get(detected).decode(data);
  }

  private async ensureNc(): Promise<NatsConnection> {
    if (this.nc) return this.nc;

    const connectOpts: ConnectionOptions = {
      servers: this.options.servers,
      name: this.options.name ?? "myelin",
      reconnect: this.options.reconnect ?? true,
      maxReconnectAttempts: this.options.maxReconnectAttempts ?? -1,
    };

    const requireAuth = this.options.requireAuth ?? false;

    if (this.options.credentials) {
      const { readFile } = await import("node:fs/promises");
      const { homedir } = await import("node:os");
      let credsPath = this.options.credentials;
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
    } else if (this.options.user) {
      connectOpts.user = this.options.user;
      connectOpts.pass = this.options.pass;
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

    this.nc = await connect(connectOpts);
    return this.nc;
  }

  private async ensureConnected(): Promise<{
    nc: NatsConnection;
    js: JetStreamClient;
    jsm: JetStreamManager;
  }> {
    const nc = await this.ensureNc();
    if (this.js && this.jsm) return { nc, js: this.js, jsm: this.jsm };

    this.js = jetstream(nc);
    this.jsm = await jetstreamManager(nc);

    return { nc, js: this.js, jsm: this.jsm };
  }

  /**
   * Publish an envelope to `subject`.
   *
   * Routing — JetStream by default, core-NATS for `_INBOX.*`:
   * - For `_INBOX.{id}` subjects, the publish is sent via core NATS
   *   (`nc.publish`) and intentionally BYPASSES JetStream. These
   *   subjects are request/reply reply mailboxes (see
   *   `executeRequestReply` in `./request-reply.ts`) — short-lived,
   *   point-to-point, and consumed by a `nc.subscribe(inbox)` mailbox
   *   that lives only for the duration of one request. Persisting
   *   them in a stream would be pure overhead and would also break
   *   the reply-latency measurement the request path uses.
   * - Every other subject goes through JetStream (`js.publish`) so
   *   the message lands on the durable stream the consumers pull
   *   from. This is the standard at-least-once publish path.
   *
   * Returns once the publish has been handed off — for JetStream
   * that means the broker acked the store; for `_INBOX.*` that
   * means the bytes were buffered for send.
   */
  async publish(subject: string, envelope: MyelinEnvelope): Promise<void> {
    const payload = this.codec.encode(envelope);
    if (subject.startsWith("_INBOX.")) {
      const nc = await this.ensureNc();
      nc.publish(subject, payload);
      return;
    }
    const { js } = await this.ensureConnected();
    await js.publish(subject, payload);
  }

  async request(
    subject: string,
    envelope: MyelinEnvelope,
    options?: RequestOptions,
  ): Promise<MyelinEnvelope> {
    const nc = await this.ensureNc();
    const codec = this.codec;
    const decode = this.decodeEnvelope.bind(this);

    return executeRequestReply(
      subject,
      envelope,
      options?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      {
        subscribe: async (inbox, onMessage) => {
          const sub = nc.subscribe(inbox);
          (async () => {
            for await (const msg of sub) {
              try {
                onMessage(decode(msg.data));
              } catch (err) {
                process.stderr.write(
                  `myelin-nats: inbox decode error on ${inbox}: ${err instanceof Error ? err.message : String(err)}\n`,
                );
              }
            }
          // Fire-and-forget IIFE — inner loop already logs decode errors;
          // the outer .catch swallows iterator-shutdown rejections.
          // eslint-disable-next-line @typescript-eslint/no-empty-function
          })().catch(() => {});
          // Ensure the NATS server has processed the SUBSCRIBE before we publish the request.
          await nc.flush();
          return { unsubscribe: () => { sub.unsubscribe(); } };
        },
        // NATS core publish is synchronous — see
        // `RequestReplyPrimitives.publish` for the `void | Promise<void>`
        // rationale. The inbox-bypass path is intentional here too: we
        // publish directly to `subj` without going through JetStream
        // because the inbox subscription on `nc.subscribe(inbox)` is a
        // core-NATS reply mailbox, not a JetStream stream.
        publish: (subj, env) => { nc.publish(subj, codec.encode(env)); },
      },
    );
  }

  get streamName(): string {
    if (!this.options.streamName) {
      throw new Error("NATSTransport: streamName is required — set it in options or call ensureStream explicitly");
    }
    return this.options.streamName;
  }

  private async ensureConsumer(
    durableName: string,
    filterSubject: string,
    deliverPolicy: DeliverPolicy = "new",
    ackPolicy: AckPolicy = "explicit",
  ): Promise<void> {
    const { jsm, js } = await this.ensureConnected();
    try {
      const existing = await js.consumers.get(this.streamName, durableName);
      const info = await existing.info();
      if (info.config.filter_subject !== filterSubject) {
        await jsm.consumers.update(this.streamName, durableName, {
          filter_subject: filterSubject,
        });
      }
    } catch {
      await jsm.consumers.add(this.streamName, {
        durable_name: durableName,
        filter_subject: filterSubject,
        ack_policy: ackPolicy,
        deliver_policy: deliverPolicy,
      });
    }
  }

  async subscribe(
    subject: string,
    handler: (envelope: MyelinEnvelope) => Promise<void>,
    options?: SubscribeOptions,
  ): Promise<Subscription> {
    if (!options?.durableName) {
      return this.subscribeBestEffort(subject, handler);
    }

    const { js } = await this.ensureConnected();

    await this.ensureConsumer(
      options.durableName,
      subject,
      options.deliverPolicy ?? "new",
      options.ackPolicy ?? "explicit",
    );

    const consumer = await js.consumers.get(this.streamName, options.durableName);
    const messages = await consumer.consume();
    let running = true;

    const consumeLoop = (async () => {
      for await (const msg of messages) {
        // `running` is flipped to false by the unsubscribe closure
        // below — ESLint's narrow can't see the mutation across the
        // closure boundary, so it thinks `!running` is always falsy.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (!running) break;
        try {
          const envelope: MyelinEnvelope = this.decodeEnvelope(msg.data);
          await handler(envelope);
          msg.ack();
        } catch (err) {
          nakWithReasonSync(msg, {
            reason: "cant-do",
            description: err instanceof Error ? err.message : String(err),
          });
          process.stderr.write(
            `myelin-nats: handler error on ${subject}: ${err instanceof Error ? err.message : String(err)}\n`,
          );
        }
      }
    })();

    consumeLoop.catch((err: unknown) => {
      if (running) {
        process.stderr.write(
          `myelin-nats: consume loop error on ${subject}: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
    });

    return {
      // Async signature required by the Subscription interface.
      // eslint-disable-next-line @typescript-eslint/require-await
      unsubscribe: async () => {
        running = false;
        messages.stop();
      },
    };
  }

  async subscribeBestEffort(
    subject: string,
    handler: (envelope: MyelinEnvelope) => Promise<void>,
  ): Promise<Subscription> {
    const nc = await this.ensureNc();
    const sub = nc.subscribe(subject);
    let running = true;

    const consumeLoop = (async () => {
      for await (const msg of sub) {
        // Same closure-mutation pattern as above — `running` is
        // flipped by the unsubscribe closure; lint can't see it.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (!running) break;
        try {
          const envelope: MyelinEnvelope = this.decodeEnvelope(msg.data);
          await handler(envelope);
        } catch (err) {
          process.stderr.write(
            `myelin-nats: best-effort handler error on ${subject}: ${err instanceof Error ? err.message : String(err)}\n`,
          );
        }
      }
    })();

    consumeLoop.catch((err: unknown) => {
      if (running) {
        process.stderr.write(
          `myelin-nats: best-effort loop error on ${subject}: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
    });

    return {
      // Async signature required by the Subscription interface.
      // eslint-disable-next-line @typescript-eslint/require-await
      unsubscribe: async () => {
        running = false;
        sub.unsubscribe();
      },
    };
  }

  async consumeOnce(
    subject: string,
    filter: (envelope: MyelinEnvelope) => boolean,
    options: { durableName: string; deliverPolicy?: string; timeoutMs?: number },
  ): Promise<MyelinEnvelope | null> {
    const { js } = await this.ensureConnected();

    await this.ensureConsumer(
      options.durableName,
      subject,
      (options.deliverPolicy ?? "all") as DeliverPolicy,
    );

    const consumer = await js.consumers.get(this.streamName, options.durableName);
    const messages = await consumer.consume();

    return new Promise((resolve) => {
      const timeout = options.timeoutMs
        ? setTimeout(() => { messages.stop(); resolve(null); }, options.timeoutMs)
        : null;

      const consumeLoop = (async () => {
        for await (const msg of messages) {
          try {
            const envelope: MyelinEnvelope = this.decodeEnvelope(msg.data);
            if (filter(envelope)) {
              msg.ack();
              if (timeout) clearTimeout(timeout);
              messages.stop();
              resolve(envelope);
              return;
            }
            msg.ack();
          } catch {
            msg.ack();
          }
        }
        resolve(null);
      })();

      consumeLoop.catch(() => { resolve(null); });
    });
  }

  /**
   * Snapshot the JetStream consumer state for a durable subscription.
   * Returns the counts an operator needs to detect a stuck or lagging
   * consumer — `pending` (messages not yet delivered) and `ackPending`
   * (delivered but unacked) are the two early-warning signals.
   *
   * Returns null when the consumer does not exist (e.g. the durable
   * name was never bound, or has since been deleted) so observability
   * callers can soft-skip without try/catching. Other I/O errors
   * propagate.
   */
  async getConsumerHealth(durableName: string): Promise<ConsumerHealth | null> {
    const { js } = await this.ensureConnected();
    let consumer: Awaited<ReturnType<typeof js.consumers.get>>;
    try {
      consumer = await js.consumers.get(this.streamName, durableName);
    } catch (err) {
      // Discriminate "doesn't exist" (return null) from "couldn't ask"
      // (propagate). A network timeout / auth failure / connection
      // reset returning null would silently zero observability counts
      // and look like an idle consumer instead of a broker outage.
      if (
        err instanceof JetStreamApiError &&
        (err.code === JetStreamApiCodes.ConsumerNotFound ||
          err.code === JetStreamApiCodes.StreamNotFound)
      ) {
        return null;
      }
      throw err;
    }
    const info = await consumer.info();
    return {
      durableName,
      streamName: this.streamName,
      // JetStream consumer info uses snake_case field names; surface them
      // as camelCase TS conventions here. delivered.consumer_seq is the
      // total delivered count (monotonically increasing); we expose
      // both that and `ackFloorConsumer` so operators can compute
      // throughput between samples.
      pending: info.num_pending,
      ackPending: info.num_ack_pending,
      redelivered: info.num_redelivered,
      waiting: info.num_waiting,
      deliveredConsumerSeq: info.delivered.consumer_seq,
      ackFloorConsumerSeq: info.ack_floor.consumer_seq,
    };
  }

  async deleteStream(streamName: string): Promise<boolean> {
    const { jsm } = await this.ensureConnected();
    try {
      await jsm.streams.delete(streamName);
      return true;
    } catch {
      return false;
    }
  }

  async ensureStream(
    streamName: string,
    subjects: string[],
    config?: EnsureStreamConfig,
  ): Promise<void> {
    const { jsm } = await this.ensureConnected();

    try {
      await jsm.streams.info(streamName);
    } catch {
      await jsm.streams.add({
        name: streamName,
        subjects,
        retention: (config?.retention ?? "limits"),
        max_bytes: config?.maxBytes ?? 512 * 1024 * 1024,
        max_age: config?.maxAge ?? 7 * 24 * 60 * 60 * 1e9,
        storage: (config?.storage ?? "file"),
        discard: (config?.discard ?? "old"),
        num_replicas: config?.numReplicas ?? 1,
      });
    }
  }

  /**
   * Ensure the TASKS_DEAD JetStream stream exists. Per F-4 spec:
   *   - subjects: local.*.tasks.dead-letter.>, federated.*.tasks.dead-letter.>
   *   - retention: limits, 30 days (vs 7d on TASKS — longer for audit / operator review)
   *   - storage: file (durable)
   *   - num_replicas: 3 production / 1 dev (caller passes via opts)
   *
   * Idempotent — re-running against an existing stream is a no-op.
   */
  async ensureDeadLetterStream(opts?: { numReplicas?: number }): Promise<void> {
    await this.ensureStream(
      "TASKS_DEAD",
      ["local.*.tasks.dead-letter.>", "federated.*.tasks.dead-letter.>"],
      {
        retention: "limits",
        maxAge: 30 * 24 * 60 * 60 * 1e9,
        storage: "file",
        numReplicas: opts?.numReplicas ?? 1,
      },
    );
  }

  async close(): Promise<void> {
    if (this.nc) {
      await this.nc.drain();
      this.nc = null;
      this.js = null;
      this.jsm = null;
    }
  }
}
