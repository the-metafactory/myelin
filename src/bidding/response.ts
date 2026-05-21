import { signAsync, verifyAsync } from "@noble/ed25519";
import type { SigningIdentity } from "../identity/types";
import type { IdentityRegistry } from "../identity/registry";
import type { BidResponse } from "./types";
import { DID_RE, BASE64_RE } from "../identity/types";
import { canonicalStringify } from "../jcs";
import { bytesToBase64, bytesFromBase64 } from "../base64";

export interface CreateBidResponseInput {
  task_id: string;
  bidder: string;
  load: number;
  capability_match: number;
  cost?: number;
  constraints?: string[];
}

/**
 * Canonical signing payload for a bid response. Mirrors the envelope
 * signing contract from src/identity/canonicalize.ts: include every
 * field of `signed_by` EXCEPT the signature itself, so the timestamp
 * (`at`) and method/principal are tamper-evident. Uses the shared
 * src/jcs.ts canonicalizer for byte-for-byte determinism with envelope
 * and capability advertisement signing.
 */
function canonicalBidPayload(bid: BidResponse): Uint8Array {
  const { signature, ...signedByForSigning } = bid.signed_by;
  void signature;
  const signable: Record<string, unknown> = {
    task_id: bid.task_id,
    bidder: bid.bidder,
    load: bid.load,
    capability_match: bid.capability_match,
    signed_by: signedByForSigning,
    ...(bid.cost !== undefined ? { cost: bid.cost } : {}),
    ...(bid.constraints ? { constraints: bid.constraints } : {}),
  };
  return new TextEncoder().encode(canonicalStringify(signable));
}

function assertRange01(name: string, n: number): void {
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw new Error(`${name} must be in [0, 1] (got ${n})`);
  }
}

export async function signBidResponse(
  input: CreateBidResponseInput,
  identity: SigningIdentity,
): Promise<BidResponse> {
  if (!DID_RE.test(input.bidder)) {
    throw new Error(`signBidResponse: invalid bidder DID '${input.bidder}'`);
  }
  if (input.bidder !== identity.did) {
    throw new Error(`signBidResponse: bidder (${input.bidder}) must match identity.did (${identity.did})`);
  }
  assertRange01("load", input.load);
  assertRange01("capability_match", input.capability_match);
  if (input.cost !== undefined && (!Number.isFinite(input.cost) || input.cost < 0)) {
    throw new Error(`signBidResponse: cost must be non-negative finite number (got ${input.cost})`);
  }

  const at = new Date().toISOString();
  const draft: BidResponse = {
    task_id: input.task_id,
    bidder: input.bidder,
    load: input.load,
    capability_match: input.capability_match,
    ...(input.cost !== undefined ? { cost: input.cost } : {}),
    ...(input.constraints ? { constraints: [...input.constraints] } : {}),
    signed_by: { method: "ed25519", principal: identity.did, signature: "", at },
  };
  const bytes = canonicalBidPayload(draft);
  const privKey = bytesFromBase64(identity.privateKey);
  if (privKey.length !== 32) {
    throw new Error(`signBidResponse: expected 32-byte private key (got ${privKey.length})`);
  }
  const signature = await signAsync(bytes, privKey);

  return {
    ...draft,
    signed_by: { ...draft.signed_by, signature: bytesToBase64(signature) },
  };
}

export type BidVerificationResult =
  | { valid: true; principal: string }
  | { valid: false; reason: string };

export async function verifyBidResponse(
  bid: BidResponse,
  registry: IdentityRegistry,
): Promise<BidVerificationResult> {
  if (bid.bidder !== bid.signed_by.principal) {
    return { valid: false, reason: `bidder/principal mismatch: ${bid.bidder} vs ${bid.signed_by.principal}` };
  }
  if (!DID_RE.test(bid.bidder)) {
    return { valid: false, reason: `invalid bidder DID '${bid.bidder}'` };
  }
  if (bid.signed_by.method !== "ed25519") {
    return { valid: false, reason: `unsupported signing method '${bid.signed_by.method}'` };
  }
  if (!BASE64_RE.test(bid.signed_by.signature)) {
    return { valid: false, reason: "signature is not valid base64" };
  }

  const principal = registry.resolve(bid.bidder);
  if (!principal) {
    return { valid: false, reason: `unknown principal '${bid.bidder}' (not in registry)` };
  }
  const pubKey = bytesFromBase64(principal.public_key);
  if (pubKey.length !== 32) {
    return { valid: false, reason: `principal public key wrong length (${pubKey.length})` };
  }
  const sigBytes = bytesFromBase64(bid.signed_by.signature);
  const bytes = canonicalBidPayload(bid);
  const ok = await verifyAsync(sigBytes, bytes, pubKey);
  if (!ok) return { valid: false, reason: "signature verification failed" };
  return { valid: true, principal: bid.bidder };
}
