import type {
  SubscribeOptions,
  Subscription,
  TransportPublisher,
  TransportSubscriber,
  RequestOptions,
} from "../transport/types";
import type { MyelinEnvelope } from "../types";
import type { SovereigntyEngine } from "./engine";
import type { AuditDirection, NakReasonCode } from "./types";

/**
 * F-5 T-8.x sovereignty transport wrapper.
 *
 * `createSovereignTransport({ transport, engine })` returns a
 * TransportPublisher + TransportSubscriber that runs every envelope
 * through the sovereignty engine before it touches the wire (publish
 * path) or reaches a user handler (subscribe path).
 *
 * Blocks produce two outputs:
 *   1. A structured nak envelope published on
 *      `${nakSubjectPrefix}.<direction>.<envelope_id>` (defaults to
 *      `_nak.sovereignty.<direction>.<envelope_id>`). The nak rides on
 *      a synthesized MyelinEnvelope whose payload carries the typed
 *      `compliance-block` detail. The nak is published through the
 *      underlying transport directly to avoid recursing through the
 *      wrapper's own validateEgress.
 *   2. On the publish path, a {@link SovereigntyBlockedError} thrown
 *      to the caller so the producer learns the request was rejected.
 *      On the subscribe path the wrapper acks-and-drops by returning
 *      normally — the handler is never invoked.
 *
 * `subscribeBestEffort` drops blocked envelopes silently — no nak,
 * no handler call.
 */

export const SOVEREIGNTY_NAK_PREFIX_DEFAULT = "_nak.sovereignty";
export const SOVEREIGNTY_NAK_SOURCE_DEFAULT = "sovereignty.engine";
export const SOVEREIGNTY_NAK_TYPE = "sovereignty.compliance-block";

export interface SovereigntyNakDetail {
  type: "compliance-block";
  code: NakReasonCode;
  reason: string;
  envelope_id: string;
  direction: AuditDirection;
  subject: string;
  timestamp: string;
}

export class SovereigntyBlockedError extends Error {
  readonly detail: SovereigntyNakDetail;
  constructor(detail: SovereigntyNakDetail) {
    super(`sovereignty-block: ${detail.code} — ${detail.reason}`);
    this.name = "SovereigntyBlockedError";
    this.detail = detail;
  }
}

export interface SovereignTransport extends TransportPublisher, TransportSubscriber {
  /** Direct access to the underlying engine — useful for introspection. */
  getEngine(): SovereigntyEngine;
}

export interface SovereignTransportOptions {
  /** Underlying transport. Must implement both publisher and subscriber surfaces. */
  transport: TransportPublisher & TransportSubscriber;
  /** Sovereignty engine driving validation. */
  engine: SovereigntyEngine;
  /** Subject prefix for structured naks. Defaults to `_nak.sovereignty`. */
  nakSubjectPrefix?: string;
  /** `source` field for the synthesized nak envelope. Defaults to `sovereignty.engine`. */
  nakSource?: string;
  /** Override the nak-timestamp clock — useful in tests. */
  now?: () => Date;
  /**
   * Observer fired after a subscribe-side block. Detail is the same
   * payload that lands on the nak subject.
   */
  onIngressBlock?: (detail: SovereigntyNakDetail) => void;
  /**
   * Surface failures of the nak publish itself. Defaults to logging
   * via console.error — a faulty observability layer cannot block
   * the wrapper from throwing the original SovereigntyBlockedError
   * up to the publish caller.
   */
  onNakPublishError?: (error: Error, detail: SovereigntyNakDetail) => void;
}

