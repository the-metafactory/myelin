import type {
  SubscribeOptions,
  Subscription,
  TransportPublisher,
  TransportSubscriber,
  RequestOptions,
} from "../transport/types";
import type { MyelinEnvelope } from "../types";
import { signEnvelope } from "../identity/sign";
import type { SigningIdentity } from "../identity/types";
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
 *      `_audit.sovereignty.nak.<direction>.<envelope_id>` — the reserved
 *      `_audit.` compliance space, RFC-0005 §8). The nak rides on a
 *      synthesized, SIGNED MyelinEnvelope: its `source` is the enforcing
 *      stack's agent-class address (derived from the injected
 *      {@link SigningIdentity}), it carries a `signed_by` stamp from that
 *      identity, and its payload carries the typed `compliance-block`
 *      detail. The nak is published through the underlying transport
 *      directly — the recursion exemption is narrowed to `_audit.`-prefixed
 *      subjects so the bypass can never launder a non-audit publish past
 *      validateEgress.
 *   2. On the publish path, a {@link SovereigntyBlockedError} thrown
 *      to the caller so the producer learns the request was rejected.
 *      On the subscribe path the wrapper acks-and-drops by returning
 *      normally — the handler is never invoked.
 *
 * `subscribeBestEffort` drops blocked envelopes silently — no nak,
 * no handler call.
 */

export const SOVEREIGNTY_NAK_PREFIX_DEFAULT = "_audit.sovereignty.nak";

/**
 * The compliance-block token emitted in the nak envelope `type`
 * (`sovereignty.<token>`) and the {@link SovereigntyNakDetail} `type`.
 * Routed through ONE constant so the coordinated kebab→snake registry
 * flip (`compliance-block` → `compliance_block`, staged with the myelin#233
 * R cut, BCP-0001 §5.2) is a one-line stage. Do NOT flip the spelling
 * here ahead of that flag-day cut — the wire spelling stays kebab.
 */
export const SOVEREIGNTY_COMPLIANCE_BLOCK_TOKEN = "compliance-block" as const;

export const SOVEREIGNTY_NAK_TYPE = `sovereignty.${SOVEREIGNTY_COMPLIANCE_BLOCK_TOKEN}`;

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
  /**
   * The enforcing stack's signing identity. REQUIRED: the nak is signed
   * with this key (RFC-0005 §8 — a nak MUST be a signed, verifiable
   * envelope), and its `source` defaults to this identity's agent-class
   * address. Construction fails fast when it is absent, so a misconfigured
   * stack can never emit an unsigned nak at block time.
   *
   * NOTE: #238 (`./wire`) may re-home this key seam onto a shared
   * transport-identity surface; until then it is injected here at
   * construction by the caller (cortex `MyelinRuntime` / the stack bring-up).
   */
  signingIdentity: SigningIdentity;
  /** Subject prefix for structured naks. Defaults to `_audit.sovereignty.nak`; must stay within the reserved `_audit.` space. */
  nakSubjectPrefix?: string;
  /**
   * `source` field for the synthesized nak envelope. Defaults to the
   * enforcing stack's agent-class address, derived from
   * `signingIdentity.did` (the `did:mf:` prefix stripped to the
   * 3-segment `{principal}.{stack}.{assistant}` form). Pass this only to
   * override that derivation.
   */
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

/**
 * Derive the nak `source` from the enforcing stack's signing identity:
 * strip the `did:mf:` DID method-prefix, leaving the 3-segment
 * `{principal}.{stack}.{assistant}` address the envelope schema's
 * `source` field expects. Callers whose identity DID is not a 3-segment
 * stack address must pass `nakSource` explicitly.
 */
function deriveNakSource(identity: SigningIdentity): string {
  return identity.did.replace(/^did:mf:/, "");
}

export function createSovereignTransport(options: SovereignTransportOptions): SovereignTransport {
  const { transport, engine } = options;
  // Fail-fast at construction (not at emit): a stack that cannot sign its
  // naks must never come up. `signingIdentity` is a required option, so the
  // type check already covers TypeScript callers — but validate the runtime
  // value through `unknown` too, so a JS caller (or an `as any` cast) can't
  // slip a malformed identity past the compiler and discover it only when a
  // block fires. Widening to `unknown` is what makes this a real runtime
  // check rather than one the types render dead.
  const providedIdentity = options.signingIdentity as unknown;
  if (
    typeof providedIdentity !== "object" ||
    providedIdentity === null ||
    typeof (providedIdentity as SigningIdentity).did !== "string" ||
    typeof (providedIdentity as SigningIdentity).privateKey !== "string"
  ) {
    throw new Error(
      "createSovereignTransport: signingIdentity { did, privateKey } is required — " +
        "the enforcing stack must be able to sign its compliance naks (RFC-0005 §8)",
    );
  }
  const signingIdentity = providedIdentity as SigningIdentity;
  const nakSubjectPrefix = options.nakSubjectPrefix ?? SOVEREIGNTY_NAK_PREFIX_DEFAULT;
  const nakSource = options.nakSource ?? deriveNakSource(signingIdentity);
  const now = options.now ?? (() => new Date());
  // Default no-op for the optional ingress-block callback.
  // eslint-disable-next-line @typescript-eslint/no-empty-function
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
      type: SOVEREIGNTY_COMPLIANCE_BLOCK_TOKEN,
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
        // RFC-0005 §8:46 — the nak envelope is classified `local` (a FIXED
        // value, not mirrored from the blocked envelope). The pairing is
        // decidable precisely because the reserved `_audit.` space sits
        // outside the three-prefix classification↔subject grammar
        // (RFC-0002 §9), so a `local` nak on an `_audit.`-prefixed subject
        // is conformant, not a local-escape. `data_residency` DOES mirror
        // the blocked envelope — that is the pre-existing pattern.
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
    // Recursion exemption, narrowed. Publishing the nak straight through the
    // underlying transport skips the wrapper's validateEgress — the bypass
    // that keeps a block from recursing into another block. Scope that
    // exemption to the reserved `_audit.` compliance space so a
    // misconfigured `nakSubjectPrefix` can never turn the bypass into a
    // general escape hatch for an unvalidated non-audit publish.
    if (!subject.startsWith("_audit.")) {
      onNakPublishError(
        new Error(
          `nak subject "${subject}" is not in the reserved _audit. space — ` +
            "refusing the validateEgress-bypass publish (recursion exemption is _audit.-only)",
        ),
        detail,
      );
      return;
    }
    try {
      // Sign the nak with the enforcing stack's identity so it is a
      // verifiable, schema-valid envelope (RFC-0005 §8), then bypass the
      // wrapper to avoid self-recursion through the engine.
      const signedNak = await signEnvelope(
        buildNakEnvelope(envelope, detail),
        signingIdentity.privateKey,
        signingIdentity.did,
      );
      await transport.publish(subject, signedNak);
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
      const ingressResult = engine.validateIngress(response, subject);
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
