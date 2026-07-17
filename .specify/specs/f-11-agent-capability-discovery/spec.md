# Specification: F-11 — Agent Capability Discovery

## Context

> Generated in batch mode from decomposition phase
> Tracks: myelin#9 | Parent: myelin#7 (seven-layer model)
> Related: design-agent-task-routing.md (Pattern 4), myelin#31 (chain-of-stamps), cortex architecture §7

## Problem Statement

**Core Problem**: Agents have no runtime-queryable way to advertise capabilities. Task routing (Pattern 4) requires a capability registry so:

| Need | Current State | Impact |
|------|---------------|--------|
| Capability matching | Hardcoded subjects | Tasks route to wrong agents or nowhere |
| Dynamic discovery | None | New agents require redeployment of routers |
| Sovereignty declaration | Not advertised | No way to know agent will nak before delivery |
| Load visibility | Not exposed | Over-delivery to saturated agents |

**Urgency**: Pattern 4 (JetStream + Capability Registry) is DECIDED (2026-05-09). The `AGENT_CAPABILITIES` KV bucket IS the M5 Discovery seed — consumer lifecycle manager (cortex dispatch handler) depends on it existing.

**Impact if Unsolved**: Task routing remains hardcoded. Competing consumer pattern cannot dynamically match capabilities. Sovereignty modes invisible until nak.

## Users & Stakeholders

| Consumer | Need | Access Pattern |
|----------|------|----------------|
| Cortex dispatch handler | Watch capability changes → manage consumers | KV watch subscription |
| Task publishers | Query which agents can handle a capability | KV get/list |
| Agents (self) | Advertise capabilities on startup/change | KV put (signed) |
| Operators/admins | Audit capability landscape | KV list + read |
| Load balancers | Query agent load before routing | KV get + `load` field |

## Current State

