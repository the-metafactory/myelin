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

export type { CapabilityStore } from "./store";

export { InMemoryCapabilityStore } from "./memory-store";
