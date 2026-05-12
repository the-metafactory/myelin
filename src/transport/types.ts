import type { MyelinEnvelope, Sovereignty } from "../types";

export interface SubscribeOptions {
  deliverPolicy?: "all" | "new" | "last";
  ackPolicy?: "none" | "explicit";
  durableName?: string;
}

export interface RequestOptions {
  timeoutMs?: number;
}

export interface Subscription {
  unsubscribe(): Promise<void>;
}

export interface TransportPublisher {
  /**
   * Publish an envelope. Always returns a `Promise<void>`. Implementations
   * MAY reject for transport-specific reasons (e.g. `InMemoryTransport`
   * rejects with "Transport closed" when called after `close()`; NATS
   * rejects on JetStream ack failure). Callers that don't `await` the
   * returned promise will see those rejections as unhandled — pair every
   * `publish` with either an `await` or a `.catch`.
   */
  publish(subject: string, envelope: MyelinEnvelope): Promise<void>;
  /**
   * Request/reply round-trip. Sends `envelope` on `subject`, subscribes
   * to a fresh `_INBOX.{id}` reply mailbox (or the caller-supplied one
   * via `envelope.extensions.reply_to`), and resolves with the first
   * response envelope whose `correlation_id` matches.
   *
   * Rejects with a timeout error tagged with `subject` after
   * `options.timeoutMs` (or `DEFAULT_REQUEST_TIMEOUT_MS` when omitted)
   * if no matching response arrives. Rejects on caller-supplied
   * `reply_to` that fails the wildcard/format guard.
   */
  request(subject: string, envelope: MyelinEnvelope, options?: RequestOptions): Promise<MyelinEnvelope>;
  close(): Promise<void>;
}

export interface TransportSubscriber {
  subscribe(
    subject: string,
    handler: (envelope: MyelinEnvelope) => Promise<void>,
    options?: SubscribeOptions,
  ): Promise<Subscription>;
  subscribeBestEffort(
    subject: string,
    handler: (envelope: MyelinEnvelope) => Promise<void>,
  ): Promise<Subscription>;
  close(): Promise<void>;
}

export interface EnvelopePublishInput {
  source: string;
  type: string;
  payload: Record<string, unknown>;
  correlation_id?: string;
  extensions?: Record<string, unknown>;
  sovereignty?: Partial<Sovereignty>;
}

export interface EnvelopeRequestInput extends EnvelopePublishInput {
  timeoutMs?: number;
}

export interface EnvelopePublisher {
  publish(input: EnvelopePublishInput, subject?: string): Promise<void>;
  request(input: EnvelopeRequestInput, subject?: string): Promise<MyelinEnvelope>;
  close(): Promise<void>;
}

export interface EnvelopeSubscriber {
  subscribe(
    subject: string,
    handler: (envelope: MyelinEnvelope) => Promise<void>,
    options?: SubscribeOptions,
  ): Promise<Subscription>;
  subscribeBestEffort(
    subject: string,
    handler: (envelope: MyelinEnvelope) => Promise<void>,
  ): Promise<Subscription>;
  close(): Promise<void>;
}
