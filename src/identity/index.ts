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