**Existing Systems:**
- `TASKS` JetStream stream defined in design-agent-task-routing.md
- MyelinEnvelope with `signed_by` field (MY-400) for identity verification
- Chain-of-stamps mechanism (myelin#31) for signed attestation
- Cortex architecture §7.6 expects capability registry to exist

**What Exists:**
- NATS KV infrastructure available
- Principal identity model (`did:mf:<name>`) from MY-400
- Ed25519 signing infrastructure from MY-400

**What's Missing:**
- AGENT_CAPABILITIES KV bucket
- Capability advertisement schema
- Watcher contract specification
- Capability taxonomy

## Requirements

### Functional Requirements

| ID | Requirement | Source | Priority |
|----|-------------|--------|----------|
| FR-1 | Create `AGENT_CAPABILITIES` NATS KV bucket with agent DID as key | design-agent-task-routing.md §Pattern 4 | High |
| FR-2 | Define thin advertisement schema: capability tags, sovereignty mode, load, maxConcurrent, principal, updatedAt | design-agent-task-routing.md §Stratification | High |
| FR-3 | Capability tags as string array (e.g., `["code-review", "typescript"]`) | design-agent-task-routing.md §Pattern 4 | High |
| FR-4 | Sovereignty mode field: `open`, `selective`, `strict`, `bidding` | design-agent-task-routing.md §Sovereignty Modes | High |
| FR-5 | Load field as 0-1 float representing current utilization | design-agent-task-routing.md §Pattern 4 example | Medium |
| FR-6 | maxConcurrent field as integer representing task capacity | design-agent-task-routing.md §Pattern 4 example | Medium |
| FR-7 | KV writes are signed envelopes verifiable via chain-of-stamps | myelin#31, design-agent-task-routing.md §Implementation step 4 | High |
| FR-8 | Watcher contract: consumers subscribe to KV changes for agent join/leave/update | design-agent-task-routing.md §Pattern 4 | High |
| FR-9 | Define starter capability taxonomy vocabulary | design-agent-task-routing.md §Impact on L5 | Medium |
| FR-10 | Reject unsigned or invalid-signed capability registrations | Derived from FR-7 | High |

### Non-Functional Requirements

| ID | Requirement | Source |
|----|-------------|--------|
| NFR-1 | Thin advertisement only — rich profiles (tool inventory, env scope, network reach) stay at M7 | design-agent-task-routing.md §Stratification |
| NFR-2 | KV bucket must support watch semantics for real-time consumer lifecycle | NATS KV capability |
| NFR-3 | Update latency < 100ms from KV put to watcher notification | Operational: routing must react quickly |
| NFR-4 | Agent can update own capabilities without restart | Runtime flexibility |
| NFR-5 | Schema must be backwards-compatible for future field additions | Evolution safety |

## Capability Advertisement Schema

### KV Bucket Configuration

```typescript
// Bucket creation
const kv = await js.views.kv("AGENT_CAPABILITIES", {
  history: 5,              // Keep last 5 versions for debugging
  ttl: 0,                  // No TTL — explicit delete on agent shutdown
  max_value_size: 4096,    // Thin advertisement, not rich profiles
});
```

### Capability Advertisement (Thin)

```typescript
interface CapabilityAdvertisement {
  principal: string;                    // DID: "did:mf:luna"
  capabilities: string[];               // Tags: ["code-review", "typescript", "security-scan"]
  sovereignty: SovereigntyMode;         // How agent handles delivered tasks
  load: number;                         // 0.0-1.0, current utilization
  maxConcurrent: number;                // Max tasks agent will accept
  updatedAt: string;                    // ISO-8601 timestamp
}

type SovereigntyMode = "open" | "selective" | "strict" | "bidding";
```

**Field semantics:**

| Field | Description | Update Frequency |
|-------|-------------|------------------|
| `principal` | Agent's verified DID identity (immutable per registration) | Never (key) |
| `capabilities` | Capability tags this agent can handle | On agent capability change |
| `sovereignty` | Task acceptance behavior (see table below) | Rarely — configuration change |
| `load` | Current utilization [0,1] — 0.5 = 50% capacity used | Frequently — per task start/complete |
| `maxConcurrent` | Capacity limit — load = active/maxConcurrent | On configuration change |
| `updatedAt` | Last modification timestamp | Every update |

### Sovereignty Modes

| Mode | Behavior | When to Use |
|------|----------|-------------|
| `open` | Agent acks all delivered tasks | Simple workers, no filtering needed |
| `selective` | Agent evaluates payload, may nak | Most aPaaS agents |
| `strict` | Requires explicit capability + sovereignty match | High-trust tasks (security, deploy) |
| `bidding` | Agent publishes bid instead of claiming directly | High-value tasks needing selection optimization |

### Signed Registration Envelope

KV writes are signed envelopes per myelin#31 chain-of-stamps:

```typescript
interface SignedCapabilityRegistration {
  advertisement: CapabilityAdvertisement;
  signed_by: SignedBy;                  // From MY-400 identity spec
}

// SignedBy structure (from MY-400)
interface SignedBy {
  principal: string;                    // DID: "did:mf:luna"
  method: "ed25519";                    // Only ed25519 for agent self-registration
  signature: string;                    // Base64-encoded Ed25519 signature
  at: string;                           // ISO-8601 timestamp
}
```

**Verification rule:** Consumers MUST verify `signed_by.principal === advertisement.principal` and validate signature before trusting capability claims.

## Watcher Contract

### Subscription Pattern

```typescript
// Consumer (e.g., cortex dispatch handler) watches for changes
const watch = await kv.watch();

for await (const entry of watch) {
  switch (entry.operation) {
    case "PUT":
      // Agent joined or updated capabilities
      const reg = decode<SignedCapabilityRegistration>(entry.value);
      if (!verifySignature(reg)) {
        log.warn(`Invalid signature for ${entry.key}, ignoring`);
        continue;
      }
      await handleAgentUpdate(entry.key, reg.advertisement);
      break;
    
    case "DEL":
    case "PURGE":
      // Agent left — cleanup consumers if no other subscribers
      await handleAgentLeave(entry.key);
      break;
  }
}
```

### Consistency Guarantees

| Guarantee | Level | Notes |
|-----------|-------|-------|
| Ordering | Per-key | Updates to same agent key delivered in order |
| Delivery | At-least-once | Watchers may see duplicates on reconnect |
| Latency | Sub-100ms | NATS KV watch is push-based |
| Durability | JetStream-backed | Survives NATS restart |

### Consumer Lifecycle Events

| KV Event | Consumer Action |
|----------|-----------------|
| `PUT` (new key) | Agent joined — ensure filtered consumer exists for each capability |
| `PUT` (existing key) | Agent updated — reconcile consumer membership if capabilities changed |
| `DEL` / `PURGE` | Agent left — check if consumers still have other subscribers, cleanup if empty |

**[TO BE CLARIFIED]**: Consumer lifecycle manager ownership — spec states cortex owns this (§7.6), but the exact handoff contract between myelin KV and cortex consumer manager needs definition.

## Capability Taxonomy

### Starter Vocabulary

Per design-agent-task-routing.md §Impact on L5, a starter vocabulary prevents early fragmentation:

| Capability | Description | Example Agents |
|------------|-------------|----------------|
| `code-review` | Review code changes, provide feedback | Luna, Echo |
| `security-scan` | Security vulnerability analysis | Kai |
| `deploy` | Deploy artifacts to environments | Forge |
| `release` | Cut releases, tag versions | Forge |
| `test` | Run test suites | Luna |
| `build` | Build/compile artifacts | Forge |
| `document` | Generate documentation | Echo |

### Sub-capability Convention

Hierarchical capabilities via dot-notation:

```
code-review           → any code review
code-review.typescript → TypeScript-specific review
code-review.python     → Python-specific review
security-scan.sast     → Static analysis
security-scan.dast     → Dynamic analysis
deploy.cloudflare      → Cloudflare deployment
deploy.kubernetes      → K8s deployment
```

### Extension Model

Operators MAY define custom capabilities. Convention:
- Core vocabulary: single word or dotted hierarchy (`code-review`, `deploy.cloudflare`)
- Operator extensions: prefixed with operator namespace (`acme.compliance-check`)

**[TO BE CLARIFIED]**: Should capability taxonomy be defined in a separate registry (queryable) or convention-only (documented)?

## User Scenarios

### Scenario 1: Agent Self-Registration

- **Given** an agent "Luna" starts with capabilities `["code-review", "typescript"]`
- **When** Luna publishes a signed capability advertisement to KV
- **Then** the advertisement is stored at key `did:mf:luna`
- **And** watchers receive a PUT notification
- **And** the cortex dispatch handler ensures consumers exist for `code-review` and `typescript`

### Scenario 2: Dynamic Capability Update

- **Given** agent "Luna" is registered with `maxConcurrent: 3` and `load: 0.3`
- **When** Luna accepts a new task
- **Then** Luna publishes updated advertisement with `load: 0.6`
- **And** watchers receive update notification
- **And** load-aware routing considers Luna at 60% capacity

### Scenario 3: Agent Graceful Shutdown

- **Given** agent "Luna" is registered in KV
- **When** Luna shuts down gracefully
- **Then** Luna deletes its KV entry
- **And** watchers receive DEL notification
- **And** cortex dispatch handler checks if consumers need cleanup

### Scenario 4: Invalid Registration Rejected

- **Given** an attacker publishes advertisement claiming `principal: "did:mf:luna"`
- **When** the signature is verified against Luna's public key
- **Then** verification fails (signature doesn't match)
- **And** the registration is rejected
- **And** warning logged for security audit

### Scenario 5: Consumer Lifecycle on Capability Change

- **Given** agent "Luna" is registered with capabilities `["code-review"]`
- **When** Luna updates capabilities to `["code-review", "security-scan"]`
- **Then** watchers receive PUT notification
- **And** cortex dispatch handler adds Luna to `security-scan` consumer group
- **And** Luna can now receive security-scan tasks

## Edge Cases & Failure Modes

| Scenario | Expected Behavior |
|----------|-------------------|
| Agent crashes without cleanup | KV entry persists; operator manual cleanup or health-check TTL |
| KV watch disconnects | Watcher reconnects, replays from last seen revision |
| Signature verification fails | Registration rejected, warning logged |
| Unknown capability tag | Accepted (extensible vocabulary), but no matching consumers |
| Load exceeds 1.0 | Clamped to 1.0, warning logged |
| Duplicate PUT (idempotent) | Watchers may see twice, must handle idempotently |
| principal mismatch (signed_by.principal !== advertisement.principal) | Rejected — identity spoofing attempt |

## Success Criteria

**Definition of Done:**

1. [ ] `AGENT_CAPABILITIES` KV bucket created with specified config
2. [ ] `CapabilityAdvertisement` TypeScript type exported from `@the-metafactory/myelin`
3. [ ] `SignedCapabilityRegistration` type with chain-of-stamps integration
4. [ ] `registerCapabilities(advertisement, privateKey)` function — signs and publishes
5. [ ] `verifyCapabilityRegistration(registration)` function — validates signature
6. [ ] `watchCapabilities()` function — returns async iterator of capability changes
7. [ ] Capability taxonomy documented with starter vocabulary
8. [ ] Tests covering: register→watch round-trip, reject unsigned, reject spoofed principal, load update, graceful delete

**Integration Checkpoints:**

- [ ] MY-400 identity types imported (Principal, SignedBy)
- [ ] Chain-of-stamps (myelin#31) signing mechanism used
- [ ] Cortex dispatch handler can consume watch stream

## Scope

### In Scope

- AGENT_CAPABILITIES KV bucket schema and creation
- CapabilityAdvertisement type (thin advertisement)
- Signed registration envelope format
- Signature verification for registrations
- KV watcher contract specification
- Starter capability taxonomy vocabulary
- Agent self-registration functions
- Watch subscription utilities

### Explicitly Out of Scope

- **Rich capability profiles** (tool inventory, env scope, network reach) — M7 per §Stratification
- **Consumer lifecycle manager implementation** — cortex (M7) per design-agent-task-routing.md
- **Task routing implementation** — separate spec (uses this registry)
- **Orchestrator translation logic** — M7 per §Stratification
- **Agent compliance attestation** — M7 per §Stratification
- **Health-check TTL automation** — operational concern, future iteration
- **UI for capability management** — future iteration

## Decisions (Resolved 2026-05-09)

- **Crashed-agent cleanup:** KV TTL = 60s on each entry; agents renew (re-PUT) every 30s. Auto-cleanup on crash. NATS KV native TTL. Renewal interval ½ TTL avoids race on slow renew.
- **Capability taxonomy:** Convention-documented in spec (§Initial taxonomy). Operator-extensible. No runtime registry — preserves §Stratification thin-advertisement principle.
- **Consumer lifecycle handoff:** Cortex (M7) owns creation/deletion per Decision Q2 of design doc. Myelin only publishes KV PUT/DEL events; cortex watcher creates/destroys filtered JetStream consumers. Clean L5↔M7 boundary.

## Assumptions

- NATS KV watch semantics provide sub-100ms notification latency
- Ed25519 signing infrastructure from MY-400 is available
- Principal registry (MY-400) is deployed and queryable
- Cortex dispatch handler will be the primary watcher consumer
- Thin advertisement is sufficient — agents expose rich profiles via M7 if needed

---
*Generated: 2026-05-09 (batch mode)*
*Source: design-agent-task-routing.md §Pattern 4, §Stratification, §Impact on L5 Discovery*
