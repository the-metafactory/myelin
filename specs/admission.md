# Myelin Substrate Rate-Limit Contract

> **Retitled by RFC-0010 (Ratified 2026-07-15), closing RFC-0006 OD-1.** This file was formerly
> "Myelin Admission Contract" — a mislabel: *membership admission* is RFC-0006's protocol. This
> is the SUBSTRATE RATE-LIMIT contract. It is **informative**: the normative rules live in
> RFC-0010 §2–§4 (`specs/rfc/rfc-0010-rate-limit-and-refusal-taxonomy.md`, which lists this
> file in `supersedes_prose`); this file remains the extended reference for worked examples and
> entry-field detail. Where the two disagree, RFC-0010 governs.

**Version:** 1.1.0 (retitle)
**Status:** Informative (superseded by RFC-0010)
**Feature:** myelin#195 (R26 phase 1 — cortex AzDO #3169)

Admission is a substrate concern. Every surface that dispatches work onto the
bus — chat adapters, web gateways, webhook taps, bus peers, future surfaces —
funnels through one envelope grammar (see `specs/namespace.md` §Tasks Domain),
so the envelope→spawn boundary is the one choke point that covers all of them
with zero per-surface code. This spec defines the **shared admission state**
that makes the limit meaningful under horizontal scale: the NATS-KV bucket, the
key grammar, the entry format, the compare-and-swap arbitration protocol, and
the admission-check interface.

