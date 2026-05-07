import { verifyAsync } from "@noble/ed25519";
import type { MyelinEnvelope } from "../types";
import type { Principal, VerificationResult, SigningMethod } from "./types";
import type { PrincipalRegistry } from "./registry";
import { canonicalizeForSigning } from "./canonicalize";

const DEFAULT_CLOCK_SKEW_MS = 5 * 60 * 1000;

export interface VerifyOptions {
  clockSkewMs?: number;
}

export function verifyEnvelopeIdentity(
  envelope: MyelinEnvelope,
  registry: PrincipalRegistry,
  options?: VerifyOptions,
): Promise<VerificationResult> {
  const clockSkewMs = options?.clockSkewMs ?? DEFAULT_CLOCK_SKEW_MS;

  if (!envelope.signed_by) {
    return Promise.resolve({ status: "rejected", reason: "missing signed_by — unsigned envelopes are rejected" });
  }

  const { principal: principalDid, method, at } = envelope.signed_by;

  const principal = registry.resolve(principalDid);
  if (!principal) {
    return Promise.resolve({ status: "rejected", reason: `unknown principal: ${principalDid}` });
  }

  const signedAt = new Date(at).getTime();
  const now = Date.now();
  if (Math.abs(now - signedAt) > clockSkewMs) {
    return Promise.resolve({
      status: "rejected",
      reason: `timestamp outside tolerance: signed_by.at=${at}, skew=${Math.abs(now - signedAt)}ms > ${clockSkewMs}ms`,
    });
  }

  if (method === "ed25519") {
    return verifyEd25519(envelope, principal);
  }

  if (method === "hub-stamp") {
    return verifyHubStamp(envelope, principal, registry);
  }

  return Promise.resolve({ status: "rejected", reason: `unknown signing method: ${method}` });
}

async function verifyEd25519(
  envelope: MyelinEnvelope,
  principal: Principal,
): Promise<VerificationResult> {
  const signedBy = envelope.signed_by!;
  if (signedBy.method !== "ed25519") {
    return { status: "rejected", reason: "expected ed25519 method" };
  }

  try {
    const message = canonicalizeForSigning(envelope);
    const signatureBytes = new Uint8Array(Buffer.from(signedBy.signature, "base64"));
    const publicKeyBytes = new Uint8Array(Buffer.from(principal.public_key, "base64"));

    const valid = await verifyAsync(signatureBytes, message, publicKeyBytes);
    if (!valid) {
      return { status: "rejected", reason: "ed25519 signature verification failed" };
    }

    return { status: "verified", principal, method: "ed25519" };
  } catch (err) {
    return { status: "rejected", reason: `ed25519 verification error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function verifyHubStamp(
  envelope: MyelinEnvelope,
  principal: Principal,
  registry: PrincipalRegistry,
): Promise<VerificationResult> {
  const signedBy = envelope.signed_by!;
  if (signedBy.method !== "hub-stamp") {
    return { status: "rejected", reason: "expected hub-stamp method" };
  }

  const trustedHubs = registry.trustedHubs();
  const hubDid = signedBy.stamped_by;
  const isTrusted = trustedHubs.some((h) => h.id === hubDid);

  if (!isTrusted) {
    return { status: "rejected", reason: `hub-stamp from untrusted hub: ${hubDid}` };
  }

  return { status: "verified", principal, method: "hub-stamp" };
}

export function requireVerifiedIdentity(
  envelope: MyelinEnvelope,
  registry: PrincipalRegistry,
  options?: VerifyOptions,
): Promise<Principal> {
  return verifyEnvelopeIdentity(envelope, registry, options).then((result) => {
    if (result.status !== "verified") {
      throw new Error(`Identity verification failed: ${result.reason}`);
    }
    return result.principal;
  });
}
