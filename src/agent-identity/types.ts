import type { SigningIdentity } from "../identity/types";
import type { Principal } from "../identity/types";
import type { EncryptedPrivateKey } from "./encryption";

/**
 * F-7: agent-side identity. Holds the agent's full provenance —
 * Ed25519 keypair, source URI (where this agent came from), capability
 * tags it advertises (input to F-11 registerCapabilities), and a
 * created-at stamp.
 *
 * AgentIdentity is the local representation. Convert to:
 *   - SigningIdentity via toSigningIdentity() — minimal credentials
 *     for envelope signing.
 *   - Principal via toPrincipal() — public-only fragment for registry
 *     submission. Never carries the private key.
 */
export interface AgentIdentity {
  /** DID, e.g., "did:mf:luna". Must match identity DID_RE. */
  did: string;
  /** Human-readable name, used for logs and registry display. */
  display_name?: string;
  /** Source URI proving where this identity was provisioned (file://, https://, did://). */
  source_uri: string;
  /** Ed25519 public key, base64-encoded (32 bytes). */
  public_key: string;
  /** Ed25519 private key, base64-encoded (32 bytes). Sensitive. */
  private_key: string;
  /** Capability tags this agent advertises (F-11 vocabulary). */
  capabilities: string[];
  /** Operator/org owning this identity. */
  operator?: string;
  /** ISO-8601 instant the identity was generated. */
  created_at: string;
  /**
   * Base64 Ed25519 public key from the prior generation, set by
   * `rotateAgentIdentity`. Lets verifiers accept envelopes signed
   * just before the rotation, and lets observers reconstruct a
   * rotation chain across multiple snapshots. Absent on fresh
   * identities and on identities that have never been rotated.
   */
  previous_public_key?: string;
  /**
   * ISO-8601 instant the previous keypair was retired (the rotation
   * time). Set together with `previous_public_key`.
   */
  rotated_at?: string;
}

/**
 * On-disk file format for AgentIdentity. Version-tagged for schema
 * evolution; new fields land additively at the current version,
 * breaking changes bump the version.
 *
 *   v1 — plaintext: `identity` carries the full AgentIdentity shape
 *        including `private_key` in base64.
 *   v2 — encrypted-at-rest: `identity` carries everything EXCEPT
 *        `private_key`; the key lives in `private_key_encrypted`
 *        (see EncryptedPrivateKey in encryption.ts). Loading v2
 *        requires a passphrase.
 *
 * Callers consume AgentIdentity (in-memory, decrypted) in both
 * cases — the version difference is invisible past loadAgentIdentity.
 */
export type AgentIdentityFile = AgentIdentityFileV1 | AgentIdentityFileV2;

export interface AgentIdentityFileV1 {
  version: 1;
  identity: AgentIdentity;
}

export type AgentIdentityWithoutPrivateKey = Omit<AgentIdentity, "private_key">;

export interface AgentIdentityFileV2 {
  version: 2;
  identity: AgentIdentityWithoutPrivateKey;
  private_key_encrypted: EncryptedPrivateKey;
}

export type { SigningIdentity, Principal };
