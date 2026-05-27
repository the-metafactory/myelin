import { signAsync, verifyAsync } from "@noble/ed25519";
import type { SigningIdentity } from "../identity/types";
import type { IdentityRegistry } from "../identity/registry";
import type { BidResponse } from "./types";
import { DID_RE, BASE64_RE, stampIdentityDid } from "../identity/types";
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
 * (`at`) and method/identity are tamper-evident. Uses the shared
 * src/jcs.ts canonicalizer for byte-for-byte determinism with envelope
 * and capability advertisement signing.
 *
 * myelin#182 — R2 breaking cut. The stamp DID key is `identity`; the
 * deprecated `principal` key was dropped from the wire. The canonicalizer
 * takes the `signed_by` object bytes-as-received, so the signature commits
 * to the canonical `identity` key. `verifyBidResponse` rejects a bid
 * carrying a `principal` key before any canonicalization runs.
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
    // myelin#182 — sign with the canonical `identity` key. The deprecated
    // `principal` key is no longer accepted on the wire (R2 breaking cut).
    signed_by: { method: "ed25519", identity: identity.did, signature: "", at },
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
  // myelin#182 — R2 breaking cut. The stamp DID field is `identity` only;
  // the deprecated `principal` key was dropped from the wire. A bid carrying
  // a `principal` key (with or without `identity`) is rejected outright at
  // this trust boundary, matching the envelope-level rule.
  const stampObj = bid.signed_by as unknown as Record<string, unknown>;
  if ("principal" in stampObj) {
    return {
      valid: false,
      reason:
        "signed_by carries the deprecated `principal` key — dropped from the wire in myelin#182. Emit `identity` instead.",
    };
  }
  const signerDid = stampIdentityDid(bid.signed_by);
  if (signerDid === undefined) {
    return { valid: false, reason: "signed_by is missing identity (no `identity` key)" };
  }
  if (bid.bidder !== signerDid) {
    return { valid: false, reason: `bidder/identity mismatch: ${bid.bidder} vs ${signerDid}` };
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

  const identity = registry.resolve(bid.bidder);
  if (!identity) {
    return { valid: false, reason: `unknown identity '${bid.bidder}' (not in registry)` };
  }
  const pubKey = bytesFromBase64(identity.public_key);
  if (pubKey.length !== 32) {
    return { valid: false, reason: `identity public key wrong length (${pubKey.length})` };
  }
  const sigBytes = bytesFromBase64(bid.signed_by.signature);
  const bytes = canonicalBidPayload(bid);
  const ok = await verifyAsync(sigBytes, bytes, pubKey);
  if (!ok) return { valid: false, reason: "signature verification failed" };
  return { valid: true, principal: bid.bidder };
}
