# Design: Agent Task Routing — Capability-Based Competing Consumers

**Status:** Accepted (2026-05-09) — Pattern 4 chosen
**Layers:** L2 Transport, L5 Discovery, L6 Composition
**Related issues:** [#9](https://github.com/the-metafactory/myelin/issues/9) (L5 Discovery), [#10](https://github.com/the-metafactory/myelin/issues/10) (L6 Composition), [#11](https://github.com/the-metafactory/myelin/issues/11) (cross-layer sovereignty), [#31](https://github.com/the-metafactory/myelin/issues/31) (chain-of-stamps)
**Date:** 2026-05-08
**Cross-references:**
- *Cortex architecture spec* — [`the-metafactory/cortex/docs/architecture.md`](https://github.com/the-metafactory/cortex/blob/main/docs/architecture.md). §7 cross-references this document by name and builds cortex's M7 dispatch handler around the three distribution modes, event lifecycle, and stratification boundary defined here. §3.5 tracks namespace reconciliation. §9 specifies the agent + presence/renderer model that consumes the capability registry.
- *Event taxonomy & surface subscription contract* — `docs/design-event-taxonomy.md`, currently in flight as [grove-v2 PR #81](https://github.com/the-metafactory/grove-v2/pull/81), landing on the `the-metafactory/cortex` repo at migration. Sections referenced below: §1.1 (two paths — observability vs semantic), §6 (the pilot review loop instrumented as a worked example of Delegate-mode emission).
- *M7 attestation worked example* — Northpower's internal AI-agent governance standard ("STD-NPW-AI-001") covering twelve normative requirements: scoped service principals, prod-write prohibition, egress allow-listing, sandbox-by-default, tool/MCP supply-chain pinning, sub-agent trust floor, append-only session logs with threshold review, and similar concerns. The standard itself is a Northpower-internal artefact; it is cited here as a concrete instance of the *kind* of attestation surface M7 must host. The architectural argument does not depend on any reader being able to access the standard.

---

## Problem

The aPaaS vision requires agents to publish tasks that any qualified agent can claim. Today, task routing is hardcoded: a specific publisher targets a specific subscriber on a known subject. There is no mechanism for:

1. **Capability matching** — routing a task to agents that can actually handle it
2. **Competing consumers** — multiple qualified agents contending for the same task, with exactly one winning
3. **Sovereignty** — agents deciding autonomously whether to accept or refuse work
4. **Load distribution** — backpressure when an agent is at capacity

This document specifies the protocol primitives. It is **not** the complete picture of how work flows in the metafactory ecosystem — agent capability boundaries, orchestrator translation of operator intent, and compliance attestation live at M7 (see §Stratification below).

---

## Distribution modes

Three operator-facing modes of work delegation, all carried by the same protocol. Naming them upfront because the rest of the document describes mechanisms; the modes are the operator-facing semantics those mechanisms serve.

| Mode | Operator says | Wire shape | Worked example |
|---|---|---|---|
| **Broadcast** | *"Someone do this"* | `tasks.{capability}` + competing consumers | a backlog item posted to the team |
| **Direct** | *"Forge, cut a release"* | named-recipient subject (e.g. `tasks.@{principal}.{capability}`) or `target_principal` envelope field | one-shot hand-off |
| **Delegate** | *"Pilot, drive PR #32 to merge"* | same wire as Direct — the receiving agent internally orchestrates, fans out sub-tasks, emits a lifecycle stream | the pilot loop |

### Why Delegate is its own mode

From the bus's perspective, Delegate is structurally identical to Direct — same envelope, same routing. From the operator's perspective it is profoundly different: the commitment is to an **outcome**, not a task. The receiving agent (Pilot, in the canonical case) absorbs the multi-step coordination; the operator watches an event stream and steps in only on escalation.

This is the cognitive-load argument for building the stack at all: humans pair with AI by handing off outcomes, not by micro-coordinating task graphs. Without naming Delegate as a first-class mode, the design implies all routing is open-market (Broadcast) and the operator-facing benefit is invisible.

Delegate's auditability rides on chain-of-stamps ([myelin#31](https://github.com/the-metafactory/myelin/issues/31)): when the receiving agent fans out (Pilot → Echo for review → Forge for release), each sub-step's stamp accumulates on a shared `correlation_id`, producing a cryptographic trail of *who-did-what-under-whose-orchestration*.

### What this design covers

§Patterns below evaluates four mechanisms for the Broadcast mode (competing consumers). Direct and Delegate sit on top of any chosen mechanism — they are not separate patterns, they are subject-shape and observability conventions. §Event-driven lifecycle and §Stratification specify those conventions and the M7 boundary that hosts orchestrator policy.

---

## Patterns

The four patterns below evaluate **mechanisms for the Broadcast mode** — the open-market case where any qualified agent can claim. Direct and Delegate (per §Distribution modes) ride on top of any chosen mechanism via a subject-shape or envelope-field convention; they do not require a separate transport pattern. **Pattern 4 is chosen** (see §Decision); the Direct/Delegate conventions on top of it are specified in §Stratification and §Event-driven lifecycle.

### Pattern 1: Subject-Based Capability Routing

Encode capabilities directly in the NATS subject hierarchy. Agents subscribe to subjects matching their capabilities. Queue groups ensure exactly-one delivery among competing subscribers.

```
tasks.code-review.typescript    → agents with TS review capability
tasks.code-review.python        → agents with Python review capability
tasks.security-scan.*           → agents with any security scanning capability
tasks.deploy.cloudflare         → agents that can deploy to CF
```

Each capability subject gets a queue group so only one agent claims each task:

```typescript
// Agent "Luna" — code review + security capabilities
nc.subscribe("tasks.code-review.>", { queue: "workers" }, handler);
nc.subscribe("tasks.security-scan.>", { queue: "workers" }, handler);

// Agent "Fern" — code review on GitLab
nc.subscribe("tasks.code-review.>", { queue: "workers" }, handler);
```

**Layer mapping:**

| Layer | Role |
|---|---|
| L2 Transport | Queue groups provide competing-consumer semantics |
| L3 Envelope | Standard envelope wraps task payload |
| L5 Discovery | Implicit — capabilities encoded in subject hierarchy |

**Strengths:**
- Zero infrastructure beyond NATS core
- Subject hierarchy is a natural capability taxonomy
- Queue groups are a battle-tested NATS primitive

**Weaknesses:**
- No sovereignty: agents cannot evaluate a task before claiming it — NATS delivers, agent must handle
- Capability model is limited to what fits in a subject token hierarchy
- Same queue group name across different subjects creates a single pool — an agent subscribed to two subjects competes with agents on either, which can cause misrouting
- No persistence: if no subscriber is connected, the task is lost (core NATS is fire-and-forget)

**Verdict:** Sufficient for static, small agent pools with simple capability taxonomies. Does not scale to the aPaaS vision where agents have rich, overlapping capability sets and sovereignty over what they accept.

---

### Pattern 2: Request/Reply Bidding

The task publisher broadcasts availability. Agents self-evaluate, then bid. The publisher selects the winning bidder based on fitness signals (load, capability match quality, cost).

```
Step 1: Publisher → tasks.available  (broadcast, no queue group)
        payload: { id, requirements: ["typescript", "code-review"], priority: 3 }

Step 2: Agents receive, self-filter on capabilities
        Luna:    "I match, load 2/10"   → reply
        Fern:    "I match, load 7/10"   → reply
        Andreas: no capability match    → silence

Step 3: Publisher collects replies (timeout window), selects Luna

Step 4: Publisher → tasks.claimed.{id}
        payload: { assignee: "luna", task: ... }
```

```typescript
// Publisher side — collect bids
const inbox = createInbox();
const bids: Bid[] = [];
const sub = nc.subscribe(inbox, { timeout: 2000 });

nc.publish("tasks.available", encode({
  id: taskId,
  requirements: ["typescript", "code-review"],
  priority: 3,
}), { reply: inbox });

for await (const msg of sub) {
  bids.push(decode(msg.data));
}

const winner = bids.sort((a, b) => a.load - b.load)[0];
nc.publish(`tasks.assigned.${winner.agentId}`, encode({ taskId, payload }));
```

**Layer mapping:**

| Layer | Role |
|---|---|
| L2 Transport | Request/reply for bidding round |
| L3 Envelope | Bid and assignment envelopes with sovereignty metadata |
| L4 Identity | Bids are signed — publisher verifies bidder identity |
| L5 Discovery | Agents self-advertise capabilities via bid responses |
| L6 Composition | Two-phase protocol: broadcast → collect → assign |

**Strengths:**
- Full sovereignty: agents decide whether to bid, publisher decides who wins
- Rich capability matching: requirements in payload, not squeezed into subject tokens
- Load-aware selection: bidders report current state, publisher optimizes
- Observable: the bidding round is an explicit protocol step

**Weaknesses:**
- Latency: every task pays a bidding round (2s timeout in the example)
- Requires orchestrator logic in the publisher
- No persistence: if no agents are online during the broadcast window, the task is lost
- Race conditions: between bid acceptance and task start, agent state may change

**Verdict:** Good sovereignty model. The bidding latency and orchestrator complexity are real costs. Best suited for high-value tasks where selection quality matters more than throughput.

---

### Pattern 3: JetStream Filtered Consumers

One JetStream stream holds all tasks. Filtered durable consumers are created per capability. Multiple agent instances pulling from the same consumer form a competing-consumer group. Agents exercise sovereignty by nak-ing tasks they evaluate and reject.

```
┌─────────────┐     ┌─────────────────────────────┐
│ Task Source  │────→│  TASKS stream               │
└─────────────┘     │  subjects: tasks.>           │
                    │  retention: limits (7d)      │
                    └──────┬──────────┬────────────┘
                           │          │
                    ┌──────▼───┐ ┌────▼──────┐
                    │ consumer │ │ consumer  │
                    │ code-    │ │ security- │
                    │ review   │ │ scan      │
                    │ filter:  │ │ filter:   │
                    │ tasks.   │ │ tasks.    │
                    │ code-    │ │ security- │
                    │ review.> │ │ scan.>    │
                    └──┬───┬──┘ └──┬───┬────┘
                       │   │       │   │
                     Luna Fern  Luna  Kai
```

```typescript
// Stream setup — one stream for all tasks
await jsm.streams.add({
  name: "TASKS",
  subjects: ["tasks.>"],
  retention: RetentionPolicy.Limits,
  max_age: 7 * 24 * 60 * 60 * 1_000_000_000, // 7 days in nanos
});

// Filtered consumer — only code-review tasks
await jsm.consumers.add("TASKS", {
  durable_name: "code-review-workers",
  filter_subject: "tasks.code-review.>",
  ack_policy: AckPolicy.Explicit,
  max_deliver: 3,           // retry twice on failure
  ack_wait: 300_000_000_000, // 5 min to complete
});

// Agent pulls when ready — natural backpressure
const consumer = await js.consumers.get("TASKS", "code-review-workers");
const messages = await consumer.consume({ max_messages: 1 });

for await (const msg of messages) {
  const task = decode(msg.data);

  // Sovereignty: evaluate before committing
  if (!canHandle(task)) {
    msg.nak();   // reject — NATS redelivers to next agent
    continue;
  }

  try {
    await executeTask(task);
    msg.ack();   // done — removed from consumer
  } catch {
    msg.nak();   // failed — retry via another agent
  }
}
```

**Layer mapping:**

| Layer | Role |
|---|---|
| L2 Transport | JetStream stream + consumers provide durable competing-consumer delivery |
| L3 Envelope | Standard envelope wraps task; sovereignty metadata informs nak decisions |
| L5 Discovery | Implicit — consumer filter subjects define capability scopes |
| L6 Composition | Pull-based work claiming with ack/nak lifecycle |

**Strengths:**
- Persistence: tasks survive agent restarts, network partitions, maintenance windows
- Exactly-once delivery per consumer group: JetStream guarantees one active delivery
- Sovereignty via nak: agents evaluate the task payload, reject if unfit
- Backpressure: pull-based consumption means agents only take work when ready
- Retry: failed or rejected tasks automatically redeliver to next available agent
- Observable: consumer lag, ack rate, nak rate are built-in JetStream metrics

**Weaknesses:**
- Capability model still tied to subject hierarchy (consumer filters are subject patterns)
- No selection optimization: NATS picks the next agent, not the best agent
- Nak cycles: if a task doesn't match any agent's capabilities, it bounces until max_deliver
- Infrastructure: requires JetStream (already running in metafactory, so marginal cost)

**Verdict:** Strong foundation. Durability, backpressure, and nak-based sovereignty cover 80% of the aPaaS requirements. The capability matching gap can be closed by adding a registry (→ Pattern 4).

---

### Pattern 4: JetStream + Capability Registry (Chosen)

Combine Pattern 3's durable competing consumers with a NATS KV-backed capability registry. Agents self-register capabilities. An orchestrator (or the agents themselves) creates filtered consumers that match the registered capability landscape.

```
┌─────────────┐     ┌────────────────────┐
│ Task Source  │────→│ TASKS stream       │
└─────────────┘     │ tasks.{cap}.{sub}  │
                    └────────┬───────────┘
                             │
          ┌──────────────────┼──────────────────┐
          ▼                  ▼                   ▼
   ┌─────────────┐   ┌─────────────┐    ┌─────────────┐
   │ Luna        │   │ Fern        │    │ Kai         │
   │ pull()      │   │ pull()      │    │ pull()      │
   │ evaluate    │   │ evaluate    │    │ evaluate    │
   │ ack/nak     │   │ ack/nak     │    │ ack/nak     │
   └─────────────┘   └─────────────┘    └─────────────┘

   ┌─────────────────────────────────────────────────┐
   │ NATS KV: AGENT_CAPABILITIES                     │
   │                                                  │
   │ luna → { caps: [code-review, ts, security],     │
   │          sovereignty: selective,                  │
   │          maxConcurrent: 3, load: 0.2 }          │
   │ fern → { caps: [code-review, gitlab],           │
   │          sovereignty: selective,                  │
   │          maxConcurrent: 2, load: 0.5 }          │
   │ kai  → { caps: [security-scan, pentest],        │
   │          sovereignty: strict,                     │
   │          maxConcurrent: 1, load: 0.0 }          │
   └─────────────────────────────────────────────────┘
```

#### Capability Registry (NATS KV)

```typescript
const kv = await js.views.kv("AGENT_CAPABILITIES");

// Agent self-registers on startup
await kv.put("luna", encode({
  principal: "did:mf:luna",
  capabilities: ["code-review", "typescript", "security-scan"],
  sovereignty: "selective",   // will evaluate and may nak
  maxConcurrent: 3,
  load: 0.2,
  updatedAt: new Date().toISOString(),
}));

// Orchestrator watches for agent join/leave
const watch = await kv.watch();
for await (const entry of watch) {
  if (entry.operation === "PUT") {
    ensureConsumerExists(entry.key, decode(entry.value));
  } else if (entry.operation === "DEL" || entry.operation === "PURGE") {
    cleanupIfNoSubscribers(entry.key);
  }
}
```

#### Task Lifecycle

```
1. PUBLISH    → Task source publishes to tasks.{capability}.{subcap}
2. DELIVER    → JetStream delivers to one agent in matching consumer group
3. EVALUATE   → Agent inspects payload + own sovereignty rules
4. DECIDE     → ack (accept + execute) or nak (reject → next agent)
5. COMPLETE   → On success: ack. On failure: nak → retry up to max_deliver
6. DEAD-LETTER → After max_deliver exhausts: routed to tasks.dead-letter
                 for human review or escalation
```

#### Sovereignty Modes

| Mode | Behavior | Use case |
|---|---|---|
| `open` | Agent acks all delivered tasks | Simple workers, no filtering needed |
| `selective` | Agent evaluates payload, naks non-matching | Most aPaaS agents |
| `strict` | Agent requires explicit capability + sovereignty match | High-trust tasks (security, deploy) |
| `bidding` | Agent publishes a bid instead of claiming directly | High-value tasks needing selection optimization |

The `bidding` mode bridges to Pattern 2 for tasks that benefit from selection — the consumer delivers a "bid request" envelope, agents reply with bids, and a selection step (which itself can be a consumer) assigns the winner.

#### Layer mapping

| Layer | Role |
|---|---|
| L2 Transport | JetStream stream + pull consumers; KV for registry |
| L3 Envelope | Task envelope with requirements array and sovereignty constraints |
| L4 Identity | Agent self-registration signed by principal; task assignment verifiable |
| L5 Discovery | KV-backed capability registry — runtime queryable, watch-driven |
| L6 Composition | Pull + evaluate + ack/nak lifecycle; optional bidding sub-protocol |

**Strengths:**
- All of Pattern 3's durability, backpressure, and retry guarantees
- Rich capability model: KV values hold structured capability descriptions, not just subject tokens
- Dynamic: agents join/leave, capabilities change — KV watch drives consumer lifecycle
- Sovereignty is first-class: declared in registry, enforced via nak, mode-configurable
- Observable: KV state is the live capability map; consumer metrics show task flow health
- Dead-letter path: unclaimable tasks surface explicitly instead of silently bouncing

**Weaknesses:**
- More moving parts: stream + consumers + KV bucket + optional orchestrator
- Consumer lifecycle management: who creates/deletes consumers when agents come and go?
- Consistency window: between KV update and consumer creation, tasks may misroute briefly

---

## Stratification — what this protocol owns and what it does not

The bus stays thin on purpose. The protocol below — JetStream stream, KV advertisement, pull consumers, ack/nak — is the routing primitive. The richer concerns that the early framing of this work conflated with routing belong at M7 (per `design-cortex.md` §3, §9):

| Concern | Lives in |
|---|---|
| **Agent capability declaration** (which tools, which environments, which credentials, which egress reach) | M7 deployment config, e.g. cortex.yaml `agents[].roles + .trust + .presence` per `design-cortex.md` §9 |
| **Orchestrator translation** of operator intent (*"someone review this"*) into a specific Broadcast / Direct / Delegate dispatch | M7 orchestrator agent (the *manager* role in the manager-team analogy) |
| **Compliance attestation** — concretely: an agent declares (and an installer audits) that it has a scoped service principal, holds no writable production credentials, runs behind an egress allow-list, never sits inside the lethal-trifecta combination of private-data + untrusted-content + outbound-channel without a documented compensating control, executes inside an OS-level sandbox, draws every tool / MCP server from an Approved Tools Register with version pinning, treats every sub-agent's output as untrusted, and emits an append-only session log with threshold-review on velocity-class harm. (Northpower's STD-NPW-AI-001 is the worked example; the same shape applies to any organisation with comparable governance.) | M7 deployment-time per-agent attestation, signed at install, audited by an operator-side review process. NOT a routing dimension. |
| **Notification surface routing** (which surface — Discord, dashboard, paging — sees which lifecycle event) | M7 surface-router per `design-cortex.md` §3.4 + `design-event-taxonomy.md` §5 |
| **Sub-agent trust floor** (when Delegate fans out, how the orchestrator treats sub-agent output) | M7 orchestrator policy + chain-of-stamps verification per [myelin#31](https://github.com/the-metafactory/myelin/issues/31) |

The mistake this section guards against: lifting any of the above into the bus's routing protocol — a richer task envelope, a fatter capability KV schema, deeper match logic in the consumer-lifecycle layer. Each of those couples the protocol to one operator's policy choices, breaks transport-independence (per myelin#7 §5.3), and creates rot surface as those policies evolve.

The protocol stays thin. The agent runtime knows itself. The orchestrator translates intent.

---

## Event-driven lifecycle — every task is an event stream

Every routed task emits a lifecycle of envelopes on the semantic event path defined in `design-event-taxonomy.md` §3 (`local.{org}.dispatch.>` for the dispatch domain). The four-class subject scheme in `design-cortex.md` §3.1 uses the same `local.{org}.*` namespace — the earlier `mf.net-{op}.*` convention has been superseded (see Decision #6).

**Lifecycle envelopes (Delegate mode shown; Broadcast / Direct emit a strict subset):**

```
local.{org}.dispatch.task.received      ← orchestrator publishes operator intent
local.{org}.dispatch.task.assigned      ← receiver claims (or routing layer announces)
local.{org}.dispatch.task.started       ← receiver begins work
local.{org}.dispatch.task.progress      ← optional, mid-flight signals
local.{org}.dispatch.task.completed     ← terminal: success
local.{org}.dispatch.task.failed        ← terminal: failure (with reason)
local.{org}.dispatch.task.aborted       ← terminal: operator interrupt or timeout
```

All envelopes share a `correlation_id` so any surface can reconstruct the timeline. `design-event-taxonomy.md` §6 walks the pilot review loop end-to-end as the worked example of Delegate-mode emission.

### Why the lifecycle is part of the protocol, not an M7 concern

- **Operator-in-the-loop visibility for Delegate** depends on the lifecycle stream existing. Without it, the cognitive-load benefit collapses — handing off an outcome only works if the operator can *see* what's happening.
- **Idempotency and replay** require the protocol-level `correlation_id` and the JetStream-backed durability of `events.>` (per `design-cortex.md` §3.3) — recoverable hot-path subscribers (lost event ≠ lost state).
- **Chain-of-stamps auditability ([myelin#31](https://github.com/the-metafactory/myelin/issues/31))** binds to the lifecycle envelopes: each fan-out hop in Delegate adds a stamp on the next `dispatch.task.*` envelope; the chain is the audit trail.
- **Threshold-review** consumes the lifecycle stream to detect *velocity-class harm* — patterns where many individually-unremarkable actions become collectively destructive (the canonical case is the Replit/SaaStr incident: ~9 seconds of small write-actions wiping production data). Threshold-review counts destructive verbs, cross-repo writes, external network calls per session and triggers human sign-off when configured limits are crossed. Without a lifecycle stream there is nothing to threshold against. The pattern is described as a normative governance requirement in operator-side AI-agent standards (e.g. Northpower's STD-NPW-AI-001 §REQ-008), but the property — "the routing protocol must produce a stream observable enough that velocity-class harm is detectable from outside the agent" — is independent of any specific operator's standard.

### Nak with structured reasons

When an agent rejects a delivered task, the nak carries a structured reason code so consumers (the dead-letter handler, threshold-review logic, the orchestrator's retry policy) can act on the *kind* of mismatch:

| Reason | Meaning |
|---|---|
| `cant-do` | static capability mismatch — agent lacks tool / environment / reach |
| `wont-do` | sovereignty / policy refusal — agent is capable but declines for declared reasons |
| `not-now` | load / availability — agent is at capacity; redeliver to peer |
| `compliance-block` | M7 attestation refusal (e.g., would violate trifecta gate, expired credential, tool not on Approved Register) |

Cheap to add, makes Delegate's observability tractable, and gives M7 logic the discrimination needed to separate dead-letter (compliance-block stays dead) from retry (not-now bounces).

---

## Decision

**Pattern 4 (JetStream + Capability Registry)** — chosen 2026-05-09 as the aPaaS foundation.

| aPaaS Requirement | Pattern 4 Mechanism |
|---|---|
| Capability matching | Subject hierarchy + KV registry for rich metadata |
| Competing consumers | JetStream pull consumers — one delivery per consumer group |
| Sovereignty | Pull-based + nak + sovereignty mode in registry |
| Persistence | JetStream stream with configurable retention |
| Load distribution | Pull-based backpressure — agents take work when ready |
| Agent discovery | KV watch — live capability map, no polling |
| Observability | Consumer lag, ack/nak rates, KV state — all NATS-native |
| Dead letters | max_deliver exhaustion → dead-letter subject for escalation |

### Implementation sequence

1. **Define TASKS stream and subject convention** — extends `specs/namespace.md` with a `tasks.` subject tree, including direct-address shape `tasks.@{principal}.{capability}` (named subject — avoids content inspection, leverages NATS-native filtering; see §Decisions Q5)
2. **Define dispatch lifecycle envelopes** — `local.{org}.dispatch.task.{received,assigned,started,progress,completed,failed,aborted}`, JetStream-backed per `design-cortex.md` §3.3
3. **Implement AGENT_CAPABILITIES KV bucket schema** — feeds L5 Discovery spec (#9). **Thin advertisement only** — capability tags + sovereignty mode + load. Rich capability profiles live at M7 (per §Stratification).
4. **KV writes are signed envelopes** — agent self-registration per [myelin#31](https://github.com/the-metafactory/myelin/issues/31) chain-of-stamps; consumers verify the signature before honouring. Without this an agent could advertise capabilities it does not have.
5. **Build consumer lifecycle manager** — watches KV, creates/tears down filtered consumers
6. **Define task envelope extension** — thin `requirements` + `sovereignty_required` + `deadline` fields in envelope. M7-rich matching (tool inventory, env scope, network reach, trifecta posture) stays at the agent runtime — agents nak with `compliance-block` when M7 policy refuses.
7. **Implement structured nak** — `cant-do | wont-do | not-now | compliance-block` reason codes (see §Event-driven lifecycle)
8. **Implement nak-based sovereignty evaluation** — agent-side task filter using its M7 deployment policy (cortex.yaml `agents[].roles / .trust` and any Northpower attestation slots)
9. **Add dead-letter routing** — `max_deliver` exhaustion handler; `compliance-block` naks route immediately to dead-letter (no retry against the same policy)
10. **Optional: bidding sub-protocol** — for high-value task selection (Pattern 2 as L6 composition pattern)

**Out of scope for this protocol** (M7 concerns — see §Stratification): orchestrator translation logic, agent compliance attestation surface (Northpower STD-NPW-AI-001), notification surface routing (cortex surface-router), threshold-review for slow-motion harm (consumes lifecycle stream from M7).

### Namespace extension

Following `specs/namespace.md` conventions:

```
local.{org}.tasks.{capability}.{subcapability}   — task routing
local.{org}.tasks.dead-letter.{capability}        — unclaimable tasks
local.{org}.agents.capabilities                   — KV bucket subject
local.{org}.agents.{id}.heartbeat                 — agent liveness
```

---

## Decisions (formerly Open Questions)

Resolved 2026-05-09. Items marked **DECIDED** are closed; items marked **OPEN** remain for implementation.

1. **Consumer-per-capability vs consumer-per-agent?** **DECIDED: per-capability.** Simpler — agents join existing consumer groups keyed by capability. Per-agent consumers are unnecessary given the direct-address subject convention (Q5). The thin-advertisement model in §Stratification reinforces this: per-capability consumers match what the bus sees.

2. **Who manages consumer lifecycle?** **DECIDED: Cortex (M7).** Cortex architecture §7.6 already specifies this — cortex's dispatch handler watches the KV capability registry and creates/tears down filtered consumers. This is an M7 orchestrator responsibility, not a bus concern. Agents self-register capabilities; cortex manages the consumer infrastructure.

3. **Cross-operator task routing?** **DECIDED: yes, design for it.** Federated subjects (`federated.tasks.>`) should enable cross-operator task markets. Sovereignty enforcement ([#11](https://github.com/the-metafactory/myelin/issues/11)) is prerequisite. Federation must include principal mapping (an agent from operator A cannot inherit operator B's principal scope). The `mf` namespace was a first iteration — move toward the federated namespace approach.

4. **Economics?** **DECIDED: future concern, lightweight instrumentation now.** Collect input/output token counts as optional fields in lifecycle envelopes (`dispatch.task.completed` payloads). No cost-based routing yet — just the data collection to inform future economics design.

5. **Direct-address subject convention.** **DECIDED: option (a) — named subject** `tasks.@{principal}.{capability}`. Avoids content inspection, makes Direct/Delegate visible at the broker, leverages NATS-native subject filtering. Keeps the routing decision at the transport layer where it belongs.

6. **Namespace reconciliation.** **DECIDED: federated namespace (`local.{org}.*`).** The `mf.net-{operator}.*` convention was a first iteration; all implementation already uses the federated `local.{org}.*` grammar (per `specs/namespace.md`). Cortex has zero runtime dependencies on `mf.net-*` — the old convention appeared only in documentation diagrams. Cortex architecture §3.5 updated to reflect this resolution. Remaining documentation migration (updating diagrams/tables in cortex that still show `mf.net-*`) tracked in [myelin#7](https://github.com/the-metafactory/myelin/issues/7) but is no longer a pre-implementation blocker.

7. **Where does the orchestrator pattern get specified?** **DECIDED: Cortex (M7), split ownership.** Cortex architecture §7 confirms: cortex's dispatch handler owns lifecycle/registry/sovereignty (7 explicit responsibilities in §7.6), but Delegate-receiving agents like Pilot own their own internal orchestration logic. The architecture is explicit: "not in cortex; pilot is its own M7 app." The M2–M6 protocol does not need to know about orchestrator internals — it only carries the distribution mode tag and lifecycle envelopes.

---

## Impact on L5 Discovery ([#9](https://github.com/the-metafactory/myelin/issues/9))

Choosing Pattern 4 collapses L5 Discovery from "a separate spec to write" into "formalise the capability registry that task routing already defines." The `AGENT_CAPABILITIES` KV bucket IS the M5 Discovery seed — this is stated in cortex architecture §7.7 and in implementation step 3 above.

**What myelin#9 (L5 Discovery spec) now needs to deliver:**

1. **AGENT_CAPABILITIES KV schema** — the JSON schema for capability advertisements. Thin: capability tags, sovereignty mode, load, maxConcurrent, principal, updatedAt. Rich profiles (tool inventories, environment scope, network reach) stay at M7 per §Stratification.
2. **Watcher contract** — how M7 consumers (cortex's dispatch handler) subscribe to KV changes, what the consistency guarantees are, and how the consumer lifecycle manager responds to agent join/leave/capability-change events.
3. **Capability taxonomy** — a starter vocabulary for capability tags (e.g. `code-review`, `security-scan`, `deploy`, `release`, `chat`). Extensible per operator, but a common seed prevents early fragmentation. `chat` is the canonical capability for free-form conversational dispatch — used by any dispatch source (platform adapter for human-originated chat, another assistant's runtime for bot-to-bot, delegation re-issues, dashboard "send task", or webhook taps) that wants to address an assistant with a conversational message. See cortex's `docs/design-platform-adapter-dispatch-publishing.md` + `docs/design-myelin-osi-scenarios.md` §4.2 for the dispatch-source taxonomy that consumes `chat`.
4. **Signed registration** — per [myelin#31](https://github.com/the-metafactory/myelin/issues/31), KV writes are signed envelopes. The L5 spec must define the envelope format for capability registration so consumers can verify the registrant's identity.

L5 is no longer a standalone design problem. It's implementation step 3 of this document, with the KV schema as the first concrete deliverable.

---

*This design feeds L5 Discovery ([#9](https://github.com/the-metafactory/myelin/issues/9)) and L6 Composition ([#10](https://github.com/the-metafactory/myelin/issues/10)). Implementation cross-references: chain-of-stamps for Delegate auditability ([#31](https://github.com/the-metafactory/myelin/issues/31)), cross-layer sovereignty enforcement ([#11](https://github.com/the-metafactory/myelin/issues/11)), event taxonomy and surface-router (cortex `design-event-taxonomy.md` + `design-cortex.md` §3, §7, §9), Northpower compliance attestation living at M7 (STD-NPW-AI-001).*
