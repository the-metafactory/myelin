import { describe, it, expect } from "bun:test";
import { verifyChainSovereignty } from "./chain";
import type { SovereigntyPolicy } from "../types";
import type { MyelinEnvelope } from "../../types";
import type { SignedBy } from "../../identity/types";

function stamp(principal: string): SignedBy {
  return {
    method: "ed25519",
    principal,
    signature: "x",
    at: "2026-05-11T00:00:00Z",
  };
}

function envelope(chain: SignedBy[]): MyelinEnvelope {
  return {
    id: "550e8400-e29b-41d4-a716-446655440099",
    source: "operator-b.echo.federated",
    type: "tasks.code-review",
    timestamp: "2026-05-11T00:00:00Z",
    sovereignty: {
      classification: "federated",
      data_residency: "CH",
      max_hop: 4,
      frontier_ok: false,
      model_class: "any",
    },
    signed_by: chain,
    payload: {},
  };
}

const basePolicy: SovereigntyPolicy = {
  version: 1,
  org: "metafactory",
  egress: { block_local_escape: true, rules: [] },
  ingress: {
    scope_mappings: [
      {
        partner_org: "operator-b",
        imported_principals: ["did:mf:echo", "did:mf:forge"],
        local_scope: ["federated.operator-b.tasks.>"],
        max_capabilities: ["code-review"],
      },
      {
        partner_org: "operator-c",
        imported_principals: ["did:mf:gamma"],
        local_scope: ["federated.operator-c.tasks.>"],
        max_capabilities: ["search"],
      },
    ],
    reject_unknown_partners: true,
  },
  chain_of_stamps: { verify_delegation_sovereignty: true },
};

describe("verifyChainSovereignty", () => {
  describe("feature flag", () => {
    it("returns ALLOW immediately when flag is off", () => {
      const policy: SovereigntyPolicy = {
        ...basePolicy,
        chain_of_stamps: { verify_delegation_sovereignty: false },
      };
      // Even with a chain that would fail under the flag, off means skip.
      const env = envelope([stamp("did:mf:rogue"), stamp("did:mf:also-rogue")]);
      expect(verifyChainSovereignty(env, policy).valid).toBe(true);
    });
  });

  describe("flag on — single-stamp envelopes", () => {
    it("returns ALLOW for a one-element chain (last-stamp check handles it)", () => {
      const env = envelope([stamp("did:mf:echo")]);
      expect(verifyChainSovereignty(env, basePolicy).valid).toBe(true);
    });

    it("returns ALLOW even for unknown principal in a one-element chain", () => {
      // T-6.1 is specifically about delegation chains. A single
      // unknown principal is handled by the existing last-stamp
      // ingress check; chain validator shouldn't double-reject.
      const env = envelope([stamp("did:mf:rogue")]);
      expect(verifyChainSovereignty(env, basePolicy).valid).toBe(true);
    });
  });

  describe("flag on — multi-stamp chains", () => {
    it("allows a chain where every principal has a scope mapping", () => {
      const env = envelope([
        stamp("did:mf:echo"),
        stamp("did:mf:gamma"),
        stamp("did:mf:forge"),
      ]);
      expect(verifyChainSovereignty(env, basePolicy).valid).toBe(true);
    });

    it("rejects chain with unknown principal at position 0", () => {
      const env = envelope([stamp("did:mf:rogue"), stamp("did:mf:echo")]);
      const result = verifyChainSovereignty(env, basePolicy);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.code).toBe("compliance-block:chain-invalid");
        expect(result.reason).toContain("stamp 0");
        expect(result.reason).toContain("did:mf:rogue");
      }
    });

    it("rejects chain with unknown principal in the middle", () => {
      const env = envelope([
        stamp("did:mf:echo"),
        stamp("did:mf:rogue"),
        stamp("did:mf:gamma"),
      ]);
      const result = verifyChainSovereignty(env, basePolicy);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.code).toBe("compliance-block:chain-invalid");
        expect(result.reason).toContain("stamp 1");
        expect(result.reason).toContain("did:mf:rogue");
      }
    });

    it("rejects chain with unknown principal at the end (last position)", () => {
      const env = envelope([stamp("did:mf:echo"), stamp("did:mf:rogue")]);
      const result = verifyChainSovereignty(env, basePolicy);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.code).toBe("compliance-block:chain-invalid");
        expect(result.reason).toContain("stamp 1");
      }
    });

    it("reports the FIRST invalid stamp when multiple are unknown", () => {
      const env = envelope([
        stamp("did:mf:echo"),
        stamp("did:mf:rogue-a"),
        stamp("did:mf:rogue-b"),
      ]);
      const result = verifyChainSovereignty(env, basePolicy);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain("stamp 1");
        expect(result.reason).toContain("did:mf:rogue-a");
        expect(result.reason).not.toContain("rogue-b");
      }
    });
  });

  describe("flag on — permissive mode (reject_unknown_partners=false)", () => {
    const permissive: SovereigntyPolicy = {
      ...basePolicy,
      ingress: { ...basePolicy.ingress, reject_unknown_partners: false },
    };

    it("allows chain with unknown principals when permissive", () => {
      const env = envelope([
        stamp("did:mf:echo"),
        stamp("did:mf:rogue"),
        stamp("did:mf:gamma"),
      ]);
      expect(verifyChainSovereignty(env, permissive).valid).toBe(true);
    });

    it("allows a fully-unknown chain when permissive", () => {
      const env = envelope([stamp("did:mf:rogue-a"), stamp("did:mf:rogue-b")]);
      expect(verifyChainSovereignty(env, permissive).valid).toBe(true);
    });
  });

  describe("flag on — chain length bounds", () => {
    it("rejects empty chain", () => {
      const env = envelope([]);
      const result = verifyChainSovereignty(env, basePolicy);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.code).toBe("compliance-block:chain-invalid");
        expect(result.reason).toContain("empty");
      }
    });

    it("rejects chain longer than MAX_CHAIN_LENGTH (16)", () => {
      const chain = Array.from({ length: 17 }, (_, i) => stamp(`did:mf:echo-${i}`));
      const env = envelope(chain);
      const result = verifyChainSovereignty(env, basePolicy);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.code).toBe("compliance-block:chain-invalid");
        expect(result.reason).toContain("MAX_CHAIN_LENGTH");
        expect(result.reason).toContain("17");
      }
    });

    it("accepts chain at exactly MAX_CHAIN_LENGTH (16)", () => {
      // All 16 stamps from the same known principal — sovereignty
      // doesn't care about chain shape, just per-stamp mapping presence.
      const chain = Array.from({ length: 16 }, () => stamp("did:mf:echo"));
      const env = envelope(chain);
      expect(verifyChainSovereignty(env, basePolicy).valid).toBe(true);
    });
  });

  describe("integration shape", () => {
    it("returns a frozen ALLOW literal on the happy path (no per-call allocation)", () => {
      const env = envelope([stamp("did:mf:echo"), stamp("did:mf:gamma")]);
      const a = verifyChainSovereignty(env, basePolicy);
      const b = verifyChainSovereignty(env, basePolicy);
      expect(a).toBe(b);
    });
  });
});
