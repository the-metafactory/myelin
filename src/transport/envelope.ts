import {
  createEnvelope,
  validateEnvelope,
  deriveNatsSubject,
  validateSubjectEnvelopeAlignment,
} from "../envelope";
import { signEnvelope } from "../identity/sign";
import type { SigningIdentity } from "../identity/types";
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
  identity?: SigningIdentity;
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
  private identity?: SigningIdentity;
  constructor(options: EnvelopeTransportOptions) {
    this.pub = options.publisher;
    this.sub = options.subscriber;
    this.networkSovereignty = options.networkSovereignty;
    this.agentSovereignty = options.agentSovereignty;
    this.identity = options.identity;
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

    const unsigned = createEnvelope(envelopeInput);

    const result = validateEnvelope(unsigned);
    if (!result.valid) {
      throw new Error(
        `Envelope validation failed: ${result.errors.map((e) => `${e.field}: ${e.message}`).join("; ")}`,
      );
    }

    const envelope = this.identity
      ? await signEnvelope(unsigned, this.identity.privateKey, this.identity.did)
      : unsigned;

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

  async subscribeBestEffort(
    subject: string,
    handler: (envelope: MyelinEnvelope) => Promise<void>,
  ): Promise<Subscription> {
    return this.sub.subscribeBestEffort(subject, handler);
  }

  async close(): Promise<void> {
    await this.pub.close();
    await this.sub.close();
  }
}
