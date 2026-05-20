import { verifyAsync } from "@noble/ed25519";
import type { MyelinEnvelope } from "../types";
import type {
  Identity,
  IdentityType,
  SignedBy,
  SignedByEd25519,
  SignedByHubStamp,
  StampRole,
  StampVerdict,
  VerificationResult,
} from "./types";
import type { PrincipalRegistry } from "./registry";
import { canonicalizeForChainStamp } from "./canonicalize";
import { getSignedByChain } from "./chain";
import { bytesFromBase64 } from "../base64";

const DEFAULT_CLOCK_SKEW_MS = 5 * 60 * 1000;
const ISO8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export interface VerifyOptions {
  clockSkewMs?: number;
}

/**
 * myelin#31 — chain-aware identity verification.
 *
 * Walks every stamp in `signed_by` and verifies it against:
 *   1. its declared principal in the registry,
 *   2. the canonical bytes the appender saw (prior chain + this stamp sans signature),
 *   3. the timestamp freshness window.
 *
 * The chain is verified iff every stamp passes. The returned result carries
 * a per-stamp verdict array so callers can introspect which hop failed.
 *
 * Single-stamp envelopes — either array form `[stamp]` or the legacy
 * object form `{ stamp }` — are accepted; the back-compat shim coerces
 * to a one-element chain.
 */
export async function verifyEnvelopeIdentity(
  envelope: MyelinEnvelope,
  registry: PrincipalRegistry,
  options?: VerifyOptions,
): Promise<VerificationResult> {
  const clockSkewMs = options?.clockSkewMs ?? DEFAULT_CLOCK_SKEW_MS;

  // Defensive: type excludes null, but parsed-untrusted-JSON can produce it.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (envelope.signed_by === undefined || envelope.signed_by === null) {
    return { status: "rejected", reason: "missing signed_by — unsigned envelopes are rejected" };
  }
  const chain = getSignedByChain(envelope);
  if (chain.length === 0) {
    return { status: "rejected", reason: "signed_by is empty — at least one stamp required" };
  }

  // Normalize the envelope's signed_by to array form so canonicalizeForChainStamp
  // sees a consistent shape regardless of single-object back-compat input.
  const normalizedEnvelope: MyelinEnvelope = { ...envelope, signed_by: chain };

  const verdicts: StampVerdict[] = [];
  const now = Date.now();

  for (const [i, stamp] of chain.entries()) {
    const verdict = await verifyStamp(
      stamp,
      i,
      normalizedEnvelope,
      registry,
      now,
      clockSkewMs,
    );
    verdicts.push(verdict);
    if (!verdict.valid) {
      return {
        status: "rejected",
        reason: `stamp[${i}] (${stamp.principal}): ${verdict.reason ?? "unknown failure"}`,
        chain: verdicts,
      };
    }
  }

  // Every stamp verified — return the last stamp's principal/method as the
  // convenience handle for legacy single-stamp callers. chain.length > 0 is
  // enforced above, and verdicts.push runs once per stamp, so verdicts.at(-1)
  // is non-null. Every verified verdict has principal/method populated
  // (StampVerdict isn't a discriminated union, so TS can't see the invariant).
  /* eslint-disable @typescript-eslint/no-non-null-assertion */
  const last = verdicts.at(-1)!;
  return {
    status: "verified",
    principal: last.principal!,
    method: last.method!,
    chain: verdicts,
  };
  /* eslint-enable @typescript-eslint/no-non-null-assertion */
}

async function verifyStamp(
  stamp: SignedBy,
  index: number,
  envelope: MyelinEnvelope,
  registry: PrincipalRegistry,
  now: number,
  clockSkewMs: number,
): Promise<StampVerdict> {
  const principalDid = stamp.principal;
  const principal = registry.resolve(principalDid);
  if (!principal) {
    return { index, valid: false, reason: `unknown principal: ${principalDid}` };
  }

  const at = stamp.at;
  if (typeof at !== "string" || !ISO8601_RE.test(at)) {
    return { index, valid: false, principal, reason: `invalid signed_by.at timestamp: "${at}"` };
  }
  const signedAt = new Date(at).getTime();
  if (!Number.isFinite(signedAt)) {
    return { index, valid: false, principal, reason: `unparseable signed_by.at timestamp: "${at}"` };
  }
  if (Math.abs(now - signedAt) > clockSkewMs) {
    return {
      index,
      valid: false,
      principal,
      reason: `timestamp outside tolerance: signed_by.at=${at}, skew=${Math.abs(now - signedAt)}ms > ${clockSkewMs}ms`,
    };
  }

  if (stamp.method === "ed25519") {
    return verifyEd25519(stamp, index, envelope, principal);
  }
  // After ed25519 narrows out, the union collapses to "hub-stamp" — but
  // keep the explicit check so a future-added method falls through to the
  // "unknown signing method" branch rather than being misrouted.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (stamp.method === "hub-stamp") {
    return verifyHubStamp(stamp, index, envelope, principal, registry);
  }
  return {
    index,
    valid: false,
    principal,
    reason: `unknown signing method: ${(stamp as { method: string }).method}`,
  };
}

