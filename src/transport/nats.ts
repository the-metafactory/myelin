import { connect, credsAuthenticator } from "@nats-io/transport-node";
import type { NatsConnection, ConnectionOptions } from "@nats-io/transport-node";
import { jetstream, jetstreamManager } from "@nats-io/jetstream";
import type { JetStreamClient, JetStreamManager } from "@nats-io/jetstream";
import type { MyelinEnvelope } from "../types";
import type {
  TransportPublisher,
  TransportSubscriber,
  SubscribeOptions,
  Subscription,
} from "./types";

export interface NATSTransportOptions {
  servers: string | string[];
  name?: string;
  user?: string;
  pass?: string;
  /** Path to NKey/JWT .creds file. When set, user/pass are ignored. */
  credentials?: string;
  reconnect?: boolean;
  maxReconnectAttempts?: number;
  streamName?: string;
}

export class NATSTransport implements TransportPublisher, TransportSubscriber {
  private nc: NatsConnection | null = null;
  private js: JetStreamClient | null = null;
  private jsm: JetStreamManager | null = null;
  private options: NATSTransportOptions;
  private encoder = new TextEncoder();
  private decoder = new TextDecoder();

  constructor(options: NATSTransportOptions) {
    this.options = options;
  }

  private async ensureNc(): Promise<NatsConnection> {
    if (this.nc) return this.nc;

    const connectOpts: ConnectionOptions = {
      servers: this.options.servers,
      name: this.options.name ?? "myelin",
      reconnect: this.options.reconnect ?? true,
      maxReconnectAttempts: this.options.maxReconnectAttempts ?? -1,
    };

    if (this.options.credentials) {
      const { readFile } = await import("node:fs/promises");
      const { homedir } = await import("node:os");
      let credsPath = this.options.credentials;
      if (credsPath.startsWith("~/")) {
        credsPath = `${homedir()}${credsPath.slice(1)}`;
      }
      let credsContent: Buffer;
      try {
        credsContent = await readFile(credsPath);
      } catch (err) {
        throw new Error(
          `Failed to read NATS credentials file: ${credsPath} — ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      connectOpts.authenticator = credsAuthenticator(credsContent);
    } else if (this.options.user) {
      connectOpts.user = this.options.user;
      connectOpts.pass = this.options.pass;
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

  async publish(subject: string, envelope: MyelinEnvelope): Promise<void> {
    const { js } = await this.ensureConnected();
    const payload = this.encoder.encode(JSON.stringify(envelope));
    await js.publish(subject, payload);
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
    deliverPolicy: string = "new",
    ackPolicy: string = "explicit",
  ): Promise<void> {
    const { jsm, js } = await this.ensureConnected();
    try {
      const existing = await js.consumers.get(this.streamName, durableName);
      const info = await existing.info();
      if (info.config.filter_subject !== filterSubject) {
        await (jsm.consumers as any).update(this.streamName, {
          durable_name: durableName,
          filter_subject: filterSubject,
        });
      }
    } catch {
      await (jsm.consumers as any).add(this.streamName, {
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
        if (!running) break;
        try {
          const envelope: MyelinEnvelope = JSON.parse(
            this.decoder.decode(msg.data),
          );
          await handler(envelope);
          msg.ack();
        } catch (err) {
          msg.nak();
          process.stderr.write(
            `myelin-nats: handler error on ${subject}: ${err instanceof Error ? err.message : String(err)}\n`,
          );
        }
      }
    })();

    consumeLoop.catch((err) => {
      if (running) {
        process.stderr.write(
          `myelin-nats: consume loop error on ${subject}: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
    });

    return {
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
        if (!running) break;
        try {
          const envelope: MyelinEnvelope = JSON.parse(
            this.decoder.decode(msg.data),
          );
          await handler(envelope);
        } catch (err) {
          process.stderr.write(
            `myelin-nats: best-effort handler error on ${subject}: ${err instanceof Error ? err.message : String(err)}\n`,
          );
        }
      }
    })();

    consumeLoop.catch((err) => {
      if (running) {
        process.stderr.write(
          `myelin-nats: best-effort loop error on ${subject}: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
    });

    return {
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
      options.deliverPolicy ?? "all",
    );

    const consumer = await js.consumers.get(this.streamName, options.durableName);
    const messages = await consumer.consume();

    return new Promise((resolve) => {
      const timeout = options?.timeoutMs
        ? setTimeout(() => { messages.stop(); resolve(null); }, options.timeoutMs)
        : null;

      const consumeLoop = (async () => {
        for await (const msg of messages) {
          try {
            const envelope: MyelinEnvelope = JSON.parse(this.decoder.decode(msg.data));
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

      consumeLoop.catch(() => resolve(null));
    });
  }

  async ensureStream(streamName: string, subjects: string[], config?: {
    maxBytes?: number;
    maxAge?: number;
    storage?: string;
    retention?: string;
  }): Promise<void> {
    const { jsm } = await this.ensureConnected();

    try {
      await jsm.streams.info(streamName);
    } catch {
      await jsm.streams.add({
        name: streamName,
        subjects,
        retention: (config?.retention ?? "limits") as any,
        max_bytes: config?.maxBytes ?? 512 * 1024 * 1024,
        max_age: config?.maxAge ?? 7 * 24 * 60 * 60 * 1e9,
        storage: (config?.storage ?? "file") as any,
        discard: "old" as any,
        num_replicas: 1,
      });
    }
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
