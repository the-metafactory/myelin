# Layer 5: Discovery

Runtime queryable capability registry for the agentic nervous system. An agent can ask the network *"who can review TypeScript right now, under EU residency, without a frontier model?"* and get a list of qualified peers back — without prior knowledge of peer subjects.

## Why discovery is its own layer

Without M5, capability matching falls to static manifests on disk and out-of-band coordination. That works for a handful of agents. It fails the moment:

- Agent populations change between deploys (a worker joins, another goes offline)
- Sovereignty constraints need to influence routing live (an `EU`-residency task must skip `US`-resident workers)
- Load shedding is a real concern (saturated workers must drop out of the candidate pool)
- New capabilities appear without code shipping in every consumer

M5 makes the answer to *"what's reachable right now?"* a query against a signed registry, not a guess.

## The advertisement

Every agent self-advertises a `CapabilityAdvertisement` and signs it with its own Ed25519 key (the same key registered at L4). The signed registration is what the network actually stores.

```typescript
interface CapabilityAdvertisement {
  principal: string;        // DID, e.g. "did:mf:luna"
  capabilities: string[];   // ["code-review", "typescript"]
  sovereignty: "open" | "selective" | "strict" | "bidding";
  load: number;             // 0.0–1.0, current utilization
  maxConcurrent: number;    // positive integer
  updatedAt: string;        // ISO-8601 renewal stamp
}

interface SignedCapabilityRegistration {
  advertisement: CapabilityAdvertisement;
  signed_by: SignedByEd25519;  // method, principal, signature, at
}
```

| Field | Notes |
|---|---|
| `principal` | DID of the advertising agent. MUST match `signed_by.principal` (anti-spoof). |
| `capabilities` | Lowercase capability tags (see `specs/namespace.md` § initial capability taxonomy). |
| `sovereignty` | F-021 mode — `open` (ack all), `selective` (evaluate + may nak), `strict` (explicit match), `bidding` (broadcast bid-request). |
| `load` | Self-reported 0–1 utilization; clamped on registration. Updated via `updateLoad()` without re-publishing capabilities. |
| `maxConcurrent` | Hard ceiling on parallel tasks. |
| `updatedAt` | Renewal timestamp; combined with TTL drives liveness. |

**Self-registration only.** Discovery is the one layer where hub-stamping is intentionally not supported — capabilities live with the agent, and a hub attesting to a capability claim it cannot itself perform would defeat the verification model. Source: [`src/discovery/types.ts`](../src/discovery/types.ts) comment in `SignedCapabilityRegistration`.

## Signing & verification

Canonicalization uses the same RFC 8785 JCS primitive that L4 envelope signing uses ([`src/jcs.ts`](../src/jcs.ts) is shared), so a JCS fix propagates to all signed artifacts.

**Signing** — [`src/discovery/register.ts`](../src/discovery/register.ts):

```typescript
import { registerCapabilities } from "@the-metafactory/myelin";

await registerCapabilities(
  store,
  {
    principal: "did:mf:luna",
    capabilities: ["code-review", "typescript"],
    sovereignty: "selective",
    load: 0.2,
    maxConcurrent: 4,
    updatedAt: new Date().toISOString(),
  },
  { did: "did:mf:luna", privateKey: privKeyBase64 },
);
```

`signCapabilityRegistration()` validates before signing:
- `advertisement.principal` matches `identity.did` (no impersonation)
- DID format (`DID_RE` from `identity/types.ts`)
- `load` clamped to `[0, 1]`
- `maxConcurrent` is a positive integer
- Private key is 32 bytes

**Verification** — [`src/discovery/verify.ts`](../src/discovery/verify.ts):

```typescript
import { verifyCapabilityRegistration } from "@the-metafactory/myelin";

const result = await verifyCapabilityRegistration(registration, registry);
// CapabilityVerificationResult — discriminated on `status`:
//   { status: "verified"; principal: string; advertisement: CapabilityAdvertisement }
//   { status: "rejected"; reason: string }
if (result.status === "verified") {
  // result.principal + result.advertisement are guaranteed; no `reason`.
} else {
  // result.reason is guaranteed; no `principal`/`advertisement`.
}
```

Verification chain:
1. `signed_by.principal === advertisement.principal` (anti-spoof, fast reject)
2. Public key resolves from the `PrincipalRegistry` (same L4 registry as envelope identity)
3. `signed_by.at` within clock-skew tolerance (default 5 min)
4. Ed25519 signature valid over `canonicalizeAdvertisement(advertisement)`

Rejection is final — no permissive path, same posture as L4.

## TTL & liveness

Registrations are time-bounded. The deployed F-11 contract:

| Knob | Value | Rationale |
|---|---|---|
| TTL | 60 seconds | Liveness signal — a dead agent disappears from the registry within one TTL window. |
| Renewal | 30 seconds | Half-TTL, standard practice — survives a single missed beat without flapping. |

`updateLoad()` re-signs and re-publishes with a fresh `updatedAt`; it doubles as a renewal heartbeat when load did not change. An agent that crashes silently stops renewing; its entry expires; consumers querying capabilities see the absence within ≤60 seconds.

