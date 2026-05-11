import { utils, getPublicKeyAsync } from "@noble/ed25519";
import type { AgentIdentity } from "./types";
import { BASE64_RE } from "../identity/types";
import { bytesToBase64 } from "../base64";

/**
 * F-7: rotate an AgentIdentity's keypair while keeping its DID and
 * other identifying fields.
 *
 * Use cases:
 *   - Scheduled key rotation policy.
 *   - Suspected key compromise (rotate, revoke prior pubkey out-of-band).
 *   - Migration from one Ed25519 generation library to another.
 *
 * The returned identity is the SAME agent (same DID, same capabilities,
 * same source_uri) with a fresh keypair. `previous_public_key` carries
 * the just-retired pubkey so verifiers/observers can:
 *   1. Accept envelopes signed under the prior key during a grace period.
 *   2. Reconstruct the rotation chain across snapshots.
 *
 * `rotated_at` is set on the new identity (the moment the new key
 * starts being valid); `created_at` is preserved from the original
 * (the agent itself hasn't been re-created).
 *
 * Persistence is intentionally separate — call `saveAgentIdentity`
 * yourself with whatever passphrase/path the deployment expects. The
 * helper produces the new in-memory identity only.
 */
export interface RotateAgentIdentityInput {
  current: AgentIdentity;
  /** Test injection: deterministic clock. Defaults to Date. */
  now?: () => Date;
}

export interface RotateAgentIdentityResult {
  /** New identity: fresh keypair, same DID, previous_public_key set. */
  identity: AgentIdentity;
  /** Convenience handle on the rotated-out pubkey (same value as identity.previous_public_key). */
  previous_public_key: string;
  /** Convenience handle on the rotation timestamp. */
  rotated_at: string;
}

export async function rotateAgentIdentity(
  input: RotateAgentIdentityInput,
): Promise<RotateAgentIdentityResult> {
  const { current } = input;
  if (!current || typeof current !== "object") {
    throw new Error("rotateAgentIdentity: current identity is required");
  }
  if (!BASE64_RE.test(current.public_key) || !BASE64_RE.test(current.private_key)) {
    throw new Error("rotateAgentIdentity: current identity has invalid public_key or private_key — refusing to rotate");
  }
  const privKey = utils.randomSecretKey();
  const pubKey = await getPublicKeyAsync(privKey);
  const newPublicBase64 = bytesToBase64(pubKey);
  // Reject the (astronomically unlikely) randomSecretKey collision —
  // rotating to the same pubkey is not a rotation.
  if (newPublicBase64 === current.public_key) {
    throw new Error("rotateAgentIdentity: generated keypair matched prior public_key — refusing degenerate rotation");
  }
  const now = input.now ?? (() => new Date());
  const rotated_at = now().toISOString();
  // Defensive copy of `capabilities` so a downstream `rotated.capabilities.push(...)`
  // does not mutate the original identity (`{...current}` shallow-copies the
  // top-level properties only — array values stay aliased). Matches the
  // pattern in `generateAgentIdentity`.
  const identity: AgentIdentity = {
    ...current,
    public_key: newPublicBase64,
    private_key: bytesToBase64(privKey),
    previous_public_key: current.public_key,
    rotated_at,
    capabilities: [...current.capabilities],
  };
  return { identity, previous_public_key: current.public_key, rotated_at };
}
