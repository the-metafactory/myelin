import { describe, it, expect } from "bun:test";
import { createEnvelope, validateEnvelope } from "./envelope";
import type { CreateEnvelopeInput, Economics } from "./types";

const baseInput: CreateEnvelopeInput = {
  source: "metafactory.cortex.operator",
  type: "task.code-review",
  sovereignty: { classification: "local", data_residency: "CH", max_hop: 0, frontier_ok: false, model_class: "any" },
  payload: {},
};

function withEcon(economics: Economics) {
  return createEnvelope({ ...baseInput, economics });
}

describe("createEnvelope — economics", () => {
  it("includes economics when provided", () => {
    const env = withEcon({ wallet: "did:mf:ops-team" });
    expect(env.economics?.wallet).toBe("did:mf:ops-team");
  });

  it("omits economics when not provided", () => {
    const env = createEnvelope(baseInput);
    expect(env.economics).toBeUndefined();
  });
});

describe("validateEnvelope — economics", () => {
  it("accepts an empty economics object", () => {
    const env = withEcon({});
    expect(validateEnvelope(env).valid).toBe(true);
  });

  it("accepts a fully populated economics block", () => {
    const env = withEcon({
      budget: { max_tokens: 50000, max_cost_usd: 0.5 },
      actual: {
        input_tokens: 12500,
        output_tokens: 3200,
        total_tokens: 15700,
        model: "claude-sonnet-4",
        duration_ms: 45000,
        cost_usd: 0.12,
      },
      wallet: "did:mf:ops-team",
      billing_ref: "INV-2026-05-001",
      currency: "USD",
    });
    expect(validateEnvelope(env).valid).toBe(true);
  });

  describe("budget", () => {
    it("rejects max_tokens that is not a positive integer", () => {
      const env = withEcon({ budget: { max_tokens: 0 } });
      const res = validateEnvelope(env);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.field === "economics.budget.max_tokens")).toBe(true);
    });

    it("rejects negative max_cost_usd", () => {
      const env = withEcon({ budget: { max_cost_usd: -1 } });
      expect(validateEnvelope(env).valid).toBe(false);
    });

    it("rejects non-integer max_tokens", () => {
      const env = withEcon({ budget: { max_tokens: 1.5 } });
      expect(validateEnvelope(env).valid).toBe(false);
    });

    it("accepts max_cost_usd = 0", () => {
      expect(validateEnvelope(withEcon({ budget: { max_cost_usd: 0 } })).valid).toBe(true);
    });

    it("rejects budget that is not an object", () => {
      const env = withEcon({ budget: "10000" as unknown as never });
      expect(validateEnvelope(env).valid).toBe(false);
    });
  });

  describe("actual", () => {
    it("rejects negative input_tokens", () => {
      const env = withEcon({ actual: { input_tokens: -1 } });
      expect(validateEnvelope(env).valid).toBe(false);
    });

    it("rejects non-integer total_tokens", () => {
      const env = withEcon({ actual: { total_tokens: 1.7 } });
      expect(validateEnvelope(env).valid).toBe(false);
    });

    it("rejects model with uppercase letters", () => {
      const env = withEcon({ actual: { model: "Claude-Sonnet" } });
      const res = validateEnvelope(env);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.field === "economics.actual.model")).toBe(true);
    });

    it("rejects model starting with digit", () => {
      const env = withEcon({ actual: { model: "4o-mini" } });
      expect(validateEnvelope(env).valid).toBe(false);
    });

    it("accepts model with hyphens", () => {
      expect(validateEnvelope(withEcon({ actual: { model: "claude-sonnet-4-5" } })).valid).toBe(true);
    });

    it("rejects negative cost_usd", () => {
      expect(validateEnvelope(withEcon({ actual: { cost_usd: -0.01 } })).valid).toBe(false);
    });

    it("does NOT enforce total_tokens consistency with input + output", () => {
      // Hubs aggregate across delegate chains; arithmetic relationship doesn't hold.
      const env = withEcon({ actual: { input_tokens: 10, output_tokens: 5, total_tokens: 100 } });
      expect(validateEnvelope(env).valid).toBe(true);
    });
  });

  describe("wallet", () => {
    it("accepts valid DID", () => {
      expect(validateEnvelope(withEcon({ wallet: "did:mf:ops-team" })).valid).toBe(true);
    });

    it("rejects non-DID string", () => {
      const res = validateEnvelope(withEcon({ wallet: "ops-team" }));
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.field === "economics.wallet")).toBe(true);
    });

    it("rejects DID with consecutive hyphens (DID_RE invariant)", () => {
      expect(validateEnvelope(withEcon({ wallet: "did:mf:hub--metafactory" })).valid).toBe(false);
    });
  });

  describe("billing_ref", () => {
    it("accepts strings up to 256 chars", () => {
      expect(validateEnvelope(withEcon({ billing_ref: "INV-2026-05-001" })).valid).toBe(true);
      expect(validateEnvelope(withEcon({ billing_ref: "x".repeat(256) })).valid).toBe(true);
    });

    it("rejects strings over 256 chars", () => {
      expect(validateEnvelope(withEcon({ billing_ref: "x".repeat(257) })).valid).toBe(false);
    });
  });

  describe("currency", () => {
    it("accepts ISO 4217 codes", () => {
      expect(validateEnvelope(withEcon({ currency: "USD" })).valid).toBe(true);
      expect(validateEnvelope(withEcon({ currency: "CHF" })).valid).toBe(true);
      expect(validateEnvelope(withEcon({ currency: "EUR" })).valid).toBe(true);
    });

    it("rejects lowercase", () => {
      expect(validateEnvelope(withEcon({ currency: "usd" })).valid).toBe(false);
    });

    it("rejects wrong length", () => {
      expect(validateEnvelope(withEcon({ currency: "US" })).valid).toBe(false);
      expect(validateEnvelope(withEcon({ currency: "USDC" })).valid).toBe(false);
    });
  });

  describe("forward compatibility", () => {
    it("ignores unknown fields inside economics", () => {
      const env = withEcon({ wallet: "did:mf:ops-team", future_field: "value" });
      expect(validateEnvelope(env).valid).toBe(true);
    });

    it("ignores unknown fields inside budget", () => {
      const env = withEcon({ budget: { max_tokens: 1000, future_constraint: "foo" } });
      expect(validateEnvelope(env).valid).toBe(true);
    });

    it("ignores unknown fields inside actual", () => {
      const env = withEcon({ actual: { input_tokens: 100, future_metric: 42 } });
      expect(validateEnvelope(env).valid).toBe(true);
    });
  });

  it("rejects economics that is not an object", () => {
    const env = createEnvelope(baseInput);
    (env as unknown as { economics: unknown }).economics = "10000";
    expect(validateEnvelope(env).valid).toBe(false);
  });
});
