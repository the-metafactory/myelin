export { DID_RE, BASE64_RE } from "./types";

export type {
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

export type { PrincipalRegistry, PrincipalRegistryFile } from "./registry";
export { createInMemoryRegistry, loadRegistry } from "./registry";

export { canonicalizeForSigning, canonicalizeForChainStamp } from "./canonicalize";
export { signEnvelope } from "./sign";
export type { SignEnvelopeOptions } from "./sign";
export { verifyEnvelopeIdentity, requireVerifiedIdentity } from "./verify";
export type { VerifyOptions, RequireVerifiedIdentityOptions } from "./verify";
export { toSignedByChain, getSignedByChain, normalizeSignedBy } from "./chain";
