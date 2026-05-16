import {
  createEnvelope,
  validateEnvelope,
  deriveNatsSubject,
  validateSubjectEnvelopeAlignment,
} from "../envelope";
import { deriveLegacySubjectPattern } from "../subjects";
import { signEnvelope } from "../identity/sign";
import type { SigningIdentity } from "../identity/types";
import type { MyelinEnvelope, Sovereignty, CreateEnvelopeInput } from "../types";
import type {
  EnvelopePublishInput,
  EnvelopePublisher,
  EnvelopeRequestInput,
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
  /**
   * Operator stack segment slotted between `{org}` and `{type}` on the
   * derived NATS subject (myelin#113 — IAW Phase A.5; closes myelin#155).
   * Used as the fallback when `publish()`/`request()` callers omit the
   * explicit `subject` argument and `prepareEnvelope` derives one via
   * `deriveNatsSubject(envelope, stack)`. When undefined, the fallback
   * emits the legacy 5-segment form — bit-identical to today for
   * deployments that haven't wired stack identity yet.
   *
   * Production callers (cortex's `MyelinRuntime`, sage's bridge) pass
   * the operator's resolved stack identity here so a transport instance
   * dedicated to one stack can't accidentally emit on another.
   */
  stack?: string;
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
  };
}

export class EnvelopeTransport implements EnvelopePublisher, EnvelopeSubscriber {
  private pub: TransportPublisher;
  private sub: TransportSubscriber;
  private networkSovereignty: Sovereignty;
  private agentSovereignty?: Partial<Sovereignty>;
  private identity?: SigningIdentity;
  private stack?: string;
  constructor(options: EnvelopeTransportOptions) {
    this.pub = options.publisher;
    this.sub = options.subscriber;
    this.networkSovereignty = options.networkSovereignty;
    this.agentSovereignty = options.agentSovereignty;
    this.identity = options.identity;
    this.stack = options.stack;
  }

  private async prepareEnvelope(
    input: EnvelopePublishInput,
    subject?: string,
  ): Promise<{ envelope: MyelinEnvelope; targetSubject: string }> {
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

    // myelin#155 — when the caller doesn't supply an explicit subject,
    // derive it stack-aware so the wire shape matches the canonical
    // 6-segment grammar `local.{org}.{stack}.{type}` post-myelin#113.
    // When `this.stack` is undefined (legacy operator without a `stack:`
    // block), `deriveNatsSubject` short-circuits to the 5-segment form —
    // bit-identical to the pre-#155 behaviour, so callers that omit
    // `stack` see no observable change.
    const targetSubject = subject ?? deriveNatsSubject(envelope, this.stack);

    if (subject) {
      // Pass `this.stack` so the validator's wire-form detection can
      // disambiguate stack-aware subjects whose `{stack}` segment happens
      // to collide with a `{type}` first segment (myelin's
      // `validateSubjectEnvelopeAlignment` heuristic per envelope.ts:515).
      const alignment = validateSubjectEnvelopeAlignment(subject, envelope, this.stack);
      if (!alignment.aligned) {
        throw new Error(
          `Subject-envelope misalignment: subject prefix "${alignment.actual}" does not match classification "${alignment.expected}"`,
        );
      }
    }

    return { envelope, targetSubject };
  }

  async publish(input: EnvelopePublishInput, subject?: string): Promise<void> {
    const { envelope, targetSubject } = await this.prepareEnvelope(input, subject);
    await this.pub.publish(targetSubject, envelope);
  }

  async request(input: EnvelopeRequestInput, subject?: string): Promise<MyelinEnvelope> {
    const { envelope, targetSubject } = await this.prepareEnvelope(input, subject);
    return this.pub.request(targetSubject, envelope, {
      timeoutMs: input.timeoutMs,
    });
  }

  async subscribe(
    subject: string,
    handler: (envelope: MyelinEnvelope) => Promise<void>,
    options?: SubscribeOptions,
  ): Promise<Subscription> {
    const primary = await this.sub.subscribe(subject, handler, options);

    // myelin#154 — backward-compat normalisation gate (spec rule MV-3).
    // When opted in, also subscribe the derived 5-segment pattern so
    // legacy publishers stay observable through the migration window.
    // `deriveLegacySubjectPattern` returns `null` for patterns that have
    // no legacy counterpart (non-`default` literal stack, already 5-seg
    // or shorter, non-`local`/`federated` prefix) — in those cases the
    // primary subscription is the full result.
    if (!options?.dualSubscribeLegacy) {
      return primary;
    }

    const legacyPattern = deriveLegacySubjectPattern(subject);
    if (legacyPattern === null) {
      return primary;
    }

    const secondary = await this.sub.subscribe(legacyPattern, handler, options);

    return {
      unsubscribe: async () => {
        // Tear both down in parallel; surface either failure to the caller
        // via `Promise.all` (settled would swallow errors that ops needs to
        // see when a NATS sub leak triggers in production).
        await Promise.all([primary.unsubscribe(), secondary.unsubscribe()]);
      },
    };
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