Myelin owns the contract; M7 applications implement it. The first
implementation is cortex (`src/bus/admission/`, cortex#1371). The code migrates
into `@the-metafactory/myelin` alongside signed-KV (myelin#31) — R26 phase 3.
Design provenance: cortex `docs/design-substrate-rate-limiting.md` (Design B,
signed off 2026-07-02).

Normative language: **MUST**/**MUST NOT**/**SHOULD**/**MAY** per RFC 2119. The
KV bucket name, key grammar, and entry format are the hard interoperability
surface — every node arbitrating admission for the same stack reads and writes
the same entries, so those sections are fully normative. The admission-check
interface (§6) is a reference shape: implementations SHOULD follow it, but the
observable semantics (§5, §7, §8) are what they MUST preserve.

---

## 1. Identity — what admission keys on

Admission keys on **envelope-resolved identity**, never on surface session
state. The requester principal is resolved exactly as the authorization gate
resolves it (myelin#160/#161, `getActorPrincipal()`):

1. `originator.identity` — the policy-attribution claim, stamped by the
   ingesting adapter/gateway and covered by the envelope signature. Read FIRST.
2. `signed_by[0].identity` — the originating cryptographic stamp. Fallback for
   peer-to-peer dispatches where the signer IS the actor and no `originator`
   block exists.

The resolved DID (`did:mf:<name>`) is reduced to the **bare principal id**
(`<name>`) for use in KV keys. Implementations MUST key admission on the *same*
principal their authorization gate authorized — admission and authorization
MUST NOT resolve identity divergently, or a requester could be throttled (or
exempted) under a different identity than the one that was policy-checked.

**The anonymous principal.** Open-onboarding traffic resolves to the single
zero-authority public principal (`did:mf:public` → bare id `public`). It is a
first-class admission key with the *tightest* built-in limits, and it is the
one identity whose failure posture is fail-closed (§8).

---

## 2. Bucket

One KV bucket per (principal, stack) — the same granularity as the stack's
JetStream domain, so the limiter's availability is identical to the dispatch
fabric's own availability:

```
admission_{principal}_{stack}
```

| Field | Description | Example |
|---|---|---|
| `{principal}` | Principal id — subject-segment grammar (`[a-z][a-z0-9-]*`) | `metafactory` |
| `{stack}` | Stack segment under the principal (see `specs/namespace.md` §Stack segment) | `default`, `work` |

Example: `admission_metafactory_default` (the backing JetStream stream is
`KV_admission_metafactory_default`).

Provisioning is the consuming stack's responsibility and MUST be idempotent —
assert-or-create at boot, never drop on shutdown (KV state outlives the
process; a restarted node inherits live counters). Recommended bucket
configuration: `history: 1` (only the latest revision matters), file storage,
replicas following the stack's JetStream replication (R1 dev, R3 clustered).

---

## 3. Key grammar

Keys are dot-separated segments from the restricted charset `[a-z0-9-]` per
segment (a strict subset of the NATS KV key grammar). The first segment is the
**counter kind**, the second the **tier**, the remainder the tier's identity
coordinates:

```
{kind}.{tier}[.{coordinates}]
```

| Kind | Holds |
|---|---|
| `rate` | Token-bucket window state (§4.1) |
| `inflight` | In-flight concurrency leases (§4.2) |

### Tier keys (R26 phase 1 ships tiers 1–2)

| Tier | Key | Protects against |
|---|---|---|
| 1 — stack | `rate.stack` / `inflight.stack` | total substrate overload / runaway loop |
| 2 — principal | `rate.principal.{principal}` / `inflight.principal.{principal}` | one requester principal starving others |

`{principal}` is the bare requester principal id from §1 (e.g.
`rate.principal.amt-surface`, `rate.principal.public`).

### Reserved tier keys (phases 2+; MUST NOT be repurposed)

| Tier | Key |
|---|---|
| 3 — principal × agent | `rate.principal-agent.{principal}.{agent}` / `inflight.principal-agent.{principal}.{agent}` |
| 4 — capability | `rate.capability.{capability}` / `inflight.capability.{capability}` |

---

## 4. Entry format

Entries are UTF-8 JSON documents. Every entry carries a schema version `v`;
this spec defines `v: 1`. A reader encountering an entry with a HIGHER `v` than
it understands MUST treat the entry as opaque and fall back to its failure
posture (§8) rather than guess. A reader encountering a corrupt/unparseable
entry SHOULD treat it as absent (fresh state), log the fault, and overwrite on
the next admitted write — self-healing, biased toward availability for named
principals and toward refusal for the anonymous principal (§8).

### 4.1 Rate entry (`rate.*`)

Token bucket per configured window, all windows in one entry so a single CAS
covers the whole key:

```json
{
  "v": 1,
  "windows": {
    "per_minute": { "tokens": 4.25, "refilled_at_ms": 1751412345678 },
    "per_hour":   { "tokens": 58.0, "refilled_at_ms": 1751412345678 }
  }
}
```

| Field | Description |
|---|---|
| `windows` | Map of window name → bucket state. Window names are the config vocabulary: `per_minute` (60 000 ms), `per_hour` (3 600 000 ms), `per_day` (86 400 000 ms). |
| `tokens` | Remaining tokens, fractional (JSON number). Capacity = the configured limit for that window. |
| `refilled_at_ms` | Unix epoch milliseconds of the last refill computation, per the writing node's clock. |

**Refill rule.** On every read, before any decision:

```
elapsed  = max(0, now_ms - refilled_at_ms)          # clock-skew clamp
tokens'  = min(capacity, tokens + elapsed * capacity / window_ms)
refilled_at_ms' = now_ms
```

Deltas over each node's own clock — token buckets tolerate small inter-node
skew by design; the `max(0, …)` clamp makes retrograde clocks refuse-safe.

**Decision rule.** Admit iff `tokens' >= 1` for EVERY window the resolved
limits configure; on admit consume exactly 1 token from each. Windows present
in the entry but absent from the resolved limits are dropped on the next write;
windows configured but absent from the entry initialise at full capacity.

**Retry hint.** On refusal, `retry_after_ms` is the largest across all
refusing windows of `ceil((1 - tokens') * window_ms / capacity)` — the time
until one full token is available on the slowest refusing window.

### 4.2 In-flight entry (`inflight.*`)

A lease list, not a bare counter — leases carry acquisition timestamps so
orphans (node died mid-run) self-expire without a coordinator:

```json
{
  "v": 1,
  "leases": [
    { "id": "5f0c9e0a-6a3e-4d5f-9b2f-1c9c9f1e2ab3", "acquired_at_ms": 1751412345678 }
  ]
}
```

| Field | Description |
|---|---|
| `leases[].id` | Unique lease id — the dispatch's task/correlation id. Unique per live lease within the key. |
| `leases[].acquired_at_ms` | Unix epoch milliseconds at acquisition. |

**Prune rule.** On every read, drop leases with
`now_ms - acquired_at_ms > lease_ttl_ms`. `lease_ttl_ms` is an implementation
constant, RECOMMENDED 3 600 000 (1 h) — comfortably above a long interactive
session, small enough to bound the damage of a crashed node's orphans. A
phase-2 sweeper listening to the `dispatch.task.*` lifecycle MAY reconcile
faster; the TTL is the floor guarantee.

**Decision rule.** Admit iff `pruned_leases.length < max_concurrent`; on admit
append the new lease. On refusal `retry_after_ms` has no window to derive from
— implementations SHOULD use their transport's standard backpressure hint
(5 000 ms in the cortex refusal taxonomy).

**Release rule.** On dispatch termination (the harness guarantees at least one
terminal lifecycle envelope per dispatch), remove the lease by `id` via CAS.
Releasing an absent lease (already pruned, already released) is a no-op —
release MUST be idempotent and MUST NOT fail the dispatch it trails.

---

## 5. CAS arbitration protocol

All writes are compare-and-swap on the KV entry revision — concurrent admits on
the same key serialise through the JetStream leader, which is what makes the
counters exact under N nodes:

```
attempts = 3                              # RECOMMENDED bound
loop:
  entry ← kv.get(key)                     # miss ⇒ state = fresh
  state ← refill / prune(parse(entry), now_ms)
  if refuse(state, limits):
      return refuse                       # READ-ONLY — no write on refusal
  state' ← consume(state)                 # take tokens / append lease
  if entry existed:
      kv.update(key, state', entry.revision)   # CAS on revision
  else:
      kv.create(key, state')                   # create-if-absent (CAS on absence)
  on CAS conflict (wrong revision / already exists): retry loop
  return admit
on attempts exhausted: treat as store contention → failure posture (§8)
```

Two properties are normative:

1. **Refusals MUST NOT consume state.** A refused request performs no write —
   the refusal path is read-only, so a flooding requester cannot burn shared
   tokens or generate CAS contention for admitted traffic.
2. **Every consumption MUST be CAS-guarded.** Unconditional `put` on an
   admission key is forbidden — it reintroduces the lost-update race that
   node-local buckets have.

### 5.1 Multi-tier evaluation (two-phase)

When a request is subject to multiple tiers (stack + principal), evaluate in
two phases:

- **Evaluate (read-only):** read every applicable tier in tier order (1 → 2),
  apply refill/prune in memory, and if ANY tier refuses, return that refusal —
  first refusal in tier order wins, and nothing was written anywhere.
- **Commit (CAS):** only when every tier admitted, run the §5 write loop per
  tier in tier order. Each CAS re-validates against the freshly read state (a
  concurrent admit may have consumed the last token between phases); if a later
  tier's commit refuses or exhausts retries after an earlier tier consumed, the
  implementation SHOULD best-effort refund the earlier tier (return the token /
  remove the lease, one CAS attempt). A failed refund errs toward
  *under*-admission — the safe direction; it self-corrects on refill.

---

## 6. Admission-check interface (reference shape)

```ts
/** The per-window limit vocabulary — mirrors the offering rate predicates. */
interface AdmissionLimits {
  per_minute?: number;
  per_hour?: number;
  per_day?: number;
  max_concurrent?: number;
}

interface AdmissionCheckRequest {
  /** Bare requester principal id, envelope-resolved per §1 (`public` = anonymous). */
  principal: string;
  /** True when the requester resolved to the anonymous public principal. */
  anonymous: boolean;
  /**
   * Tiers to evaluate, in tier order, each with its key (§3) and the limits
   * the implementation's config layer resolved for it. An empty array admits
   * unconditionally (nothing configured ⇒ the limiter is inert).
   */
  tiers: ReadonlyArray<{ tier: string; key: string; limits: AdmissionLimits }>;
  /** Lease id used for in-flight counters — the dispatch task/correlation id. */
  leaseId: string;
  /** Evaluation clock, Unix epoch milliseconds. */
  nowMs: number;
}

type AdmissionDecision =
  | {
      admit: true;
      /** Present when any tier holds an in-flight lease; pass to release(). */
      lease?: AdmissionLease;
      /** True when the decision came from the degraded node-local fallback. */
      degraded: boolean;
    }
  | {
      admit: false;
      /** What refused: a rate window, a concurrency cap, or the store itself. */
      reason: "rate" | "concurrency" | "store_error";
      tier: string;
      /** Refusing window name (`per_minute`|`per_hour`|`per_day`) — rate only. */
      window?: string;
      limit?: number;
      observed?: number;
      retry_after_ms: number;
      degraded: boolean;
    };

interface AdmissionGate {
  check(req: AdmissionCheckRequest): Promise<AdmissionDecision>;
  /** Idempotent; MUST NOT throw — a release failure never fails the dispatch it trails. */
  release(lease: AdmissionLease): Promise<void>;
}
```

The `AdmissionLease` is opaque to callers — it carries whatever the
implementation needs to CAS-remove the lease from every tier that acquired one.

---

## 7. Refusal semantics — mapping onto the dispatch taxonomy

Admission refusals are **transient by definition** and map onto the existing
dispatch refusal taxonomy — nothing new on the wire:

- Refusal → `dispatch.task.failed` with
  `reason: { kind: "not_now", detail, retry_after_ms }` on the originating
  dispatch's correlation id. Surfaces already render terminal failures; the
  human-facing summary SHOULD be friendly ("busy — try again in ~Ns"), with the
  taxonomy detail (`admission: rate limit (principal=…, window=…)`) in
  `reason.detail`.
- Queued (JetStream) consumers additionally `nak(retry_after_ms)` so throttled
  work *defers* instead of dying.
- **`term` is FORBIDDEN for admission refusals.** `term` is reserved for
  permanent refusals (policy / compliance). Rate exhaustion always retries.
- **Ordering:** permanent refusals are evaluated BEFORE transient ones — the
  authorization/policy gate runs first, and admission is only consulted for
  requests that would otherwise spawn. This keeps admission I/O off the path of
  requests that were going to be denied anyway, and never converts a permanent
  deny into an endless retry loop.

---

## 8. Failure posture

When the KV store errors (unreachable, request timeout, CAS retries exhausted,
unknown entry version) while dispatch still flows:

- **Named principals: degrade, loudly.** The implementation falls back to
  node-local approximate token buckets (same refill/decision rules, process
  memory instead of KV) and MUST emit a loud `system.*` event on the
  *transition* into (and out of) degraded mode — never silently, and not
  per-request. Decisions taken in degraded mode carry `degraded: true`.
- **The anonymous principal: fail closed.** Requests resolving to the public
  principal MUST be refused (`reason: "store_error"`, mapped to `not_now` with
  the standard retry hint) while the store is unavailable. Zero-authority
  traffic never rides the approximate path.

The rationale: NATS-down usually means no dispatch at all (the limiter's
availability equals the fabric's), so the degraded window is small — but it
must be visible, bounded, and closed for the one principal with no
accountability behind it.

---

## 9. Observability

Implementations MUST emit an audit event per refusal —
`system.admission.throttled`, a sibling of `system.access.denied` — carrying at
minimum: the resolved principal id, tier, key, refusing window (when rate),
limit, observed value, `retry_after_ms`, and the `degraded` flag. Degraded-mode
transitions emit `system.admission.degraded` (§8). Both ride the `system.*`
subject space and are JetStream-backed like all system events.

Implementations SHOULD expose a way to dump the live KV entries for a principal
(the "single number anyone can audit" that node-local designs cannot give).

---

## 10. Relationship to configuration

Limit *values* (which principal gets which windows) are implementation
configuration, not part of this contract — cortex resolves them from its
`policy.admission` block (stack / defaults / roles / principals / anonymous;
cortex#1371). Two configuration-adjacent rules ARE contract:

1. **Unconfigured ⇒ inert.** An implementation with no admission configuration
   MUST behave byte-identically to one predating this spec: no bucket
   provisioned, no KV reads, no events, every dispatch admitted.
2. **The anonymous ceiling.** When admission IS configured, the anonymous
   principal's effective limits MUST NOT exceed the built-in ceiling of
   **2 per minute, 1 in-flight**, regardless of configured values. Extra
   windows (`per_hour`, `per_day`) may tighten further; nothing loosens it.