export function createSovereignTransport(options: SovereignTransportOptions): SovereignTransport {
  const { transport, engine } = options;
  const nakSubjectPrefix = options.nakSubjectPrefix ?? SOVEREIGNTY_NAK_PREFIX_DEFAULT;
  const nakSource = options.nakSource ?? SOVEREIGNTY_NAK_SOURCE_DEFAULT;
  const now = options.now ?? (() => new Date());
  const onIngressBlock = options.onIngressBlock ?? (() => {});
  const onNakPublishError =
    options.onNakPublishError ??
    ((err, detail) => {
      console.error(
        `[sovereignty] nak publish failed for envelope ${detail.envelope_id} ` +
          `(${detail.direction}/${detail.code}): ${err.message}`,
      );
    });

  function buildNakDetail(
    envelope: MyelinEnvelope,
    direction: AuditDirection,
    subject: string,
    code: NakReasonCode,
    reason: string,
  ): SovereigntyNakDetail {
    return {
      type: "compliance-block",
      code,
      reason,
      envelope_id: envelope.id,
      direction,
      subject,
      timestamp: now().toISOString(),
    };
  }

  function buildNakEnvelope(
    envelope: MyelinEnvelope,
    detail: SovereigntyNakDetail,
  ): MyelinEnvelope {
    return {
      id: crypto.randomUUID(),
      source: nakSource,
      type: SOVEREIGNTY_NAK_TYPE,
      timestamp: detail.timestamp,
      correlation_id: envelope.id,
      sovereignty: {
        classification: "local",
        data_residency: envelope.sovereignty.data_residency,
        max_hop: 0,
        frontier_ok: false,
        model_class: "any",
      },
      payload: { ...detail },
    };
  }

  async function publishNak(
    envelope: MyelinEnvelope,
    detail: SovereigntyNakDetail,
  ): Promise<void> {
    const subject = `${nakSubjectPrefix}.${detail.direction}.${envelope.id}`;
    try {
      // Bypass the wrapper to avoid self-recursion through the engine.
      await transport.publish(subject, buildNakEnvelope(envelope, detail));
    } catch (err) {
      onNakPublishError(err instanceof Error ? err : new Error(String(err)), detail);
    }
  }

  return {
    async publish(subject: string, envelope: MyelinEnvelope): Promise<void> {
      const result = engine.validateEgress(envelope, subject);
      if (!result.valid) {
        const detail = buildNakDetail(envelope, "egress", subject, result.code, result.reason);
        await publishNak(envelope, detail);
        throw new SovereigntyBlockedError(detail);
      }
      await transport.publish(subject, envelope);
    },

    async request(
      subject: string,
      envelope: MyelinEnvelope,
      requestOptions?: RequestOptions,
    ): Promise<MyelinEnvelope> {
      const egressResult = engine.validateEgress(envelope, subject);
      if (!egressResult.valid) {
        const detail = buildNakDetail(envelope, "egress", subject, egressResult.code, egressResult.reason);
        await publishNak(envelope, detail);
        throw new SovereigntyBlockedError(detail);
      }
      const response = await transport.request(subject, envelope, requestOptions);
      const responseSubject = (response.extensions as Record<string, unknown> | undefined)
        ?.reply_to as string | undefined ?? subject;
      const ingressResult = engine.validateIngress(response, responseSubject);
      if (!ingressResult.valid) {
        const detail = buildNakDetail(response, "ingress", subject, ingressResult.code, ingressResult.reason);
        await publishNak(response, detail);
        onIngressBlock(detail);
        throw new SovereigntyBlockedError(detail);
      }
      return response;
    },

    async subscribe(
      subject: string,
      handler: (envelope: MyelinEnvelope) => Promise<void>,
      subscribeOptions?: SubscribeOptions,
    ): Promise<Subscription> {
      const wrapped = async (envelope: MyelinEnvelope): Promise<void> => {
        const result = engine.validateIngress(envelope, subject);
        if (!result.valid) {
          const detail = buildNakDetail(envelope, "ingress", subject, result.code, result.reason);
          await publishNak(envelope, detail);
          onIngressBlock(detail);
          return; // ack-and-drop: handler never sees blocked envelopes
        }
        await handler(envelope);
      };
      return transport.subscribe(subject, wrapped, subscribeOptions);
    },

    async subscribeBestEffort(
      subject: string,
      handler: (envelope: MyelinEnvelope) => Promise<void>,
    ): Promise<Subscription> {
      const wrapped = async (envelope: MyelinEnvelope): Promise<void> => {
        const result = engine.validateIngress(envelope, subject);
        if (!result.valid) {
          // Best-effort: drop silently. No nak. No handler.
          onIngressBlock(
            buildNakDetail(envelope, "ingress", subject, result.code, result.reason),
          );
          return;
        }
        await handler(envelope);
      };
      return transport.subscribeBestEffort(subject, wrapped);
    },

    getEngine(): SovereigntyEngine {
      return engine;
    },

    async close(): Promise<void> {
      await transport.close();
    },
  };
}
