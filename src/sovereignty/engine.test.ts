import { describe, it, expect } from "bun:test";
import { createSovereigntyEngine } from "./engine";
import { createInMemoryPolicyStore } from "./policy-store";
import type { AuditEntry, SovereigntyPolicy } from "./types";
import type { AuditLog } from "./audit-log";
import type { MyelinEnvelope } from "../types";

const policy: SovereigntyPolicy = {
  version: 1,
  network: "metafactory",
  egress: {
    block_local_escape: true,
    rules: [
      { classification: "local", allowed_subjects: ["local.metafactory.>"] },
      {
        classification: "federated",
        allowed_subjects: ["federated.metafactory.>", "federated.principal-b.>"],
        data_residency_constraints: { CH: ["federated.ch.>", "federated.metafactory.>"] },
      },
      { classification: "public", allowed_subjects: ["public.>"] },
    ],
  },
  ingress: {
    scope_mappings: [
      {
        partner_network: "principal-b",
        imported_principals: ["did:mf:echo"],
        local_scope: ["federated.principal-b.tasks.>"],
        max_capabilities: ["code-review"],
      },
    ],
    reject_unknown_partners: true,
  },
  chain_of_stamps: { verify_delegation_sovereignty: false },
};

function envelope(classification: "local" | "federated" | "public", residency = "CH", principal?: string): MyelinEnvelope {
  return {
    id: "550e8400-e29b-41d4-a716-446655440005",
    source: "metafactory.echo.local",
    type: "tasks.code-review",
    timestamp: "2026-05-10T00:00:00Z",
    sovereignty: { classification, data_residency: residency, max_hop: 0, frontier_ok: false, model_class: "any" },
    payload: {},
    ...(principal
      ? { signed_by: [{ method: "ed25519" as const, identity: principal, signature: "x", at: "2026-05-10T00:00:00Z" }] }
      : {}),
  };
}

describe("SovereigntyEngine", () => {
  it("validateEgress blocks local-escape via block_local_escape fast-path", () => {
    const engine = createSovereigntyEngine({ policyStore: createInMemoryPolicyStore({ initial: policy }) });
    const result = engine.validateEgress(envelope("local"), "federated.metafactory.tasks.review");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("compliance-block:classification-mismatch");
  });

  it("validateEgress allows local envelope to local subject in allowed list", () => {
    const engine = createSovereigntyEngine({ policyStore: createInMemoryPolicyStore({ initial: policy }) });
    expect(engine.validateEgress(envelope("local"), "local.metafactory.tasks.review").valid).toBe(true);
  });

  it("validateEgress enforces residency", () => {
    const engine = createSovereigntyEngine({ policyStore: createInMemoryPolicyStore({ initial: policy }) });
    const result = engine.validateEgress(envelope("federated", "CH"), "federated.principal-b.tasks");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("compliance-block:residency-violation");
  });

  it("validateIngress accepts known principal in scope", () => {
    const engine = createSovereigntyEngine({ policyStore: createInMemoryPolicyStore({ initial: policy }) });
    const result = engine.validateIngress(envelope("federated", "CH", "did:mf:echo"), "federated.principal-b.tasks.review");
    expect(result.valid).toBe(true);
  });

  it("validateIngress rejects unknown principal", () => {
    const engine = createSovereigntyEngine({ policyStore: createInMemoryPolicyStore({ initial: policy }) });
    const result = engine.validateIngress(envelope("federated", "CH", "did:mf:rogue"), "federated.principal-b.tasks.review");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("compliance-block:unknown-principal");
  });

  it("getPolicyStore returns the underlying store", () => {
    const store = createInMemoryPolicyStore({ initial: policy });
    const engine = createSovereigntyEngine({ policyStore: store });
    expect(engine.getPolicyStore()).toBe(store);
  });

  it("validateEgress fails fast-closed when policy not loaded", () => {
    const store = createInMemoryPolicyStore();
    const engine = createSovereigntyEngine({ policyStore: store });
    expect(() => engine.validateEgress(envelope("local"), "local.metafactory.tasks")).toThrow(/fail-closed/);
  });
});

class CapturingAuditLog implements AuditLog {
  readonly entries: AuditEntry[] = [];
  throwOnEmit = false;

  emit(entry: AuditEntry): void {
    if (this.throwOnEmit) throw new Error("audit-emit-bug");
    this.entries.push(entry);
  }
  async close(): Promise<void> {}
}

const fixedNow = () => new Date("2026-05-11T12:00:00Z");

