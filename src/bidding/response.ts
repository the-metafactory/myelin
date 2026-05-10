import { signAsync, verifyAsync } from "@noble/ed25519";
import type { SigningIdentity } from "../identity/types";
import type { PrincipalRegistry } from "../identity/registry";
import type { BidResponse } from "./types";
import { DID_RE, BASE64_RE } from "../identity/types";

export interface CreateBidResponseInput {
  task_id: string;
  bidder: string;
  load: number;
  capability_match: number;
  cost?: number;
  constraints?: string[];
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function bytesFromBase64(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "base64"));
}

function canonicalBidPayload(input: Omit<BidResponse, "signed_by">): string {
  // Stable, deterministic JSON for signing — keys sorted, undefined dropped.
  const ordered: Record<string, unknown> = {};
  ordered.bidder = input.bidder;
  ordered.capability_match = input.capability_match;
  if (input.constraints !== undefined) ordered.constraints = input.constraints;
  if (input.cost !== undefined) ordered.cost = input.cost;
  ordered.load = input.load;
  ordered.task_id = input.task_id;
  return JSON.stringify(ordered, Object.keys(ordered).sort());
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

  const unsigned: Omit<BidResponse, "signed_by"> = {
    task_id: input.task_id,
    bidder: input.bidder,
    load: input.load,
    capability_match: input.capability_match,
    ...(input.cost !== undefined ? { cost: input.cost } : {}),
    ...(input.constraints ? { constraints: [...input.constraints] } : {}),
  };
  const payload = canonicalBidPayload(unsigned);
  const privKey = bytesFromBase64(identity.privateKey);
  if (privKey.length !== 32) {
    throw new Error(`signBidResponse: expected 32-byte private key (got ${privKey.length})`);
  }
  const signature = await signAsync(new TextEncoder().encode(payload), privKey);

  return {
    ...unsigned,
    signed_by: {
      method: "ed25519",
      principal: identity.did,
      signature: bytesToBase64(signature),
      at: new Date().toISOString(),
    },
  };
}

export type BidVerificationResult =
  | { valid: true; principal: string }
  | { valid: false; reason: string };

export async function verifyBidResponse(
  bid: BidResponse,
  registry: PrincipalRegistry,
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
  const { signed_by: _sig, ...rest } = bid;
  const payload = canonicalBidPayload(rest);
  const ok = await verifyAsync(sigBytes, new TextEncoder().encode(payload), pubKey);
  if (!ok) return { valid: false, reason: "signature verification failed" };
  return { valid: true, principal: bid.bidder };
}
