import { describe, it, expect } from "bun:test";
import { DID_RE } from "./types";
import type {
  Identity,
  SignedBy,
  VerificationResult,
} from "./types";

describe("identity types", () => {
  it("Identity type accepts valid agent", () => {
    const p: Identity = {
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

  it("Identity accepts hub flag", () => {
    const p: Identity = {
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
      signature: "A".repeat(88),
      at: "2026-05-07T12:00:00Z",
    };
    expect(s.method).toBe("hub-stamp");
    if (s.method === "hub-stamp") {
      expect(s.stamped_by).toBe("did:mf:hub.metafactory");
    }
  });

  it("VerificationResult — verified", () => {
    const principal = {
      id: "did:mf:echo",
      operator: "metafactory",
      public_key: "key",
      type: "agent" as const,
      created_at: "2026-05-07T00:00:00Z",
    };
    const r: VerificationResult = {
      status: "verified",
      principal,
      method: "ed25519",
      chain: [{ index: 0, valid: true, principal, method: "ed25519" }],
    };
    expect(r.status).toBe("verified");
    if (r.status === "verified") {
      expect(r.chain).toHaveLength(1);
    }
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

describe("DID_RE — `--` rejection (security boundary, F-019/myelin#44)", () => {
  // The wire-format encoding for principal-addressed task subjects collapses
  // `:` → `-` and `.` → `--`. To stay injective, source DIDs must not
  // contain consecutive hyphens — otherwise `did:mf:hub--metafactory` and
  // `did:mf:hub.metafactory` would both encode to `@did-mf-hub--metafactory`.
  it("rejects consecutive hyphens in method-specific-id", () => {
    expect(DID_RE.test("did:mf:hub--metafactory")).toBe(false);
  });

  it("accepts dotted msi (existing principal in docs/identity.md)", () => {
    expect(DID_RE.test("did:mf:hub.metafactory")).toBe(true);
  });

  it("accepts single-hyphen msi", () => {
    expect(DID_RE.test("did:mf:hub-metafactory")).toBe(true);
  });

  it("accepts simple msi", () => {
    expect(DID_RE.test("did:mf:forge")).toBe(true);
  });

  it("rejects single-character msi (must start with letter then have ≥1 more char)", () => {
    expect(DID_RE.test("did:mf:a")).toBe(false);
  });

  it("rejects msi starting with digit", () => {
    expect(DID_RE.test("did:mf:0foo")).toBe(false);
  });

  it("rejects msi with three consecutive hyphens", () => {
    expect(DID_RE.test("did:mf:foo---bar")).toBe(false);
  });

  it("accepts msi with non-adjacent hyphens", () => {
    expect(DID_RE.test("did:mf:foo-bar-baz")).toBe(true);
  });
});
