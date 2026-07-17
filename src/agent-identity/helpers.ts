import type { AgentIdentity } from "./types";
import type { Identity, SigningIdentity } from "../identity/types";

/**
 * F-7: minimal credentials view for envelope signing. Strips
 * everything except DID + private key.
 */
export function toSigningIdentity(identity: AgentIdentity): SigningIdentity {
  return { did: identity.did, privateKey: identity.private_key };
}

/**
 * F-7: public-only fragment for registry submission. Never carries
 * the private key — explicitly omitted in the return type.
 *
 * The Identity grammar requires `is_hub`. AgentIdentity is for
 * non-hub agents by default; pass `is_hub: true` if registering a
 * hub.
 */
export function toIdentity(identity: AgentIdentity, options: { is_hub?: boolean } = {}): Identity {
  return {
    id: identity.did,
    // Malformed DIDs may lack a third `:`-segment, so `split(":")[2]` can be
    // undefined (now enforced by noUncheckedIndexedAccess) — keep the fallback.
    network: identity.network ?? identity.did.split(":")[2] ?? "unknown",
    public_key: identity.public_key,
    type: "agent",
    created_at: identity.created_at,
    ...(identity.display_name ? { display_name: identity.display_name } : {}),
    ...(options.is_hub ? { is_hub: true } : {}),
  };
}

/**
 * @deprecated Renamed to `toIdentity` (R1, vocabulary migration 2026-05).
 * Kept as an alias for one minor so existing callers don't break; removed
 * in the next major.
 */
export const toPrincipal = toIdentity;

// F-11 self-registration (`registerSelf` / `RegisterSelfOptions`) was
// retired with the discovery pull-registry (cortex#234 item (c), epic
// myelin#286 Wave 3, RFC-0008 §7). The register-agent-identity flow no
// longer writes to a capability store — an agent's capabilities ride the
// presence wire (src/wire/capability presence fold-gate), not a pull
// registry. There is no replacement emit here: the removed call was
// `store.put`-only and published nothing to the wire.
