import { parseSovereigntyBlock, parseSovereignty, validateEnvelope } from "../../envelope";
import { validateEgress } from "../../sovereignty/validators/egress";
import { enforceMaxHop } from "../../sovereignty/validators/max-hop";
import { validateImportedPrincipalsConfig } from "../../sovereignty/schema";
import { createSovereigntyEngine } from "../../sovereignty/engine";
import { createInMemoryPolicyStore } from "../../sovereignty/policy-store";
import type { EgressRule, ScopeMapping, SovereigntyPolicy } from "../../sovereignty/types";
import type { MyelinEnvelope } from "../../types";
import { NotImplemented, type Adapter, type VectorResult } from "../types";

/**
 * Sovereignty + economics adapters (RFC-0005 / RFC-0009).
 *
 * Reference module for the conformance runner (#239). Reason-token note: the
 * ingress/egress engine emits the KEBAB pairing prefix `compliance-block:` and
 * `max-hop-exceeded`, while the ratified pack spells them SNAKE
 * (`compliance_block:`, `max_hop_exceeded`). These are RFC-0005 sovereignty
 * reason codes — §2 lists "hyphenated NAK tokens" inside the sovereignty
 * engine-debt row, so accept/reject (`ok`) matches today but the reason token
 * (and the deeper engine gaps: unconditional permissive-ALLOW, partner-unknown
 * dead value, residency fail-open, chain-walk gated off, max_hop dead,
 * agent-DID imported_principals matching) is myelin#11 — with the ingress/egress
 * PROCEDURE slice tracked by the sub-issue myelin#261. Those vectors are
 * manifested accordingly.
 *
 * `validateEconomics` (RFC-0009) is impl-backed: myelin's embedded economics
 * validator (envelope.ts:521, reached whenever `economics` is present) emits the
 * exact `economics.*` field-path tokens the vectors assert. It is not exported
 * standalone, so we drive it through the public `validateEnvelope` and filter to
 * the `economics.*` errors — every economics vector passes today (no manifest).
 */

function asRecord(x: unknown): Record<string, unknown> {
  return (x ?? {}) as Record<string, unknown>;
}

// Build a full SovereigntyPolicy from a vector's partial `policy` field.
function normalizePolicy(raw: unknown): SovereigntyPolicy {
  const p = asRecord(raw);
  const ingress = asRecord(p.ingress);
  const egress = asRecord(p.egress);
  return {
    version: 1,
    network: "metafactory",
    egress: {
      block_local_escape: (egress.block_local_escape as boolean | undefined) ?? true,
      rules: (egress.rules as EgressRule[] | undefined) ?? [],
    },
    ingress: {
      scope_mappings: (ingress.scope_mappings as ScopeMapping[] | undefined) ?? [],
      reject_unknown_partners: (ingress.reject_unknown_partners as boolean | undefined) ?? true,
    },
    chain_of_stamps: {
      verify_delegation_sovereignty:
        (asRecord(p.chain_of_stamps).verify_delegation_sovereignty as boolean | undefined) ?? false,
    },
  };
}

// Some ingress vectors are pre-normalized to {policy, lastStampPrincipal,
// subject, capability}; synthesize the envelope + sourceSubject those imply.
function envelopeFromIngressInput(input: Record<string, unknown>): {
  envelope: MyelinEnvelope;
  sourceSubject: string;
} {
  if (input.envelope) {
    return {
      envelope: input.envelope as MyelinEnvelope,
      sourceSubject: input.sourceSubject as string,
    };
  }
  const cap = input.capability as string | undefined;
  const envelope: MyelinEnvelope = {
    id: "550e8400-e29b-41d4-a716-446655440239",
    source: "acme.default.echo",
    type: "tasks.code-review",
    timestamp: "2026-07-17T00:00:00Z",
    sovereignty: { classification: "federated", data_residency: "CH", max_hop: 1, frontier_ok: false, model_class: "any" },
    signed_by: [{ method: "ed25519", identity: input.lastStampPrincipal as string, signature: "AA", at: "2026-07-17T00:00:00Z" }],
    payload: {},
    ...(cap ? { requirements: [cap] } : {}),
  };
  return { envelope, sourceSubject: input.subject as string };
}

