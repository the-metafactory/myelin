import type { AgentIdentity } from "./types";
import type { Principal, SigningIdentity } from "../identity/types";
import type { CapabilityStore } from "../discovery/store";
import type { CapabilityAdvertisement, SovereigntyMode } from "../discovery/types";
import { registerCapabilities } from "../discovery/register";

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
 * The Principal grammar requires `is_hub`. AgentIdentity is for
 * non-hub agents by default; pass `is_hub: true` if registering a
 * hub.
 */
export function toPrincipal(identity: AgentIdentity, options: { is_hub?: boolean } = {}): Principal {
  return {
    id: identity.did,
    // Defensive: TS sees `split(":")[2]` as `string`, but malformed DIDs at runtime
    // could yield undefined — keep the "unknown" fallback.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    operator: identity.operator ?? identity.did.split(":")[2] ?? "unknown",
    public_key: identity.public_key,
    type: "agent",
    created_at: identity.created_at,
    ...(identity.display_name ? { display_name: identity.display_name } : {}),
    ...(options.is_hub ? { is_hub: true } : {}),
  };
}

export interface RegisterSelfOptions {
  /** Capability store from F-11 (in-memory or NATS-backed). */
  store: CapabilityStore;
  /** Sovereignty mode this agent advertises. */
  sovereignty: SovereigntyMode;
  /** Current load 0.0–1.0. Clamped by F-11 if out of range. */
  load: number;
  /** Max concurrent tasks. Positive integer. */
  maxConcurrent: number;
  /** ISO-8601 timestamp; defaults to now. */
  updatedAt?: string;
}

/**
 * F-7: self-registration helper. Builds a CapabilityAdvertisement
 * from this AgentIdentity (DID + capabilities) and the runtime values
 * (sovereignty, load, maxConcurrent), signs it with the identity's
 * private key, and puts it in the F-11 capability store. Single call
 * for the common "agent boots, registers itself" path.
 *
 * For agents that need to update load periodically, use the F-11
 * updateLoad helper directly.
 */
export async function registerSelf(
  identity: AgentIdentity,
  options: RegisterSelfOptions,
): Promise<void> {
  const advertisement: CapabilityAdvertisement = {
    principal: identity.did,
    capabilities: [...identity.capabilities],
    sovereignty: options.sovereignty,
    load: options.load,
    maxConcurrent: options.maxConcurrent,
    updatedAt: options.updatedAt ?? new Date().toISOString(),
  };
  await registerCapabilities(options.store, advertisement, toSigningIdentity(identity));
}