TTL is enforced by the backing store. The in-memory store ([`src/discovery/memory-store.ts`](../src/discovery/memory-store.ts)) is **not** TTL-aware — that is the production store's responsibility. NATS KV expiration handles it in the canonical implementation.

## Storage

The store is an abstraction ([`src/discovery/store.ts`](../src/discovery/store.ts)) so tests can drive the registry without standing up infrastructure:

```typescript
interface CapabilityStore {
  put(registration: SignedCapabilityRegistration): Promise<void>;
  get(principal: string): Promise<SignedCapabilityRegistration | null>;
  delete(principal: string): Promise<void>;
  list(): Promise<SignedCapabilityRegistration[]>;
  watch(options?: { startRevision?: number }): CapabilityWatcher;
  close(): Promise<void>;
}
```

**Implementations:**

- `InMemoryCapabilityStore` — shipped, drives unit and integration tests. Revision-counted, watcher-aware, multiple concurrent watchers supported.
- `NATSCapabilityStore` — follow-up, deferred to a separate issue. NATS KV is the canonical production store; it provides revision numbers, watch streams, and TTL enforcement natively.

The watcher returns an `AsyncIterable<CapabilityWatchEntry>` so consumers can `for await` and route events into their own pipeline:

```typescript
for await (const entry of store.watch()) {
  switch (entry.operation) {
    case "put":    onAdvertisement(entry.registration!); break;
    case "delete": onLeave(entry.key); break;
    case "purge":  /* store closing */ break;
  }
}
```

## Querying

The current F-11 contract exposes `list()` for the primary query path; capability-tag filtering and sovereignty filtering happen client-side over the listed set. This is intentional for v1 — moving the filter into the store ties M5 to NATS-KV-specific subject indexing that the abstract interface should not assume.

A typical match against an incoming task envelope:

```typescript
const candidates = (await store.list())
  .filter((r) => task.requirements.every((tag) => r.advertisement.capabilities.includes(tag)))
  .filter((r) => matchesSovereigntyMode(r.advertisement.sovereignty, task.sovereignty_required))
  .filter((r) => r.advertisement.load < 1.0)
  .sort((a, b) => a.advertisement.load - b.advertisement.load);
```

Cortex (M7) owns the dispatch policy — picking from candidates, opening a JetStream filtered consumer per capability, nak/redelivery on overflow. M5's job ends at *who is reachable and qualified*.

## NATS namespace touchpoint

Discovery interacts with the namespace at two points:

1. **Subject derivation** — the dispatcher uses `target_principal` from the discovery match to compose `local.{org}.tasks.@{principal-encoded}.{capability}` for Direct/Delegate routing. Encoding rules: [`specs/namespace.md`](../specs/namespace.md) § Tasks Domain.
2. **Capability taxonomy** — discovery advertisements use the same capability tags the namespace `tasks` domain enforces (`^[a-z](?:[a-z0-9]|-(?!-)){0,62}[a-z0-9]$`).

## Status

Shipped as **F-11** in [myelin#50](https://github.com/the-metafactory/myelin/pull/50) on 2026-05-10.

| Concern | Status |
|---|---|
| Capability advertisement schema | shipped |
| Ed25519 self-registration | shipped |
| RFC 8785 JCS canonicalization | shipped |
| `PrincipalRegistry` integration | shipped (re-uses L4 registry) |
| `InMemoryCapabilityStore` | shipped |
| `watch()` async iterable | shipped |
| TTL semantics (60s/30s) | contract shipped |
| `NATSCapabilityStore` (canonical production store) | follow-up issue |
| Server-side query/filter API | deferred — client-side filter over `list()` for v1 |

Source-of-truth issue: [myelin#9](https://github.com/the-metafactory/myelin/issues/9) (closed by PR #50). Specification: `.specify/specs/f-11-agent-capability-discovery/spec.md`. Design rationale: `docs/design-agent-task-routing.md` § Pattern 4 § Impact on L5 Discovery.

## Out of scope

- Authorization decisions on top of capability match (RBAC is per-operator, M7).
- Capability quality signals (success rate, latency p99) — a future M5 extension once enough corpus exists to define what *quality* means here.
- Cross-operator capability federation — each operator owns its registry; cross-trust is an explicit federation handshake (architecture.md §5.4), not a registry merge.
- Dispatch policy / queue group assignment — Cortex M7.

## Cross-references

- [`docs/architecture.md`](architecture.md) — L5 charter and §5.4 operator-sovereignty-over-registries invariant.
- [`docs/envelope.md`](envelope.md) — L3: the `requirements`, `sovereignty_required`, `target_principal` envelope fields that consume M5 lookups.
- [`docs/identity.md`](identity.md) — L4: the Ed25519 signing key and `PrincipalRegistry` discovery re-uses.
- [`docs/design-agent-task-routing.md`](design-agent-task-routing.md) — task routing design that motivated F-11's exact shape.
- [`specs/namespace.md`](../specs/namespace.md) — tasks-domain subject grammar consumers compose using discovery results.