export const sovereigntyAdapters: Record<string, Adapter> = {
  parseSovereigntyBlock: (input): VectorResult => {
    const r = parseSovereigntyBlock(input);
    return r.valid ? { ok: true, value: { valid: true } } : { ok: false, reason: r.reason };
  },

  parseSovereignty: (input): VectorResult => {
    const env = { sovereignty: input } as unknown as MyelinEnvelope;
    const r = parseSovereignty(env);
    return { ok: true, value: { canReachFrontier: r.canReachFrontier } };
  },

  validateImportedPrincipalsConfig: (input): VectorResult => {
    const r = validateImportedPrincipalsConfig(input as { imported_principals: string[] });
    return r.valid ? { ok: true } : { ok: false, reason: r.reason };
  },

  enforceMaxHop: (input): VectorResult => {
    const i = asRecord(input);
    const r = enforceMaxHop(i.max_hop as number, i.chain_length as number);
    // reason token `max-hop-exceeded` vs pack `max_hop_exceeded` → #233.
    return r.valid ? { ok: true, value: { forwards: r.forwards } } : { ok: false, reason: r.reason };
  },

  validateIngress: (input): VectorResult => {
    const i = asRecord(input);
    const { envelope, sourceSubject } = envelopeFromIngressInput(i);
    const policy = normalizePolicy(i.policy);
    // Drive the ENGINE entrypoint, not the bare last-stamp rule (myelin#279).
    // engine.validateIngress runs max-hop TTL → chain-of-stamps sovereignty →
    // last-stamp rules in order, so a multi-stamp delegation with
    // verify_delegation_sovereignty on is walked (verifyChainSovereignty) and an
    // earlier unmapped hop yields chain-invalid — the bare validateIngress only
    // ever sees the last stamp and mis-attributed it to unknown-principal.
    const engine = createSovereigntyEngine({
      policyStore: createInMemoryPolicyStore({ initial: policy }),
    });
    const r = engine.validateIngress(envelope, sourceSubject);
    // reason token `compliance-block:*` vs pack `compliance_block:*` → #11.
    return r.valid ? { ok: true, value: { decision: "allow" } } : { ok: false, reason: r.code };
  },

  validateEgress: (input): VectorResult => {
    const i = asRecord(input);
    const policy = normalizePolicy(i.policy);
    const r = validateEgress(i.envelope as MyelinEnvelope, i.targetSubject as string, policy.egress.rules);
    return r.valid ? { ok: true, value: { decision: "allow" } } : { ok: false, reason: r.code };
  },

  // No source-grammar parser is exported on main (the §8 nak source rule lives
  // in the enforcement channel, not a reusable parser). It is part of the
  // sovereignty engine debt (§2 "off-spec unsigned nak envelope") → myelin#11.
  parseSource: () => {
    throw new NotImplemented("parseSource", "myelin#11");
  },

  // RFC-0009 economics: validation is embedded in validateEnvelope
  // (`validateEconomics(value, errors)`, envelope.ts:521 — reached whenever the
  // `economics` block is present). Not exported standalone, so we drive it via
  // the public validateEnvelope over a `{ economics }` wrapper and keep only the
  // `economics.*` errors (other missing-field errors on the bare wrapper are
  // irrelevant to the economics verdict). The first economics error's field path
  // is exactly the vector's expected reason token; no manifest needed.
  validateEconomics: (input): VectorResult => {
    const r = validateEnvelope({ economics: input });
    const econErrors = r.errors.filter(
      (e) => e.field === "economics" || e.field.startsWith("economics."),
    );
    // Accept vectors echo the validated block back as `value`; reject vectors
    // assert only the reason token.
    return econErrors.length === 0
      ? { ok: true, value: input }
      : { ok: false, reason: econErrors[0]?.field ?? "economics" };
  },
};
