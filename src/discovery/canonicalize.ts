import type { CapabilityAdvertisement } from "./types";
import { canonicalStringify } from "../jcs";

// F-11: deterministic canonical byte representation of a capability
// advertisement for signing. RFC 8785 JCS rules live in src/jcs.ts —
// shared with identity/canonicalize.ts so a fix there propagates to all
// signed artifacts.

export function canonicalizeAdvertisement(advertisement: CapabilityAdvertisement): Uint8Array {
  return new TextEncoder().encode(canonicalStringify(advertisement));
}