describe("SovereigntyEngine + AuditLog (T-7.1 wire-in)", () => {
  it("emits allow + egress entry when validation passes", () => {
    const audit = new CapturingAuditLog();
    const engine = createSovereigntyEngine({
      policyStore: createInMemoryPolicyStore({ initial: policy }),
      auditLog: audit,
      now: fixedNow,
    });
    const result = engine.validateEgress(envelope("local"), "local.metafactory.tasks.review");
    expect(result.valid).toBe(true);
    expect(audit.entries.length).toBe(1);
    const e = audit.entries[0]!;
    expect(e.direction).toBe("egress");
    expect(e.decision).toBe("allow");
    expect(e.subject).toBe("local.metafactory.tasks.review");
    expect(e.classification).toBe("local");
    expect(e.data_residency).toBe("CH");
    expect(e.envelope_id).toBe("550e8400-e29b-41d4-a716-446655440005");
    expect(e.reason).toBeUndefined();
    expect(e.reason_code).toBeUndefined();
    expect(e.identity).toBeUndefined();
    expect(e.timestamp).toBe("2026-05-11T12:00:00.000Z");
  });

  it("emits block + egress entry with reason + reason_code on block", () => {
    const audit = new CapturingAuditLog();
    const engine = createSovereigntyEngine({
      policyStore: createInMemoryPolicyStore({ initial: policy }),
      auditLog: audit,
      now: fixedNow,
    });
    const result = engine.validateEgress(envelope("local"), "federated.metafactory.tasks.review");
    expect(result.valid).toBe(false);
    const e = audit.entries[0]!;
    expect(e.direction).toBe("egress");
    expect(e.decision).toBe("block");
    expect(e.reason_code).toBe("compliance-block:classification-mismatch");
    expect(e.reason).toContain("block_local_escape");
  });

  it("emits allow + ingress entry including principal when envelope is signed", () => {
    const audit = new CapturingAuditLog();
    const engine = createSovereigntyEngine({
      policyStore: createInMemoryPolicyStore({ initial: policy }),
      auditLog: audit,
      now: fixedNow,
    });
    const result = engine.validateIngress(
      envelope("federated", "CH", "did:mf:echo"),
      "federated.principal-b.tasks.review",
    );
    expect(result.valid).toBe(true);
    const e = audit.entries[0]!;
    expect(e.direction).toBe("ingress");
    expect(e.decision).toBe("allow");
    expect(e.identity).toBe("did:mf:echo");
    expect(e.subject).toBe("federated.principal-b.tasks.review");
  });

  it("emits block + ingress entry with unknown-principal code", () => {
    const audit = new CapturingAuditLog();
    const engine = createSovereigntyEngine({
      policyStore: createInMemoryPolicyStore({ initial: policy }),
      auditLog: audit,
      now: fixedNow,
    });
    const result = engine.validateIngress(
      envelope("federated", "CH", "did:mf:rogue"),
      "federated.principal-b.tasks.review",
    );
    expect(result.valid).toBe(false);
    const e = audit.entries[0]!;
    expect(e.direction).toBe("ingress");
    expect(e.decision).toBe("block");
    expect(e.reason_code).toBe("compliance-block:unknown-principal");
    expect(e.identity).toBe("did:mf:rogue");
  });

  it("returns the validation result even when auditLog.emit throws synchronously", () => {
    const audit = new CapturingAuditLog();
    audit.throwOnEmit = true;
    const errors: { err: Error; entry: AuditEntry }[] = [];
    const engine = createSovereigntyEngine({
      policyStore: createInMemoryPolicyStore({ initial: policy }),
      auditLog: audit,
      now: fixedNow,
      onAuditError: (err, entry) => errors.push({ err, entry }),
    });
    const result = engine.validateEgress(envelope("local"), "local.metafactory.tasks.review");
    expect(result.valid).toBe(true);
    expect(errors.length).toBe(1);
    expect(errors[0]!.err.message).toBe("audit-emit-bug");
    expect(errors[0]!.entry.decision).toBe("allow");
  });

  it("operates without auditLog (no emit, no throw)", () => {
    const engine = createSovereigntyEngine({
      policyStore: createInMemoryPolicyStore({ initial: policy }),
    });
    expect(() => engine.validateEgress(envelope("local"), "local.metafactory.tasks.review")).not.toThrow();
  });

  it("emits exactly one entry per validation call", () => {
    const audit = new CapturingAuditLog();
    const engine = createSovereigntyEngine({
      policyStore: createInMemoryPolicyStore({ initial: policy }),
      auditLog: audit,
      now: fixedNow,
    });
    engine.validateEgress(envelope("local"), "local.metafactory.tasks");
    engine.validateIngress(envelope("federated", "CH", "did:mf:echo"), "federated.principal-b.tasks.review");
    expect(audit.entries.length).toBe(2);
    expect(audit.entries[0]!.direction).toBe("egress");
    expect(audit.entries[1]!.direction).toBe("ingress");
  });

  it("validateIngress runs the chain-of-stamps validator when verify_delegation_sovereignty is on (T-6.1)", () => {
    // Regression guard for the chain validator wire-up in engine.ts.
    // If the three-line chain-first-then-ingress block is removed or
    // bypassed, this test fails because the audit entry would carry
    // `unknown-principal` from the last-stamp ingress check instead of
    // `chain-invalid` from the chain walk.
    const chainPolicy: SovereigntyPolicy = {
      ...policy,
      chain_of_stamps: { verify_delegation_sovereignty: true },
    };
    const audit = new CapturingAuditLog();
    const engine = createSovereigntyEngine({
      policyStore: createInMemoryPolicyStore({ initial: chainPolicy }),
      auditLog: audit,
      now: fixedNow,
    });
    const multiStamp: MyelinEnvelope = {
      id: "550e8400-e29b-41d4-a716-446655440099",
      source: "principal-b.stack-b.echo",
      type: "tasks.code-review",
      timestamp: "2026-05-10T00:00:00Z",
      sovereignty: {
        classification: "federated",
        data_residency: "CH",
        max_hop: 4,
        frontier_ok: false,
        model_class: "any",
      },
      signed_by: [
        { method: "ed25519", identity: "did:mf:rogue", signature: "x", at: "2026-05-10T00:00:00Z" },
        { method: "ed25519", identity: "did:mf:echo", signature: "y", at: "2026-05-10T00:00:00Z" },
      ],
      payload: {},
    };
    const result = engine.validateIngress(multiStamp, "federated.principal-b.tasks.review");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("compliance-block:chain-invalid");
    expect(audit.entries.length).toBe(1);
    expect(audit.entries[0]!.reason_code).toBe("compliance-block:chain-invalid");
    expect(audit.entries[0]!.decision).toBe("block");
  });
});
