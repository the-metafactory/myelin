# Specification: Sovereignty Policy Engine

## Context

> Generated via batch mode from decomposition phase
> Tracks: myelin#11, myelin#43 | Builds on: myelin#31 (chain-of-stamps, merged)
> Related: design-agent-task-routing.md §Stratification, §Decisions Q3

## Problem Statement

**Core Problem**: Federation enables cross-operator task routing, but without sovereignty enforcement:

| Risk | What happens |
|------|--------------|
| Local data leakage | `local`-classified envelopes escape org boundary |
| Principal scope hijacking | Operator-A agent inherits operator-B principal scope on `federated.tasks.>` |
| Policy bypass | Federated envelopes enter without org policy validation |
| Auditability gap | No trail when sovereignty blocks a message |

The namespace convention (`local.` vs `federated.` vs `public.`) defines maximum reach, but nothing enforces it. An agent could publish a `local`-classified envelope to a federated subject — NATS doesn't know the difference. Similarly, when federated tasks arrive, no mechanism validates that the incoming principal maps correctly to local scope.

**Urgency**: External regulation/contract deadlines drive timing. Federation is blocked until sovereignty is enforceable. The longer this waits, the more hardcoded trust assumptions accumulate.

**Impact if Unsolved**: Federation either blocked or unsafe. Data residency violations. Audit failures.

## Users & Stakeholders

**Primary Users**: System administrators and operations team members

| Stakeholder | Need | Enforcement point |
|-------------|------|-------------------|
| Operators | Ensure local data never leaves org boundary | L2 egress validation |
| Security teams | Audit who-blocked-what and why | Structured nak logs |
| Compliance | Data residency enforcement per jurisdiction | Policy rules |
| Federation partners | Trust that incoming agents have valid, scoped principals | Ingress validation |

## Current State