async function verifyEd25519(
  stamp: SignedByEd25519,
  index: number,
  envelope: MyelinEnvelope,
  principal: Identity,
): Promise<StampVerdict> {
  const signatureBytes = bytesFromBase64(stamp.signature);
  if (signatureBytes.length !== 64) {
    return {
      index,
      valid: false,
      principal,
      method: "ed25519",
      reason: `ed25519 signature must be 64 bytes, got ${signatureBytes.length}`,
    };
  }
  const publicKeyBytes = bytesFromBase64(principal.public_key);
  if (publicKeyBytes.length !== 32) {
    return {
      index,
      valid: false,
      principal,
      method: "ed25519",
      reason: `ed25519 public key must be 32 bytes, got ${publicKeyBytes.length}`,
    };
  }
  try {
    const message = canonicalizeForChainStamp(envelope, index);
    const valid = await verifyAsync(signatureBytes, message, publicKeyBytes);
    if (!valid) {
      return {
        index,
        valid: false,
        principal,
        method: "ed25519",
        reason: "ed25519 signature verification failed",
      };
    }
    return { index, valid: true, principal, method: "ed25519" };
  } catch (err) {
    return {
      index,
      valid: false,
      principal,
      method: "ed25519",
      reason: `ed25519 verification error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function verifyHubStamp(
  stamp: SignedByHubStamp,
  index: number,
  envelope: MyelinEnvelope,
  principal: Identity,
  registry: PrincipalRegistry,
): Promise<StampVerdict> {
  const trustedHubs = registry.trustedHubs();
  const hub = trustedHubs.find((h) => h.id === stamp.stamped_by);
  if (!hub) {
    return {
      index,
      valid: false,
      principal,
      method: "hub-stamp",
      reason: `hub-stamp from untrusted hub: ${stamp.stamped_by}`,
    };
  }
  const signatureBytes = bytesFromBase64(stamp.signature);
  if (signatureBytes.length !== 64) {
    return {
      index,
      valid: false,
      principal,
      method: "hub-stamp",
      reason: `hub-stamp signature must be 64 bytes, got ${signatureBytes.length}`,
    };
  }
  const hubKeyBytes = bytesFromBase64(hub.public_key);
  if (hubKeyBytes.length !== 32) {
    return {
      index,
      valid: false,
      principal,
      method: "hub-stamp",
      reason: `hub public key must be 32 bytes, got ${hubKeyBytes.length}`,
    };
  }
  try {
    const message = canonicalizeForChainStamp(envelope, index);
    const valid = await verifyAsync(signatureBytes, message, hubKeyBytes);
    if (!valid) {
      return {
        index,
        valid: false,
        principal,
        method: "hub-stamp",
        reason: "hub-stamp signature verification failed",
      };
    }
    return { index, valid: true, principal, method: "hub-stamp" };
  } catch (err) {
    return {
      index,
      valid: false,
      principal,
      method: "hub-stamp",
      reason: `hub-stamp verification error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export interface RequireVerifiedIdentityOptions extends VerifyOptions {
  /** Minimum chain length required (default 1). */
  minLength?: number;
  /** Require at least one stamp with this role anywhere in the chain. */
  mustIncludeRole?: StampRole;
  /** Require at least one stamp whose principal has this type (`agent`, `service`, `operator`). */
  mustIncludePrincipalType?: IdentityType;
  /** Require a stamp by this exact principal DID anywhere in the chain. */
  mustIncludePrincipal?: string;
}

/**
 * Convenience wrapper. Verifies the chain, then enforces chain-shape
 * predicates supplied in `options`. Returns the LAST verified principal
 * on success — that's the most recent attestor and the one consumers
 * typically authenticate against (e.g. F-5 ingress scope mapping).
 *
 * Throws `Error("Identity verification failed: ...")` on any failure,
 * including predicate failures (e.g. "mustIncludeRole=accountability").
 */
export async function requireVerifiedIdentity(
  envelope: MyelinEnvelope,
  registry: PrincipalRegistry,
  options?: RequireVerifiedIdentityOptions,
): Promise<Identity> {
  const result = await verifyEnvelopeIdentity(envelope, registry, options);
  if (result.status !== "verified") {
    throw new Error(`Identity verification failed: ${result.reason}`);
  }
  const chain = result.chain;
  const minLength = options?.minLength ?? 1;
  if (chain.length < minLength) {
    throw new Error(
      `Identity verification failed: chain length ${chain.length} < required ${minLength}`,
    );
  }
  if (options?.mustIncludeRole !== undefined) {
    const role = options.mustIncludeRole;
    const chainRoles = getSignedByChain(envelope).map((s) => s.role);
    if (!chainRoles.includes(role)) {
      throw new Error(
        `Identity verification failed: chain does not include role=${role}`,
      );
    }
  }
  if (options?.mustIncludePrincipalType !== undefined) {
    const type = options.mustIncludePrincipalType;
    if (!chain.some((v) => v.principal?.type === type)) {
      throw new Error(
        `Identity verification failed: chain does not include principal of type=${type}`,
      );
    }
  }
  if (options?.mustIncludePrincipal !== undefined) {
    const did = options.mustIncludePrincipal;
    if (!chain.some((v) => v.principal?.id === did)) {
      throw new Error(
        `Identity verification failed: chain does not include principal=${did}`,
      );
    }
  }
  return result.principal;
}
