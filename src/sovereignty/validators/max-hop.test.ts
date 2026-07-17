import { describe, it, expect } from "bun:test";
import type { MyelinEnvelope } from "../../types";
import { enforceMaxHop, enforceMaxHopEnvelope } from "./max-hop";
import { createSovereigntyEngine } from "../engine";
import { createInMemoryPolicyStore } from "../policy-store";
import { testPolicy } from "../test-fixtures";

// myelin#260 (sovereignty engine 1/3, RFC-0005 §2.4 — max_hop forwarding TTL,
// grill D3). Fixtures copied verbatim from the RFC-0001 conformance pack
// (`specs/vectors/sovereignty/crossing.json`, kind `enforceMaxHop`); each vector
// id is cited in the test name. Pack not on myelin main → inlined, not imported.
//
// Token note: the pack spells the reject reason `max_hop_exceeded` (post-#233
// snake). This implementation keeps the current kebab spelling
// `max-hop-exceeded` — the snake flip is staged separately (myelin#233), and
// #260 is explicit: do not flip token spellings here.

describe("enforceMaxHop — RFC-0005 §2.4 conformance vectors", () => {
  it("max-hop/origin-only-direct-allow: max_hop 0, chain 1 → allow (0 forwards)", () => {
    expect(enforceMaxHop(0, 1)).toEqual({ valid: true, forwards: 0 });
  });

  it("max-hop/origin-only-forwarded-block: max_hop 0, chain 2 → reject (pack: max_hop_exceeded)", () => {
    expect(enforceMaxHop(0, 2)).toEqual({ valid: false, reason: "max-hop-exceeded" });
  });

  it("max-hop/within-ttl-allow: max_hop 2, chain 3 → allow (2 forwards, exactly at TTL)", () => {
    expect(enforceMaxHop(2, 3)).toEqual({ valid: true, forwards: 2 });
  });

  it("boundary: forwards == max_hop allowed, forwards == max_hop + 1 rejected", () => {
    expect(enforceMaxHop(1, 2)).toEqual({ valid: true, forwards: 1 });
    expect(enforceMaxHop(1, 3)).toEqual({ valid: false, reason: "max-hop-exceeded" });
  });
});

function envelopeWithChain(maxHop: number, stamps: number): MyelinEnvelope {
  return {
    id: "550e8400-e29b-41d4-a716-446655440260",
    source: "principal-b.stack-b.echo",
    type: "tasks.code-review",
    timestamp: "2026-07-17T00:00:00Z",
    sovereignty: {
      classification: "federated",
      data_residency: "CH",
      max_hop: maxHop,
      frontier_ok: false,
      model_class: "any",
    },
    signed_by: Array.from({ length: stamps }, (_, i) => ({
      method: "ed25519" as const,
      identity: i === 0 ? "did:mf:echo" : `did:mf:hop-${i}`,
      signature: "x",
      at: "2026-07-17T00:00:00Z",
    })),
    payload: {},
  };
}

describe("enforceMaxHopEnvelope — #260 acceptance: 1-stamp accept / 2-stamp reject at max_hop:0", () => {
  it("ACCEPTS a directly-signed 1-stamp envelope at max_hop:0", () => {
    expect(enforceMaxHopEnvelope(envelopeWithChain(0, 1))).toEqual({ valid: true });
  });

  it("REJECTS a 2-stamp (forwarded) envelope at max_hop:0", () => {
    const result = enforceMaxHopEnvelope(envelopeWithChain(0, 2));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("compliance-block:max-hop-exceeded");
  });

  it("defers on an unsigned (empty-chain) envelope — TTL owned by the ingress principal check", () => {
    const env = envelopeWithChain(0, 1);
    delete (env as { signed_by?: unknown }).signed_by;
    expect(enforceMaxHopEnvelope(env)).toEqual({ valid: true });
  });
});

describe("sovereignty engine — max_hop enforced on the ingress path (#260)", () => {
  const engine = createSovereigntyEngine({
    policyStore: createInMemoryPolicyStore({ initial: testPolicy }),
  });

  it("rejects a forwarded copy past its TTL before any scope work", () => {
    const result = engine.validateIngress(
      envelopeWithChain(0, 2),
      "federated.principal-b.tasks.review",
    );
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("compliance-block:max-hop-exceeded");
  });

  it("lets a within-TTL origin envelope through to a normal ALLOW", () => {
    // max_hop:0, 1 stamp → 0 forwards, passes the TTL. did:mf:echo is mapped and
    // `federated.principal-b.tasks.review` is inside its local_scope
    // (`federated.principal-b.tasks.>`) → the normal ingress decision ALLOWS.
    const result = engine.validateIngress(
      envelopeWithChain(0, 1),
      "federated.principal-b.tasks.review",
    );
    expect(result.valid).toBe(true);
  });
});
