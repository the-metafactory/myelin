import type { SignedByEd25519, SigningIdentity } from "../identity/types";

// F-11: Agent capability discovery — KV-backed registry of agent
// capability advertisements signed by the agent's principal.
// See docs/design-agent-task-routing.md §Pattern 4 §Impact on L5
// Discovery, spec at .specify/specs/f-11-agent-capability-discovery/spec.md.

export type SovereigntyMode = "open" | "selective" | "strict" | "bidding";

export interface CapabilityAdvertisement {
  // R2 (vocabulary migration 2026-05, PR-9) — the actor-DID field was
  // renamed `principal` → `identity`. `advertisement` is signed canonical
  // content (`canonicalizeAdvertisement` JCS-serializes the whole object),
  // so this is a wire-breaking rename handled with the dual-field
  // transition: a pre-migration advertisement on the wire may still carry
  // the deprecated `principal` key. The transition reader
  // `readAdvertisementIdentity` resolves either key; a record carrying
  // BOTH is rejected with `dual_field_conflict`. myelin emits `identity`.
  identity: string;             // DID, e.g. "did:mf:luna"
  capabilities: string[];       // capability tags
  sovereignty: SovereigntyMode;
  load: number;                 // 0.0–1.0
  maxConcurrent: number;        // positive integer
  updatedAt: string;            // ISO-8601
}

export interface SignedCapabilityRegistration {
  advertisement: CapabilityAdvertisement;
  // Discovery layer is self-registration only — agent signs with own
  // ed25519 key. Hub-stamp not used here (hub-stamping a capability
  // claim is not meaningful — capabilities live with the agent).
  signed_by: SignedByEd25519;
}

export type CapabilityWatchOperation = "put" | "delete" | "purge";

export interface CapabilityWatchEntry {
  operation: CapabilityWatchOperation;
  key: string;                  // DID
  revision: number;
  registration?: SignedCapabilityRegistration;
}

export type CapabilityWatcher = AsyncIterable<CapabilityWatchEntry>;

export type CapabilityVerificationResult =
  // R2 (vocabulary migration 2026-05, PR-9) — `principal` → `identity` on
  // the verified result's resolved actor-DID.
  | { status: "verified"; identity: string; advertisement: CapabilityAdvertisement }
  | { status: "rejected"; reason: string };

// Re-export so consumers import everything discovery-related from one
// module without reaching into identity/types.
export type { SigningIdentity };
