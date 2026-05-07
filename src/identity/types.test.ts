import { describe, it, expect } from "bun:test";
import type {
  Principal,
  PrincipalType,
  SignedBy,
  SignedByEd25519,
  SignedByHubStamp,
  SigningMethod,
  VerificationResult,
} from "./types";

describe("identity types", () => {
  it("Principal type accepts valid agent", () => {
    const p: Principal = {
      id: "did:mf:echo",
      display_name: "Echo",
      operator: "metafactory",
      public_key: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      type: "agent",
      created_at: "2026-05-07T00:00:00Z",
    };
    expect(p.id).toBe("did:mf:echo");
    expect(p.type).toBe("agent");
  });

  it("Principal accepts hub flag", () => {
    const p: Principal = {
      id: "did:mf:hub.metafactory",
      operator: "metafactory",
      public_key: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      type: "operator",
      created_at: "2026-05-07T00:00:00Z",
      is_hub: true,
    };
    expect(p.is_hub).toBe(true);
  });

  it("SignedBy discriminates on method — ed25519", () => {
    const s: SignedBy = {
      method: "ed25519",
      principal: "did:mf:echo",
      signature: "base64sig==",
      at: "2026-05-07T12:00:00Z",
    };
    expect(s.method).toBe("ed25519");
    if (s.method === "ed25519") {
      expect(s.signature).toBe("base64sig==");
    }
  });

  it("SignedBy discriminates on method — hub-stamp", () => {
    const s: SignedBy = {
      method: "hub-stamp",
      principal: "did:mf:echo",
      stamped_by: "did:mf:hub.metafactory",
      at: "2026-05-07T12:00:00Z",
    };
    expect(s.method).toBe("hub-stamp");
    if (s.method === "hub-stamp") {
      expect(s.stamped_by).toBe("did:mf:hub.metafactory");
    }
  });

  it("VerificationResult — verified", () => {
    const r: VerificationResult = {
      status: "verified",
      principal: {
        id: "did:mf:echo",
        operator: "metafactory",
        public_key: "key",
        type: "agent",
        created_at: "2026-05-07T00:00:00Z",
      },
      method: "ed25519",
    };
    expect(r.status).toBe("verified");
  });

  it("VerificationResult — unverified", () => {
    const r: VerificationResult = {
      status: "unverified",
      reason: "signed_by not present",
    };
    expect(r.status).toBe("unverified");
    if (r.status === "unverified") {
      expect(r.reason).toBe("signed_by not present");
    }
  });

  it("VerificationResult — rejected", () => {
    const r: VerificationResult = {
      status: "rejected",
      reason: "unknown principal",
    };
    expect(r.status).toBe("rejected");
  });
});
