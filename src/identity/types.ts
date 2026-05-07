export const DID_RE = /^did:mf:[a-z][a-z0-9._-]+$/;
export const BASE64_RE = /^[A-Za-z0-9+/]+=*$/;

export type PrincipalType = "agent" | "service" | "operator";

export interface Principal {
  id: string;
  display_name?: string;
  operator: string;
  public_key: string;
  type: PrincipalType;
  created_at: string;
  is_hub?: boolean;
}

export type SigningMethod = "ed25519" | "hub-stamp";

export interface SignedByEd25519 {
  method: "ed25519";
  principal: string;
  signature: string;
  at: string;
}

export interface SignedByHubStamp {
  method: "hub-stamp";
  principal: string;
  stamped_by: string;
  at: string;
}

export type SignedBy = SignedByEd25519 | SignedByHubStamp;

export type VerificationResult =
  | { status: "verified"; principal: Principal; method: SigningMethod }
  | { status: "unverified"; reason: string }
  | { status: "rejected"; reason: string };
