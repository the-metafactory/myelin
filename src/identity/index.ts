export { DID_RE, BASE64_RE } from "./types";

// Vocabulary migration (2026-05) — re-exported types. `Identity` /
// `IdentityType` are canonical; `Principal` / `PrincipalType` remain
// available as deprecated aliases (see types.ts) so external importers
// (cortex, pilot, signal) compile unchanged through the next major.
// The two deprecated re-exports below intentionally suppress the
// no-deprecated rule — re-exporting an alias IS the public-API
// back-compat hook this PR delivers.
/* eslint-disable @typescript-eslint/no-deprecated */
export type {
  Identity,
  IdentityType,
  Principal,
  PrincipalType,
  SignedBy,
  SignedByEd25519,
  SignedByHubStamp,
  SigningIdentity,
  SigningMethod,
  StampRole,
  StampVerdict,
  VerificationResult,
} from "./types";
/* eslint-enable @typescript-eslint/no-deprecated */

// R1 (vocabulary migration 2026-05) — `PrincipalRegistry` /
// `PrincipalRegistryFile` were renamed to `IdentityRegistry` /
// `IdentityRegistryFile`. The deprecated aliases are re-exported so
// external importers (discovery, bidding, cortex) compile unchanged
// through the transition; re-exporting a deprecated alias IS the
// public-API back-compat hook, hence the rule suppression.
export type { IdentityRegistry, IdentityRegistryFile } from "./registry";
/* eslint-disable @typescript-eslint/no-deprecated */
export type { PrincipalRegistry, PrincipalRegistryFile } from "./registry";
/* eslint-enable @typescript-eslint/no-deprecated */
export { createInMemoryRegistry, loadRegistry } from "./registry";

export { canonicalizeForSigning, canonicalizeForChainStamp } from "./canonicalize";
export { signEnvelope } from "./sign";
export type { SignEnvelopeOptions } from "./sign";
export { verifyEnvelopeIdentity, requireVerifiedIdentity } from "./verify";
export type { VerifyOptions, RequireVerifiedIdentityOptions } from "./verify";
export {
  toSignedByChain,
  getSignedByChain,
  normalizeSignedBy,
  getLastStampPrincipal,
  MAX_CHAIN_LENGTH,
} from "./chain";
