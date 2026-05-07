export { DID_RE, BASE64_RE } from "./types";

export type {
  Principal,
  PrincipalType,
  SignedBy,
  SignedByEd25519,
  SignedByHubStamp,
  SigningMethod,
  VerificationResult,
} from "./types";

export type { PrincipalRegistry, PrincipalRegistryFile } from "./registry";
export { createInMemoryRegistry, loadRegistry } from "./registry";

export { canonicalizeForSigning } from "./canonicalize";
export { signEnvelope } from "./sign";
export { verifyEnvelopeIdentity, requireVerifiedIdentity } from "./verify";
export type { VerifyOptions } from "./verify";
