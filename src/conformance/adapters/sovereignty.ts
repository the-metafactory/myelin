import { parseSovereigntyBlock, parseSovereignty } from "../../envelope";
import { validateIngress } from "../../sovereignty/validators/ingress";
import { validateEgress } from "../../sovereignty/validators/egress";
import { enforceMaxHop } from "../../sovereignty/validators/max-hop";
import { validateImportedPrincipalsConfig } from "../../sovereignty/schema";
import type { EgressRule, ScopeMapping, SovereigntyPolicy } from "../../sovereignty/types";
import type { MyelinEnvelope } from "../../types";
import { NotImplemented, type Adapter, type VectorResult } from "../types";

/**
 * Sovereignty + economics adapters (RFC-0005 / RFC-0009).
 *
 * Reference module for the conformance runner (#239). Reason-token note: the
 * ingress/egress engine emits the KEBAB pairing prefix `compliance-block:` and
 * `max-hop-exceeded`, while the ratified pack spells them SNAKE
 * (`compliance_block:`, `max_hop_exceeded`, RFC-0007 §3.5). The snake flip is
 * staged as myelin#233 — so accept/reject (`ok`) matches today but the reason
 * token does not; those vectors are manifested → myelin#233.
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
      block_local_escape: (egress.block_local_escape as boolean) ?? true,
      rules: (egress.rules as EgressRule[]) ?? [],
    },
    ingress: {
      scope_mappings: (ingress.scope_mappings as ScopeMapping[]) ?? [],
      reject_unknown_partners: (ingress.reject_unknown_partners as boolean) ?? true,
    },
    chain_of_stamps: {
      verify_delegation_sovereignty:
        (asRecord(p.chain_of_stamps).verify_delegation_sovereignty as boolean) ?? false,
    },
  } as SovereigntyPolicy;
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
    const r = validateIngress(envelope, sourceSubject, policy);
    // reason token `compliance-block:*` vs pack `compliance_block:*` → #233.
    return r.valid ? { ok: true, value: { decision: "allow" } } : { ok: false, reason: r.code };
  },

  validateEgress: (input): VectorResult => {
    const i = asRecord(input);
    const policy = normalizePolicy(i.policy);
    const r = validateEgress(i.envelope as MyelinEnvelope, i.targetSubject as string, policy.egress.rules);
    return r.valid ? { ok: true, value: { decision: "allow" } } : { ok: false, reason: r.code };
  },

  // No source-grammar parser is exported on main (the §8 nak source rule lives
  // in the enforcement channel, not a reusable parser) — build lands with #238.
  parseSource: () => {
    throw new NotImplemented("parseSource", "myelin#238");
  },

  // RFC-0009 economics: validation is internal to validateEnvelope
  // (`validateEconomics(value, errors)` is not exported) — a standalone
  // economics op arrives with the ./wire codec (#238).
  validateEconomics: () => {
    throw new NotImplemented("validateEconomics", "myelin#238");
  },
};
