import { verifyAsync } from "@noble/ed25519";
import type { MyelinEnvelope } from "../types";
import type { Principal, VerificationResult, SignedByEd25519, SignedByHubStamp } from "./types";
import type { PrincipalRegistry } from "./registry";
import { canonicalizeForSigning } from "./canonicalize";

const DEFAULT_CLOCK_SKEW_MS = 5 * 60 * 1000;
const ISO8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

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

  if (!ISO8601_RE.test(at)) {
    return Promise.resolve({ status: "rejected", reason: `invalid signed_by.at timestamp: "${at}"` });
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
    return verifyEd25519(envelope.signed_by as SignedByEd25519, envelope, principal);
  }

  if (method === "hub-stamp") {
    return verifyHubStamp(envelope.signed_by as SignedByHubStamp, envelope, principal, registry);
  }

  return Promise.resolve({ status: "rejected", reason: `unknown signing method: ${method}` });
}

async function verifyEd25519(
  signedBy: SignedByEd25519,
  envelope: MyelinEnvelope,
  principal: Principal,
): Promise<VerificationResult> {
  const signatureBytes = new Uint8Array(Buffer.from(signedBy.signature, "base64"));
  if (signatureBytes.length !== 64) {
    return { status: "rejected", reason: `ed25519 signature must be 64 bytes, got ${signatureBytes.length}` };
  }

  const publicKeyBytes = new Uint8Array(Buffer.from(principal.public_key, "base64"));
  if (publicKeyBytes.length !== 32) {
    return { status: "rejected", reason: `ed25519 public key must be 32 bytes, got ${publicKeyBytes.length}` };
  }

  try {
    const message = canonicalizeForSigning(envelope);
    const valid = await verifyAsync(signatureBytes, message, publicKeyBytes);
    if (!valid) {
      return { status: "rejected", reason: "ed25519 signature verification failed" };
    }
    return { status: "verified", principal, method: "ed25519" };
  } catch (err) {
    return { status: "rejected", reason: `ed25519 verification error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Hub-stamp: the hub signs the envelope with its own key, attesting the
 * principal's identity. Verification resolves the hub's public key from
 * the registry and checks the signature — same crypto as ed25519, but
 * the signing key belongs to the hub, not the agent.
 */
async function verifyHubStamp(
  signedBy: SignedByHubStamp,
  envelope: MyelinEnvelope,
  principal: Principal,
  registry: PrincipalRegistry,
): Promise<VerificationResult> {
  const trustedHubs = registry.trustedHubs();
  const hub = trustedHubs.find((h) => h.id === signedBy.stamped_by);

  if (!hub) {
    return { status: "rejected", reason: `hub-stamp from untrusted hub: ${signedBy.stamped_by}` };
  }

  const signatureBytes = new Uint8Array(Buffer.from(signedBy.signature, "base64"));
  if (signatureBytes.length !== 64) {
    return { status: "rejected", reason: `hub-stamp signature must be 64 bytes, got ${signatureBytes.length}` };
  }

  const hubKeyBytes = new Uint8Array(Buffer.from(hub.public_key, "base64"));
  if (hubKeyBytes.length !== 32) {
    return { status: "rejected", reason: `hub public key must be 32 bytes, got ${hubKeyBytes.length}` };
  }

  try {
    const message = canonicalizeForSigning(envelope);
    const valid = await verifyAsync(signatureBytes, message, hubKeyBytes);
    if (!valid) {
      return { status: "rejected", reason: "hub-stamp signature verification failed" };
    }
    return { status: "verified", principal, method: "hub-stamp" };
  } catch (err) {
    return { status: "rejected", reason: `hub-stamp verification error: ${err instanceof Error ? err.message : String(err)}` };
  }
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
