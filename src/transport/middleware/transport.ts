import type { MyelinEnvelope } from "../../types";
import type {
  TransportPublisher,
  TransportSubscriber,
  SubscribeOptions,
  Subscription,
  RequestOptions,
} from "../types";
import type {
  MiddlewareContext,
  PublishMiddleware,
  SubscribeMiddleware,
} from "./types";

export interface MiddlewareTransportOptions {
  publisher: TransportPublisher;
  subscriber: TransportSubscriber;
  publishMiddleware?: PublishMiddleware[];
  subscribeMiddleware?: SubscribeMiddleware[];
}

/**
 * F-2: TransportPublisher + TransportSubscriber wrapper that runs a
 * middleware chain over each envelope. Middleware sees fully-formed
 * envelopes because by this point in the call graph EnvelopeTransport
 * has finished construction, validation, and signing.
 *
 * Empty chain = pass-through. The wrapper is allocated either way, but
 * the per-envelope cost is one undefined-or-empty-array check.
 */
export class MiddlewareTransport implements TransportPublisher, TransportSubscriber {
  private readonly pub: TransportPublisher;
  private readonly sub: TransportSubscriber;
  private readonly publishChain: PublishMiddleware[];
  private readonly subscribeChain: SubscribeMiddleware[];

  constructor(options: MiddlewareTransportOptions) {
    this.pub = options.publisher;
    this.sub = options.subscriber;
    // Defensive copy so a caller mutating the array post-construction
    // doesn't reorder the live chain.
    this.publishChain = [...(options.publishMiddleware ?? [])];
    this.subscribeChain = [...(options.subscribeMiddleware ?? [])];
  }

  async publish(subject: string, envelope: MyelinEnvelope): Promise<void> {
    const context: MiddlewareContext = { subject, direction: "publish", timestamp: new Date() };
    let current: MyelinEnvelope | null = envelope;
    for (const mw of this.publishChain) {
      current = await mw(current, context);
      if (current === null) return; // filtered — skip wire
    }
    await this.pub.publish(subject, current);
  }

  async request(
    subject: string,
    envelope: MyelinEnvelope,
    options?: RequestOptions,
  ): Promise<MyelinEnvelope> {
    const context: MiddlewareContext = { subject, direction: "publish", timestamp: new Date() };
    let current: MyelinEnvelope | null = envelope;
    for (const mw of this.publishChain) {
      current = await mw(current, context);
      if (current === null) throw new Error("Request envelope filtered by middleware");
    }
    let response = await this.pub.request(subject, current, options);
    if (this.subscribeChain.length > 0) {
      const subCtx: MiddlewareContext = { subject, direction: "subscribe", timestamp: new Date() };
      let processed: MyelinEnvelope | null = response;
      for (const mw of this.subscribeChain) {
        processed = await mw(processed, subCtx);
        if (processed === null) throw new Error("Response envelope filtered by subscribe middleware");
      }
      response = processed;
    }
    return response;
  }

  async subscribe(
    subject: string,
    handler: (envelope: MyelinEnvelope) => Promise<void>,
    options?: SubscribeOptions,
  ): Promise<Subscription> {
    return this.sub.subscribe(subject, this.wrapHandler(subject, handler), options);
  }

  async subscribeBestEffort(
    subject: string,
    handler: (envelope: MyelinEnvelope) => Promise<void>,
  ): Promise<Subscription> {
    return this.sub.subscribeBestEffort(subject, this.wrapHandler(subject, handler));
  }

  async close(): Promise<void> {
    await this.pub.close();
    await this.sub.close();
  }

  private wrapHandler(
    subject: string,
    handler: (envelope: MyelinEnvelope) => Promise<void>,
  ): (envelope: MyelinEnvelope) => Promise<void> {
    if (this.subscribeChain.length === 0) return handler;
    const chain = this.subscribeChain;
    return async (envelope: MyelinEnvelope) => {
      const context: MiddlewareContext = { subject, direction: "subscribe", timestamp: new Date() };
      let current: MyelinEnvelope | null = envelope;
      for (const mw of chain) {
        current = await mw(current, context);
        if (current === null) return; // filtered — skip user handler
      }
      await handler(current);
    };
  }
}

export function createMiddlewareTransport(options: MiddlewareTransportOptions): MiddlewareTransport {
  return new MiddlewareTransport(options);
}
