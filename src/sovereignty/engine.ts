import type { MyelinEnvelope } from "../types";
import { getLastStampPrincipal } from "../identity/chain";
import type { AuditLog } from "./audit-log";
import type { PolicyStore } from "./policy-store";
import type {
  AuditDecision,
  AuditDirection,
  AuditEntry,
  SovereigntyValidationResult,
} from "./types";
import { validateEgress as validateEgressRules } from "./validators/egress";
import { validateIngress as validateIngressRules } from "./validators/ingress";
import { verifyChainSovereignty } from "./validators/chain";

/**
 * F-5 T-7.x sovereignty engine — orchestrates validators against the
 * cached policy and (optionally) emits audit entries to JetStream
 * via the bound {@link AuditLog}.
 *
 * The engine never blocks on audit emit: `auditLog.emit()` is itself
 * fire-and-forget (see {@link createAuditLog}), and any synchronous
 * throw from the audit path is caught and forwarded to
 * `onAuditError` so a faulty observability layer can never block the
 * publish hot path.
 */
export interface SovereigntyEngine {
  validateEgress(envelope: MyelinEnvelope, targetSubject: string): SovereigntyValidationResult;
  validateIngress(envelope: MyelinEnvelope, sourceSubject: string): SovereigntyValidationResult;
  getPolicyStore(): PolicyStore;
}

export interface SovereigntyEngineOptions {
  policyStore: PolicyStore;
  /** Optional audit log. When provided, every decision is emitted. */
  auditLog?: AuditLog;
  /** Override the audit clock — handy in tests. Defaults to `Date.now()`. */
  now?: () => Date;
  /** Callback for synchronous failures inside the audit emit path. */
  onAuditError?: (error: Error, entry: AuditEntry) => void;
}

export function createSovereigntyEngine(options: SovereigntyEngineOptions): SovereigntyEngine {
  const { policyStore, auditLog } = options;
  const now = options.now ?? (() => new Date());
  const onAuditError =
    options.onAuditError ??
    ((err, entry) => {
      console.error(
        `[sovereignty] audit emit raised synchronously for envelope ${entry.envelope_id}: ${err.message}`,
      );
    });

  function buildEntry(
    envelope: MyelinEnvelope,
    direction: AuditDirection,
    subject: string,
    result: SovereigntyValidationResult,
  ): AuditEntry {
    const decision: AuditDecision = result.valid ? "allow" : "block";
    // myelin#31 — the most recent attestor is the one that actually
    // published on this hop, so audit log records the LAST stamp's
    // principal. Pre-#31 single-stamp envelopes collapse to a
    // one-element chain → same principal.
    const principal = getLastStampPrincipal(envelope);
    const entry: AuditEntry = {
      timestamp: now().toISOString(),
      envelope_id: envelope.id,
      direction,
      decision,
      subject,
      classification: envelope.sovereignty.classification,
      data_residency: envelope.sovereignty.data_residency,
      ...(principal ? { principal } : {}),
    };
    if (!result.valid) {
      entry.reason = result.reason;
      entry.reason_code = result.code;
    }
    return entry;
  }

  function emit(entry: AuditEntry): void {
    if (!auditLog) return;
    try {
      auditLog.emit(entry);
    } catch (err) {
      onAuditError(err instanceof Error ? err : new Error(String(err)), entry);
    }
  }

  return {
    validateEgress(envelope, targetSubject) {
      const policy = policyStore.get();
      const localEscape =
        policy.egress.block_local_escape &&
        envelope.sovereignty.classification === "local" &&
        !targetSubject.startsWith("local.");
      const result: SovereigntyValidationResult = localEscape
        ? {
            valid: false,
            code: "compliance-block:classification-mismatch",
            reason: `block_local_escape: local-classified envelope cannot publish to '${targetSubject}'`,
          }
        : validateEgressRules(envelope, targetSubject, policy.egress.rules);
      emit(buildEntry(envelope, "egress", targetSubject, result));
      return result;
    },
    validateIngress(envelope, sourceSubject) {
      const policy = policyStore.get();
      // T-6.1: chain-of-stamps sovereignty walks every stamp's
      // principal against scope_mappings before the last-stamp
      // ingress check. Gated by
      // policy.chain_of_stamps.verify_delegation_sovereignty; when
      // the flag is off the function short-circuits to ALLOW.
      // First-fail-wins so the operator sees the earliest invalid
      // hop in the audit log, not the propagated last-stamp error.
      const chainResult = verifyChainSovereignty(envelope, policy);
      const result = chainResult.valid
        ? validateIngressRules(envelope, sourceSubject, policy)
        : chainResult;
      emit(buildEntry(envelope, "ingress", sourceSubject, result));
      return result;
    },
    getPolicyStore() {
      return policyStore;
    },
  };
}
