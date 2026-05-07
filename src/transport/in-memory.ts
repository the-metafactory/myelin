import type { MyelinEnvelope } from "../types";
import type {
  TransportPublisher,
  TransportSubscriber,
  SubscribeOptions,
  Subscription,
} from "./types";

type Handler = (envelope: MyelinEnvelope) => Promise<void>;

interface ActiveSubscription {
  pattern: string;
  handler: Handler;
}

function subjectMatchesPattern(subject: string, pattern: string): boolean {
  const subParts = subject.split(".");
  const patParts = pattern.split(".");

  for (let i = 0; i < patParts.length; i++) {
    if (patParts[i] === ">") return true;
    if (i >= subParts.length) return false;
    if (patParts[i] !== "*" && patParts[i] !== subParts[i]) return false;
  }

  return subParts.length === patParts.length;
}

export class InMemoryTransport implements TransportPublisher, TransportSubscriber {
  private subscriptions: ActiveSubscription[] = [];
  private closed = false;

  async publish(subject: string, envelope: MyelinEnvelope): Promise<void> {
    if (this.closed) throw new Error("Transport closed");

    for (const sub of this.subscriptions) {
      if (subjectMatchesPattern(subject, sub.pattern)) {
        await sub.handler(envelope);
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

  async close(): Promise<void> {
    this.closed = true;
    this.subscriptions = [];
  }
}

export { subjectMatchesPattern };
