import {
  createEnvelope,
  validateEnvelope,
  deriveNatsSubject,
  validateSubjectEnvelopeAlignment,
} from "../envelope";
import type { MyelinEnvelope, Sovereignty, CreateEnvelopeInput } from "../types";
import type {
  EnvelopePublishInput,
  EnvelopePublisher,
  EnvelopeSubscriber,
  SubscribeOptions,
  Subscription,
  TransportPublisher,
  TransportSubscriber,
} from "./types";

export interface EnvelopeTransportOptions {
  publisher: TransportPublisher;
  subscriber: TransportSubscriber;
  networkSovereignty: Sovereignty;
  agentSovereignty?: Partial<Sovereignty>;
}

function mergeSovereignty(
  network: Sovereignty,
  agent?: Partial<Sovereignty>,
  message?: Partial<Sovereignty>,
): Sovereignty {
  return {
    ...network,
    ...(agent ?? {}),
    ...(message ?? {}),
  } as Sovereignty;
}

export class EnvelopeTransport implements EnvelopePublisher, EnvelopeSubscriber {
  private pub: TransportPublisher;
  private sub: TransportSubscriber;
  private networkSovereignty: Sovereignty;
  private agentSovereignty?: Partial<Sovereignty>;
  constructor(options: EnvelopeTransportOptions) {
    this.pub = options.publisher;
    this.sub = options.subscriber;
    this.networkSovereignty = options.networkSovereignty;
    this.agentSovereignty = options.agentSovereignty;
  }

  async publish(input: EnvelopePublishInput, subject?: string): Promise<void> {
    const sovereignty = mergeSovereignty(
      this.networkSovereignty,
      this.agentSovereignty,
      input.sovereignty,
    );

    const envelopeInput: CreateEnvelopeInput = {
      source: input.source,
      type: input.type,
      sovereignty,
      payload: input.payload,
      correlation_id: input.correlation_id,
      extensions: input.extensions,
    };

    const envelope = createEnvelope(envelopeInput);

    const result = validateEnvelope(envelope);
    if (!result.valid) {
      throw new Error(
        `Envelope validation failed: ${result.errors.map((e) => `${e.field}: ${e.message}`).join("; ")}`,
      );
    }

    const targetSubject = subject ?? deriveNatsSubject(envelope);

    if (subject) {
      const alignment = validateSubjectEnvelopeAlignment(subject, envelope);
      if (!alignment.aligned) {
        throw new Error(
          `Subject-envelope misalignment: subject prefix "${alignment.actual}" does not match classification "${alignment.expected}"`,
        );
      }
    }

    await this.pub.publish(targetSubject, envelope);
  }

  async subscribe(
    subject: string,
    handler: (envelope: MyelinEnvelope) => Promise<void>,
    options?: SubscribeOptions,
  ): Promise<Subscription> {
    return this.sub.subscribe(subject, handler, options);
  }

  async close(): Promise<void> {
    await this.pub.close();
    await this.sub.close();
  }
}
