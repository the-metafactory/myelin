/**
 * ./wire — admission surface (RFC-0006). Request-id / requested-scope grammars,
 * the AdmissionStatus enum + lifecycle transition table, the decision/seal claim
 * canonicalizer + identity-binding gates, the fetch-seam leaf_user membership
 * check, the ADMITTED sub-lifecycle projection, the covered-by-principal readout,
 * and the LeafSecretEnvelope v1/v2 decoder. Terminals from `generated/r/admission`.
 *
 * Admission's reference implementation historically lived entirely in cortex;
 * per D4/D5 the codec is built ONCE here.
 */

import { canonicalStringify } from "../jcs";
import { REQUEST_ID_RE, ADMISSION_STATUS_VALUES } from "./generated/r/admission";
import { PRINCIPAL_ID_RE } from "./generated/r/identifiers";

export type AdmissionResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

type Obj = Record<string, unknown>;

const ADMISSION_STATUSES = new Set<string>(ADMISSION_STATUS_VALUES);
const TERMINAL_STATUSES = new Set(["DEPARTED", "REVOKED", "REJECTED"]);

// ── §3 grammars ────────────────────────────────────────────────────────────

export function parseRequestId(input: string): AdmissionResult<string> {
  if (typeof input === "string" && REQUEST_ID_RE.test(input)) return { ok: true, value: input };
  return { ok: false, reason: "invalid-request-id" };
}

export function parseRequestedScope(input: string): AdmissionResult<{ principal: string }> {
  if (typeof input !== "string" || !input.endsWith(".>")) {
    return { ok: false, reason: "missing-wildcard" };
  }
  const body = input.slice(0, -2); // strip ".>"
  if (!body.startsWith("federated.")) return { ok: false, reason: "missing-wildcard" };
  const principal = body.slice("federated.".length);
  if (!PRINCIPAL_ID_RE.test(principal)) return { ok: false, reason: "out-of-charset" };
  return { ok: true, value: { principal } };
}

// ── §4.1 status enum ─────────────────────────────────────────────────────────

export function parseAdmissionStatus(input: string): AdmissionResult<string> {
  if (typeof input === "string" && ADMISSION_STATUSES.has(input)) return { ok: true, value: input };
  return { ok: false, reason: "unknown-status" };
}

// ── §7.2 claim canonicalization (JCS; CONTEXT_TAG applied at sign time) ───────

export function canonicalizeDecisionClaim(claim: unknown): AdmissionResult<string> {
  return { ok: true, value: canonicalStringify(claim) };
}

// ── §7.3 decision identity binding (+ D7 dual-accept narrow window) ──────────

export function enforceDecisionIdentityBinding(input: {
  claim: Obj;
  row: Obj;
}): AdmissionResult<{ matched: boolean; window?: string }> {
  const { claim, row } = input;
  // Dual-accept narrow window: a claim that carries NEITHER peer_pubkey NOR
  // network_id is accepted only against a row still PENDING (D7).
  if (claim.peer_pubkey === undefined && claim.network_id === undefined) {
    if (row.status === "PENDING") return { ok: true, value: { matched: true, window: "dual-accept-narrow" } };
    return { ok: false, reason: "identity_mismatch" };
  }
  if (claim.peer_pubkey === row.peer_pubkey && claim.network_id === row.network_id) {
    return { ok: true, value: { matched: true } };
  }
  return { ok: false, reason: "identity_mismatch" };
}

// ── §8.3 seal-write binding ──────────────────────────────────────────────────

export function enforceSealWriteBinding(input: {
  claim: Obj;
  entry: Obj;
}): AdmissionResult<{ matched: boolean }> {
  if (input.claim.peer_pubkey === input.entry.target_stack_pubkey) {
    return { ok: true, value: { matched: true } };
  }
  return { ok: false, reason: "identity_mismatch" };
}

// ── §8.1 R7 fetch-seam leaf_user membership ──────────────────────────────────

export function bindLeafUserToMember(input: {
  leaf_user: string;
  expected_identities: string[];
}): AdmissionResult<{ bound: boolean; leaf_user: string }> {
  const expected = input.expected_identities;
  if (!Array.isArray(expected) || expected.length === 0) {
    return { ok: false, reason: "no-expected-identity" };
  }
  if (expected.includes(input.leaf_user)) {
    return { ok: true, value: { bound: true, leaf_user: input.leaf_user } };
  }
  return { ok: false, reason: "leaf-user-subject-mismatch" };
}

// ── §4.2 lifecycle transition table ──────────────────────────────────────────

export function applyLifecycleTransition(input: {
  row: Obj;
  transition: string;
  actor?: string;
}): AdmissionResult<Obj> {
  const status = input.row.status as string;
  switch (input.transition) {
    case "depart":
      return { ok: true, value: { status: "DEPARTED", sealed_secret: null, hub_authorized_at: null } };
    case "revoke":
      return { ok: true, value: { status: "REVOKED", sealed_secret: null, hub_authorized_at: null } };
    case "register":
      // Terminal is terminal: re-register is idempotent (no resurrection).
      if (TERMINAL_STATUSES.has(status)) return { ok: true, value: { status } };
      return { ok: true, value: { status: "ADMITTED" } };
    case "admit":
      if (TERMINAL_STATUSES.has(status)) return { ok: false, reason: "already-decided" };
      return { ok: true, value: { status: "ADMITTED" } };
    default:
      return { ok: false, reason: "unknown-transition" };
  }
}

// ── §4.2 derived ADMITTED sub-lifecycle projection (field-presence readout) ──

export function projectAdmittedSublifecycle(input: {
  status: string;
  sealed_secret?: unknown;
  hub_authorized_at?: unknown;
}): AdmissionResult<{ sublifecycle: string; status: string }> {
  let sublifecycle: string;
  if (input.hub_authorized_at != null) sublifecycle = "hub-authorized";
  else if (input.sealed_secret != null) sublifecycle = "sealed";
  else sublifecycle = "unsealed";
  return { ok: true, value: { sublifecycle, status: input.status } };
}

// ── §4.2 D1 covered-by-principal display-only readout ────────────────────────

export function projectCoveredByPrincipal(input: Obj): AdmissionResult<Obj> {
  if (input.path === "mine") {
    return { ok: true, value: { covered_readout_available: false, authority: "peer_pubkey-only" } };
  }
  return { ok: true, value: { covered: true, display_only: true, join_gate_input: false } };
}

// ── §8.1 LeafSecretEnvelope v1/v2 decoder ────────────────────────────────────

export function decodeLeafSecretEnvelope(text: string): AdmissionResult<Obj> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "malformed-json" };
  }
  if (typeof parsed !== "object" || parsed === null) return { ok: false, reason: "not-an-object" };
  const env = parsed as Obj;
  if (typeof env.v !== "number") return { ok: false, reason: "version-not-number" };
  if (env.v === 1) {
    if (env.leaf_psk === undefined) return { ok: false, reason: "missing-leaf-psk" };
    return { ok: true, value: env };
  }
  if (env.v === 2) {
    if (env.creds === undefined) return { ok: false, reason: "missing-creds" };
    return { ok: true, value: env };
  }
  return { ok: false, reason: "unsupported-envelope-version" };
}
