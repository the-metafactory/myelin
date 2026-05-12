import type { MyelinEnvelope } from "../types";
import type {
  TransportPublisher,
  TransportSubscriber,
  SubscribeOptions,
  Subscription,
  RequestOptions,
} from "./types";
import { subjectMatchesPattern } from "../subject-matching";
import type { Codec, CodecRegistry } from "../serialization";
import { buildDefaultRegistry, detectCodec } from "../serialization";

type Handler = (envelope: MyelinEnvelope) => Promise<void>;

interface ActiveSubscription {
  pattern: string;
  handler: Handler;
}

export interface InMemoryTransportOptions {
  /**
   * Outbound wire codec. When set, every published envelope is
   * encode/decode round-tripped through the codec before delivery,
   * exposing non-serializable payloads in tests at the same fidelity
   * as a real NATS transport.
   *
   * Default: undefined (envelopes pass by reference, no serialization).
   */
  codec?: Codec;
  /**
   * Inbound codec registry. When `codec` is set and this is omitted,
   * a registry with [jsonCodec, codec] is auto-built so subscribers
   * accept either wire format during a rolling codec migration.
   */
  codecRegistry?: CodecRegistry;
}

export class InMemoryTransport implements TransportPublisher, TransportSubscriber {
  private subscriptions: ActiveSubscription[] = [];
  private closed = false;
  private readonly codec?: Codec;
  private readonly codecRegistry?: CodecRegistry;

  constructor(options: InMemoryTransportOptions = {}) {
    this.codec = options.codec;
    if (this.codec) {
      this.codecRegistry = options.codecRegistry ?? buildDefaultRegistry(this.codec);
    }
  }

  private roundTrip(envelope: MyelinEnvelope): MyelinEnvelope {
    if (!this.codec || !this.codecRegistry) return envelope;
    const bytes = this.codec.encode(envelope);
    const inboundId = detectCodec(bytes) ?? this.codec.id;
    return this.codecRegistry.get(inboundId).decode(bytes);
  }

  async publish(subject: string, envelope: MyelinEnvelope): Promise<void> {
    if (this.closed) throw new Error("Transport closed");

    const delivered = this.roundTrip(envelope);

    for (const sub of this.subscriptions) {
      if (subjectMatchesPattern(subject, sub.pattern)) {
        try {
          await sub.handler(delivered);
        } catch (err) {
          process.stderr.write(
            `myelin-transport: subscriber error on ${subject}: ${err instanceof Error ? err.message : String(err)}\n`,
          );
        }
      }
    }
  }

  async subscribe(
    subject: string,
    handler: Handler,
    _options?: SubscribeOptions,
  ): Promise<Subscription> {
    if (this.closed) throw new Error("Transport closed");

    const sub: ActiveSubscription = { pattern: subject, handler };
    this.subscriptions.push(sub);

    return {
      unsubscribe: async () => {
        const idx = this.subscriptions.indexOf(sub);
        if (idx >= 0) this.subscriptions.splice(idx, 1);
      },
    };
  }

  async subscribeBestEffort(
    subject: string,
    handler: Handler,
  ): Promise<Subscription> {
    return this.subscribe(subject, handler);
  }

  async request(
    subject: string,
    envelope: MyelinEnvelope,
    options?: RequestOptions,
  ): Promise<MyelinEnvelope> {
    if (this.closed) throw new Error("Transport closed");

    const timeoutMs = options?.timeoutMs ?? 5000;
    const correlationId = envelope.correlation_id ?? crypto.randomUUID();
    const inboxSubject = `_INBOX.${crypto.randomUUID()}`;

    const requestEnvelope: MyelinEnvelope = {
      ...envelope,
      correlation_id: correlationId,
      extensions: { ...envelope.extensions, reply_to: inboxSubject },
    };

    return new Promise<MyelinEnvelope>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        void sub.then((s) => s.unsubscribe());
        reject(new Error(`Request timed out after ${timeoutMs}ms on ${subject}`));
      }, timeoutMs);

      const sub = this.subscribe(inboxSubject, async (response) => {
        if (settled) return;
        if (response.correlation_id !== correlationId) return;
        settled = true;
        clearTimeout(timer);
        void sub.then((s) => s.unsubscribe());
        resolve(response);
      });

      sub.then(() => this.publish(subject, requestEnvelope)).catch((err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    this.subscriptions = [];
  }
}

