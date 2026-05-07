import type { MyelinEnvelope, Sovereignty } from "../types";

export interface SubscribeOptions {
  deliverPolicy?: "all" | "new" | "last";
  ackPolicy?: "none" | "explicit";
  durableName?: string;
}

export interface Subscription {
  unsubscribe(): Promise<void>;
}

export interface TransportPublisher {
  publish(subject: string, envelope: MyelinEnvelope): Promise<void>;
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

export interface EnvelopePublisher {
  publish(input: EnvelopePublishInput, subject?: string): Promise<void>;
  close(): Promise<void>;
}

export interface EnvelopeSubscriber {
  subscribe(
    subject: string,
    handler: (envelope: MyelinEnvelope) => Promise<void>,
    options?: SubscribeOptions,
  ): Promise<Subscription>;
  close(): Promise<void>;
}
