/* eslint-disable @typescript-eslint/require-await --
 *
 * Test-only in-memory transport. Methods satisfy the async transport
 * contracts without I/O to await.
 */
import type { MyelinEnvelope } from "../types";
import { EnvelopeTransport, type EnvelopeTransportOptions } from "./envelope";
import type { TransportPublisher, TransportSubscriber, SubscribeOptions, Subscription, RequestOptions } from "./types";

type Handler = (envelope: MyelinEnvelope) => Promise<void>;

class InMemoryPublisher implements TransportPublisher {
  published: { subject: string; envelope: MyelinEnvelope }[] = [];

  async publish(subject: string, envelope: MyelinEnvelope): Promise<void> {
    this.published.push({ subject, envelope });
  }

  async request(
    _subject: string,
    _envelope: MyelinEnvelope,
    _options?: RequestOptions,
  ): Promise<MyelinEnvelope> {
    throw new Error("request() not supported on TestEnvelopeTransport — use InMemoryTransport for request/reply tests");
  }

  async close(): Promise<void> {}
}

class InMemorySubscriber implements TransportSubscriber {
  private handlers = new Map<string, Handler[]>();

  async subscribe(
    subject: string,
    handler: Handler,
    _options?: SubscribeOptions,
  ): Promise<Subscription> {
    const handlers = this.handlers.get(subject) ?? [];
    handlers.push(handler);
    this.handlers.set(subject, handlers);
    return { unsubscribe: async () => {} };
  }

  async subscribeBestEffort(
    subject: string,
    handler: Handler,
  ): Promise<Subscription> {
    return this.subscribe(subject, handler);
  }

  async deliver(subject: string, envelope: MyelinEnvelope): Promise<void> {
    for (const handler of this.handlers.get(subject) ?? []) {
      await handler(envelope);
    }
  }

  async close(): Promise<void> {}
}

export class TestEnvelopeTransport extends EnvelopeTransport {
  readonly memPublisher: InMemoryPublisher;
  readonly memSubscriber: InMemorySubscriber;

  constructor(options: Omit<EnvelopeTransportOptions, "publisher" | "subscriber">) {
    const pub = new InMemoryPublisher();
    const sub = new InMemorySubscriber();
    super({ ...options, publisher: pub, subscriber: sub });
    this.memPublisher = pub;
    this.memSubscriber = sub;
  }

  get published(): { subject: string; envelope: MyelinEnvelope }[] {
    return this.memPublisher.published;
  }

  get envelopes(): MyelinEnvelope[] {
    return this.memPublisher.published.map((p) => p.envelope);
  }
}