**Existing Systems:**
- Envelope `sovereignty` block: `classification`, `data_residency`, `max_hop`, `frontier_ok`, `model_class`
- Namespace convention: `local.{org}.*` (internal), `federated.{org}.*` (crosses boundaries), `public.*` (open)
- Chain-of-stamps (myelin#31): Cryptographic audit trail for delegation fan-out
- Identity layer (L4): `signed_by` with Ed25519/hub-stamp verification
- NATS leaf node topology: Hub-spoke model with leaf nodes per operator

**Gap**: The sovereignty block is descriptive, not enforced. Transport middleware doesn't validate subject/classification alignment. Federation ingress has no principal scope mapping.

## User Scenarios

### Scenario 1: Block Local Envelope from Leaving Org

- **Given** an agent publishes an envelope with `sovereignty.classification: "local"`
- **When** the envelope targets a federated subject (`federated.{org}.*`) or attempts to replicate via NATS leaf node
- **Then** the sovereignty policy engine blocks transmission and emits a structured nak with reason `compliance-block` plus audit entry

### Scenario 2: Validate Incoming Federated Envelope

- **Given** a federated envelope arrives from operator-B via NATS leaf node
- **When** the envelope claims a principal (`signed_by.principal: "did:mf:echo"`)
- **Then** the engine validates:
  1. Principal is known in operator-B's exported scope (NSC mapping)
  2. Principal's capabilities match what operator-B advertises
  3. Principal scope doesn't exceed what the federation agreement allows
- **And** mismatches result in `compliance-block` nak

### Scenario 3: Principal Scope Mapping on Federated Tasks

- **Given** agent from operator-A claims work on `federated.tasks.code-review`
- **When** the agent attempts to operate with operator-B's principal privileges
- **Then** the engine enforces that operator-A principals cannot inherit operator-B scopes
- **And** any attempt results in `compliance-block` nak with scope-mismatch reason

### Scenario 4: NSC Import/Export Contract Enforcement

- **Given** two operators establish a federation agreement
- **When** NSC (NATS Security Context) is imported/exported
- **Then** the engine enforces:
  1. Exported principal scopes match what the operator advertises
  2. Imported principals are mapped to local equivalents with constrained scope
  3. No transitive scope escalation (A→B→C doesn't grant A scope in C)

### Scenario 5: Chain-of-Stamps Sovereignty Verification

- **Given** a Delegate-mode task fans out across multiple agents (Pilot→Echo→Forge)
- **When** each hop adds a stamp to the `correlation_id` chain
- **Then** the engine verifies each stamp's principal had sovereignty to perform that action
- **And** any sovereignty violation breaks the chain and triggers `compliance-block`

## Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1 | Validate subject prefix matches envelope `sovereignty.classification` at publish time | High |
| FR-2 | Block `local`-classified envelopes from NATS subjects outside `local.{org}.*` | High |
| FR-3 | Validate federated envelopes against org policy at ingress (leaf node boundary) | High |
| FR-4 | Implement principal scope mapping for federation: map external DID to local constrained scope | High |
| FR-5 | Reject federated envelopes where `signed_by.principal` has no valid scope mapping | High |
| FR-6 | Emit `compliance-block` structured nak with reason details when sovereignty violated | High |
| FR-7 | Integrate with chain-of-stamps: verify each stamp's principal had sovereignty for its action | Medium |
| FR-8 | Support NSC import/export contract: define which principals/scopes are federated | Medium |
| FR-9 | Provide audit trail for all sovereignty decisions (block, allow, scope-constrained) | High |
| FR-10 | Allow policy rules per `data_residency` (e.g., CH data stays in CH infrastructure) | Medium |

## Non-Functional Requirements

| ID | Requirement | Source |
|----|-------------|--------|
| NFR-1 | Enforcement latency < 1ms per envelope (must not bottleneck hot publish path) | Performance |
| NFR-2 | Zero false positives: legitimate traffic must never be incorrectly blocked | Reliability |
| NFR-3 | Policy rules must be declarative (YAML/JSON), not hardcoded | Maintainability |
| NFR-4 | Audit log must be tamper-evident (append-only, hash-chained or JetStream-backed) | Compliance |
| NFR-5 | Fail-closed: if policy engine unavailable, reject rather than allow | Security |
| NFR-6 | Policy updates must take effect without service restart (hot reload) | Operations |

## Architecture Sketch

```
┌──────────────────────────────────────────────────────────────┐
│                     NATS Leaf Node Boundary                   │
├──────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌─────────────┐    ┌──────────────────────┐    ┌──────────┐ │
│  │ Agent       │───>│ Sovereignty Engine    │───>│ NATS     │ │
│  │ (publish)   │    │                        │    │ Publish  │ │
│  └─────────────┘    │ 1. Classification      │    └──────────┘ │
│                      │    match?              │                  │
│                      │ 2. Subject prefix      │                  │
│                      │    valid?              │                  │
│                      │ 3. Data residency OK?  │                  │
│                      └──────────────────────┘                  │
│                                │                                │
│                                │ violation?                    │
│                                ▼                                │
│                      ┌──────────────────────┐                  │
│                      │ compliance-block nak │                  │
│                      │ + audit log entry     │                  │
│                      └──────────────────────┘                  │
│                                                                │
├──────────────────────────────────────────────────────────────┤
│                     Federation Boundary                        │
├──────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌─────────────┐    ┌──────────────────────┐    ┌──────────┐ │
│  │ Federated   │───>│ Ingress Validation    │───>│ Local    │ │
│  │ Envelope    │    │                        │    │ Delivery │ │
│  │ (inbound)   │    │ 1. Principal known?    │    └──────────┘ │
│  └─────────────┘    │ 2. Scope mapping OK?   │                  │
│                      │ 3. Chain-of-stamps    │                  │
│                      │    valid?              │                  │
│                      └──────────────────────┘                  │
│                                                                │
└──────────────────────────────────────────────────────────────┘
```

## Policy Configuration Schema

```typescript
interface SovereigntyPolicy {
  version: 1;
  org: string;  // "metafactory"
  
  egress: {
    // Block local envelopes from leaving
    block_local_escape: boolean;  // default: true
    
    // Per-classification rules
    rules: Array<{
      classification: "local" | "federated" | "public";
      allowed_subjects: string[];  // glob patterns
      data_residency_constraints?: Record<string, string[]>;  // e.g., { "CH": ["local.*", "federated.ch.*"] }
    }>;
  };
  
  ingress: {
    // Federation partner → scope mapping
    scope_mappings: Array<{
      partner_org: string;           // "operator-b"
      imported_principals: string[]; // DIDs from partner
      local_scope: string[];         // what they can do here: ["tasks.code-review.*"]
      max_capabilities: string[];    // capability ceiling
    }>;
    
    // Reject unknown federation partners
    reject_unknown_partners: boolean;  // default: true
  };
  
  chain_of_stamps: {
    // Verify sovereignty at each hop
    verify_delegation_sovereignty: boolean;  // default: true
  };
}
```

## Integration Points

| Component | Integration |
|-----------|-------------|
| L2 Transport | Middleware hook for egress validation |
| L4 Identity | `signed_by` verification feeds sovereignty decisions |
| Chain-of-stamps (#31) | Verify each hop's principal sovereignty |
| NATS Leaf Node | Egress filter at leaf boundary |
| JetStream | Audit log stream (`_audit.sovereignty.>`) |
| NSC (NATS CLI) | Import/export scope definitions |

## Success Criteria

- [ ] `local`-classified envelopes cannot reach federated/public subjects (automated test)
- [ ] Federated envelopes with unknown principals are rejected at ingress
- [ ] Principal scope mapping correctly constrains external agents
- [ ] `compliance-block` nak includes machine-readable reason code
- [ ] Audit log captures all sovereignty decisions with envelope ID + principal + reason
- [ ] Policy hot-reload works without service restart
- [ ] Enforcement latency stays under 1ms p99 under load

## Out of Scope

- Authorization/RBAC (what a principal can do beyond sovereignty) — separate M7 concern
- Rate limiting / DDoS protection — separate concern
- Economic cost attribution — tracked via envelope `economics` field, not this engine
- Multi-tenancy within org (sub-org scope isolation) — future iteration

## Decisions (Resolved 2026-05-09)

- **NSC integration:** Use existing `nsc` CLI. Policy spec emits `nsc` commands; operators apply. Leverages NATS-native tooling, standard hardening path.
- **Policy distribution:** Centralized NATS KV bucket (`SOVEREIGNTY_POLICY`); engine watches, hot-reloads on update. Single source of truth, matches AGENT_CAPABILITIES pattern (F-11).
- **Audit retention:** 90 days, JetStream stream `_audit.sovereignty.>`. Operator-configurable. Compliance-grade window for incident review.
- **Missing-policy startup:** Fail closed — engine refuses to start without policy. No advisory mode. Operators must provision policy via KV before engine comes online.

## Assumptions

- NATS leaf node topology is already deployed (hub-spoke model)
- Chain-of-stamps (#31) is merged and functioning
- Identity layer (L4) provides reliable `signed_by` verification
- Operators have existing NSC/nkey tooling for credential management
- Policy violations are exceptional, not the common case (hot path is "allow")

---
*Generated: 2026-05-09 (batch mode)*
*Dependencies: myelin#31 (chain-of-stamps) — merged*
