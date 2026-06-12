import { describe, it, expect } from "bun:test";
import { findTrustedSubstrate, isSubstrateTrusted } from "./substrates";
import { testPolicy } from "./test-fixtures";
import type { SovereigntyPolicy, TrustedSubstrate } from "./types";

const ACCOUNT = "0123456789abcdef0123456789abcdef";

const cloudflare: TrustedSubstrate = {
  provider: "cloudflare",
  tenancy: ACCOUNT,
  roles: ["reflex-edge", "relay"],
  data_residency_accepted: true,
};

const withSubstrates: SovereigntyPolicy = {
  ...testPolicy,
  trusted_substrates: [cloudflare],
};

describe("isSubstrateTrusted (DD-122 / #192)", () => {
  it("deny-by-default: absent section trusts nothing", () => {
    expect("trusted_substrates" in testPolicy).toBe(false);
    expect(isSubstrateTrusted(testPolicy, "cloudflare", ACCOUNT, "reflex-edge")).toBe(false);
  });

  it("deny-by-default: empty section trusts nothing", () => {
    const policy = { ...testPolicy, trusted_substrates: [] };
    expect(isSubstrateTrusted(policy, "cloudflare", ACCOUNT, "reflex-edge")).toBe(false);
  });

  it("matching provider + tenancy + role is trusted", () => {
    expect(isSubstrateTrusted(withSubstrates, "cloudflare", ACCOUNT, "reflex-edge")).toBe(true);
    expect(isSubstrateTrusted(withSubstrates, "cloudflare", ACCOUNT, "relay")).toBe(true);
  });

  it("unmatched provider is denied", () => {
    expect(isSubstrateTrusted(withSubstrates, "aws", ACCOUNT, "reflex-edge")).toBe(false);
  });

  it("unmatched tenancy is denied — a declaration names ONE tenancy", () => {
    expect(isSubstrateTrusted(withSubstrates, "cloudflare", "someone-elses-account", "reflex-edge")).toBe(false);
  });

  it("unmatched role is denied even on a trusted provider+tenancy", () => {
    expect(isSubstrateTrusted(withSubstrates, "cloudflare", ACCOUNT, "scheduler")).toBe(false);
  });

  it("matching is exact string equality — no case folding, no wildcards", () => {
    expect(isSubstrateTrusted(withSubstrates, "Cloudflare", ACCOUNT, "reflex-edge")).toBe(false);
    expect(isSubstrateTrusted(withSubstrates, "cloudflare", ACCOUNT.toUpperCase(), "reflex-edge")).toBe(false);
    expect(isSubstrateTrusted(withSubstrates, "*", ACCOUNT, "reflex-edge")).toBe(false);
  });

  it("any matching entry suffices when several entries share a provider", () => {
    const policy: SovereigntyPolicy = {
      ...testPolicy,
      trusted_substrates: [
        { ...cloudflare, roles: ["relay"] },
        { ...cloudflare, roles: ["reflex-edge"], data_residency_accepted: false },
      ],
    };
    expect(isSubstrateTrusted(policy, "cloudflare", ACCOUNT, "reflex-edge")).toBe(true);
  });
});

describe("findTrustedSubstrate", () => {
  it("returns the matching entry so callers can assert data_residency_accepted", () => {
    const entry = findTrustedSubstrate(withSubstrates, "cloudflare", ACCOUNT, "reflex-edge");
    expect(entry).toEqual(cloudflare);
    expect(entry?.data_residency_accepted).toBe(true);
  });

  it("returns undefined on no match", () => {
    expect(findTrustedSubstrate(withSubstrates, "cloudflare", ACCOUNT, "scheduler")).toBeUndefined();
    expect(findTrustedSubstrate(testPolicy, "cloudflare", ACCOUNT, "reflex-edge")).toBeUndefined();
  });

  it("surfaces a transit-only declaration (data_residency_accepted: false) for the caller to reject", () => {
    const policy: SovereigntyPolicy = {
      ...testPolicy,
      trusted_substrates: [{ ...cloudflare, data_residency_accepted: false }],
    };
    // The substrate IS trusted for the role — but a payload-persisting
    // runtime (DD-122 point 4(a)) must check the flag and refuse.
    expect(isSubstrateTrusted(policy, "cloudflare", ACCOUNT, "reflex-edge")).toBe(true);
    expect(findTrustedSubstrate(policy, "cloudflare", ACCOUNT, "reflex-edge")?.data_residency_accepted).toBe(false);
  });
});
