# Design: Agent Task Routing — Capability-Based Competing Consumers

**Status:** Draft
**Layers:** L2 Transport, L5 Discovery, L6 Composition
**Related issues:** [#9](https://github.com/the-metafactory/myelin/issues/9) (L5 Discovery), [#10](https://github.com/the-metafactory/myelin/issues/10) (L6 Composition)
**Date:** 2026-05-08

---

## Problem

The aPaaS vision requires agents to publish tasks that any qualified agent can claim. Today, task routing is hardcoded: a specific publisher targets a specific subscriber on a known subject. There is no mechanism for:

1. **Capability matching** — routing a task to agents that can actually handle it
2. **Competing consumers** — multiple qualified agents contending for the same task, with exactly one winning
3. **Sovereignty** — agents deciding autonomously whether to accept or refuse work
4. **Load distribution** — backpressure when an agent is at capacity

This document evaluates four patterns for modeling agent task routing on NATS, scored against the myelin layer model.

---

## Patterns

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

### Pattern 4: JetStream + Capability Registry (Recommended)

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

## Recommendation

**Pattern 4 (JetStream + Capability Registry)** for the aPaaS foundation.

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

1. **Define TASKS stream and subject convention** — extends `specs/namespace.md` with a `tasks.` subject tree
2. **Implement AGENT_CAPABILITIES KV bucket schema** — feeds L5 Discovery spec (#9)
3. **Build consumer lifecycle manager** — watches KV, creates/tears down filtered consumers
4. **Define task envelope extension** — `requirements`, `sovereignty_required`, `deadline` fields in envelope
5. **Implement nak-based sovereignty evaluation** — agent-side task filter using registry metadata
6. **Add dead-letter routing** — max_deliver exhaustion handler
7. **Optional: bidding sub-protocol** — for high-value task selection (Pattern 2 as L6 composition pattern)

### Namespace extension

Following `specs/namespace.md` conventions:

```
local.{org}.tasks.{capability}.{subcapability}   — task routing
local.{org}.tasks.dead-letter.{capability}        — unclaimable tasks
local.{org}.agents.capabilities                   — KV bucket subject
local.{org}.agents.{id}.heartbeat                 — agent liveness
```

---

## Open Questions

1. **Consumer-per-capability vs consumer-per-agent?** Per-capability is simpler (agents join existing groups). Per-agent gives finer control but creates N consumers for N agents.
2. **Who manages consumer lifecycle?** Options: a dedicated orchestrator service, or agents self-manage (create consumer on startup, clean up on graceful shutdown).
3. **Cross-operator task routing?** Federated subjects (`federated.tasks.>`) would allow cross-operator task markets. Sovereignty enforcement (#11) becomes prerequisite.
4. **Economics?** Task completion could carry cost signals in the envelope `economics` field — agents factor cost into sovereignty decisions.

---

*This design feeds L5 Discovery ([#9](https://github.com/the-metafactory/myelin/issues/9)) and L6 Composition ([#10](https://github.com/the-metafactory/myelin/issues/10)). Next step: spec the AGENT_CAPABILITIES KV schema as the first concrete L5 artifact.*
