export type {
  SovereigntyMode,
  CapabilityAdvertisement,
  SignedCapabilityRegistration,
  CapabilityWatchOperation,
  CapabilityWatchEntry,
  CapabilityWatcher,
  CapabilityVerificationResult,
  SigningIdentity,
} from "./types";

export { canonicalizeAdvertisement } from "./canonicalize";

export {
  signCapabilityRegistration,
  registerCapabilities,
  updateLoad,
} from "./register";

export { verifyCapabilityRegistration } from "./verify";

// R2 (vocabulary migration 2026-05, PR-9) — dual-field transition reader
// for the `advertisement.principal` → `.identity` rename. Consumers
// replaying pre-migration capability registrations MUST read the actor-DID
// through this accessor.
export { readAdvertisementIdentity } from "./advertisement-identity";

export type { CapabilityStore } from "./store";

export { InMemoryCapabilityStore } from "./memory-store";
