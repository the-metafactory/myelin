# Migration Guide: Legacy NATS Subjects → Myelin Namespace

**Audience:** developers operating grove, pulse, miner, pilot, and other metafactory services that publish or subscribe to NATS today.

**Goal:** map every legacy subject in the metafactory ecosystem onto the myelin namespace convention (`local.*`, `federated.*`, `public.*`) without breaking running deployments. Migration is incremental: legacy and new subjects coexist during transition.

This guide is the implementation of feature **F-1 (MY-103)**.

---

## TL;DR

```
mf.net-{operator}.{domain}.{entity}.{action}
  ─→ local.{operator}.{domain}.{entity}.{action}      # if org-internal
  ─→ federated.{operator}.{domain}.{entity}.{action}  # if cross-org
```

Decide `local` vs `federated` from the message's data classification, not from current routing. If an envelope's `sovereignty.classification` is `local`, the subject must be `local.*`. If it's `federated`, the subject is `federated.*`. The rule comes from the F-5 sovereignty engine ([`src/sovereignty/`](../src/sovereignty/)) — egress validation enforces this at runtime.

---

## Why migrate

Legacy subjects follow `mf.net-{operator}.*` — a flat pattern that predates the seven-layer myelin design and the namespace convention in [`specs/namespace.md`](../specs/namespace.md). The new convention buys three things the legacy pattern cannot:

1. **Sovereignty enforcement at the leaf-node boundary.** `local.*` envelopes never replicate across NATS leaf nodes. The sovereignty engine (F-5) blocks `local`-classified envelopes from `federated.*` subjects at egress time. Legacy `mf.net-*` subjects have no classification segment, so an operator cannot mechanically prevent local data from leaking.
2. **Federation contracts via NSC.** `federated.*` subjects are the export surface for cross-operator agreements. NATS Security Context (NSC) imports/exports use the prefix as the contract boundary. Legacy subjects can't be exported cleanly because every operator's traffic shares one namespace.
3. **Wildcard subscriptions match intent.** `local.metafactory.>` matches "everything internal to metafactory" — useful for internal tooling. `federated.>` matches "everything that crosses an org boundary" — useful for sovereignty audit. Legacy `mf.net-metafactory.>` matches both, which is the bug.

---

## The mapping table

| Legacy pattern | New pattern | Classification | Notes |
|---|---|---|---|
| `mf.net-{op}.*` | `local.{op}.*` | local | Default for org-internal traffic |
| `mf.net-metafactory.grove.pipeline.completed` | `local.metafactory.grove.pipeline.completed` | local | Pipeline lifecycle stays internal |
| `mf.net-metafactory.grove.bot.<bot>.<event>` | `local.metafactory.grove.bot.<bot>.<event>` | local | Bot lifecycle is internal |
| `mf.net-metafactory.grove.review.<event>` | `local.metafactory.grove.review.<event>` | local | Review signals stay internal until federation explicitly opts in |
| `mf.net-metafactory.pulse.alerts.<level>.<service>` | `local.metafactory.pulse.alerts.<level>.<service>` | local | Operational alerts internal |
| `mf.net-metafactory.pulse.health.<service>` | `local.metafactory.pulse.health.<service>` | local | Health checks internal |
| `mf.net-metafactory.pulse.metrics.<service>.<metric>` | `local.metafactory.pulse.metrics.<service>.<metric>` | local | Metric streams internal |
| `mf.net-metafactory.miner.search.<query_id>` | `local.metafactory.miner.search.<query_id>` | local | Search queries internal |
| `mf.net-metafactory.miner.index.<entity>.<action>` | `local.metafactory.miner.index.<entity>.<action>` | local | Index updates internal |
| `mf.net-metafactory.pilot.<event>` | `local.metafactory.pilot.<event>` | local | Pilot lifecycle internal |
| `mf.net-{op}.code.pr.review.<event>` | `federated.{op}.code.pr.review.<event>` | federated | PR reviews cross orgs once federation lands |
| `mf.net-{op}.code.pr.review.completed` | `federated.{op}.code.pr.review.completed` | federated | Same — federated when cross-org |
| `mf.net-public.<domain>.<entity>.<action>` | `public.<domain>.<entity>.<action>` | public | Drop org segment for public |

The classification column is the **load-bearing decision**. Default to `local` unless the envelope is explicitly intended for cross-org consumption. The egress validator will block a misclassified envelope at publish time, so getting this wrong fails loudly rather than leaking silently.

If a subject does not appear in this table, derive it mechanically:

1. Strip the `mf.net-` prefix.
2. Inspect what the publisher's envelope sets `sovereignty.classification` to (or what it *should* be set to).
3. Prepend `local.`, `federated.`, or `public.` accordingly.
4. The `{operator}` segment stays. Drop it only for `public.*`.

---

## Migration checklist

### Phase 1 — Audit

Before changing any code, find every legacy subject in use.

```bash
# Find subject literals in source
rg -nP "['\"]mf\.net-[^'\"]+['\"]" --type ts --type js

# Find publishes against legacy subjects (NATS-style API)
rg -nP "\.publish\([^,]*['\"]mf\.net-" --type ts --type js

# Find subscribes against legacy subjects
rg -nP "\.subscribe\([^,]*['\"]mf\.net-" --type ts --type js

# Find subjects without any of the new prefixes
rg -nP "['\"]mf\.[^'\"]+['\"]" --type ts | rg -v 'local\.|federated\.|public\.'
```

Record each unique pattern. Classify it per the rules above. Add to your migration ticket.

### Phase 2 — Update publishers

```typescript
// Before
transport.publish("mf.net-metafactory.grove.pipeline.completed", envelope);

// After
transport.publish("local.metafactory.grove.pipeline.completed", envelope);
```

If you control all subscribers and can cut over atomically, the patch above is sufficient. If subscribers migrate at their own pace, **dual-publish** during transition:

```typescript
// Dual-publish window (short-lived: weeks, not months)
const newSubject = "local.metafactory.grove.pipeline.completed";
const legacySubject = "mf.net-metafactory.grove.pipeline.completed";
await Promise.all([
  transport.publish(newSubject, envelope),
  transport.publish(legacySubject, envelope),
]);
```

Dual-publishing doubles message volume in the transition window, so use it only when you cannot coordinate cutover with subscribers.

### Phase 3 — Update subscribers

```typescript
// Before
transport.subscribe("mf.net-metafactory.grove.>", handler);

// After
transport.subscribe("local.metafactory.grove.>", handler);
```

If publishers migrate at their own pace, **dual-subscribe** with envelope-id deduplication:

```typescript
// Bounded LRU dedup — the unbounded Set version leaks memory in any
// long-running consumer. Cap matches the dual-publish window: a few
// minutes of message volume at peak, not the full retention.
const DEDUP_MAX = 10_000;
const seen = new Map<string, number>(); // envelope.id → insertion ordinal

function dedupe(envelope: MyelinEnvelope) {
  if (seen.has(envelope.id)) return;
  seen.set(envelope.id, seen.size);
  if (seen.size > DEDUP_MAX) {
    // Evict oldest. Map preserves insertion order, so first key is oldest.
    const oldest = seen.keys().next().value;
    if (oldest !== undefined) seen.delete(oldest);
  }
  handler(envelope);
}

transport.subscribe("local.metafactory.grove.>", dedupe);
transport.subscribe("mf.net-metafactory.grove.>", dedupe);
```

Use envelope `id` for dedup, not subject. The same envelope publishes to both subjects during dual-publish; subject-based dedup would treat them as different messages. Cap the Map size — an unbounded version leaks memory in any long-lived consumer (Holly review #53 cycle 1).

### Phase 4 — Deprecate

1. Watch legacy subject traffic in pulse/observability. Confirm it has dropped to zero (or to the small floor of legacy clients you're willing to write off).
2. Remove dual-publish/subscribe code.
3. Note the deprecation date in your service's CHANGELOG.
4. Optionally configure NATS to refuse the legacy pattern at the server level once nothing speaks it anymore.

---

## Worked examples

### Grove pipeline completion

```typescript
// grove/pipeline.ts — before
await nats.publish(
  `mf.net-${org}.grove.pipeline.completed`,
  jsonEncode({ pipelineId, status, durationMs }),
);

// grove/pipeline.ts — after
await transport.publish(
  `local.${org}.grove.pipeline.completed`,
  createEnvelope({
    source: `${org}.grove.pipeline`,
    type: "grove.pipeline.completed",
    sovereignty: {
      classification: "local",
      data_residency: "CH",
      max_hop: 0,
      frontier_ok: false,
      model_class: "any",
    },
    payload: { pipelineId, status, durationMs },
  }),
);
```

The shape change is bigger than just the subject — moving onto myelin pulls in the envelope contract (id, timestamp, sovereignty, signed_by). For pure-subject migration without envelope adoption, only the first argument changes.

### Pulse health check

```typescript
// pulse/health.ts — subscribe (before)
sub = nats.subscribe("mf.net-metafactory.pulse.health.>");

// pulse/health.ts — subscribe (after)
sub = transport.subscribe("local.metafactory.pulse.health.>", onHealth);
```

### Federated PR review notification

```typescript
// pilot/pr-review.ts — before
nats.publish(
  `mf.net-${org}.code.pr.review.completed`,
  jsonEncode({ prUrl, decision, reviewers }),
);

// pilot/pr-review.ts — after  (note: federated, not local)
await transport.publish(
  `federated.${org}.code.pr.review.completed`,
  createEnvelope({
    source: `${org}.pilot.pr-review`,
    type: "code.pr.review.completed",
    sovereignty: {
      classification: "federated",
      data_residency: "CH",
      max_hop: 1,
      frontier_ok: false,
      model_class: "any",
    },
    payload: { prUrl, decision, reviewers },
  }),
);
```

PR reviews are cross-operator territory once federation lands, so the subject is `federated.*` even if your current deployment is single-org. The classification matches the future shape so policy doesn't need to retroactively rewrite subjects.

---

## Special cases

### Subjects that don't fit `mf.net-{operator}.*`

If you find a legacy subject that doesn't fit the operator-segmented pattern (for example, a bare `metafactory.something`), classify it from the envelope or message content and rewrite into `local.metafactory.something`. Drop the bare prefix in favor of the explicit classification.

### Pure broadcast subjects with no operator scoping

If a subject is genuinely public and operator-agnostic (for example, public ecosystem health pings), use the `public.*` form and drop the operator segment entirely:

```
mf.net-broadcast.ecosystem.heartbeat → public.ecosystem.heartbeat
```

`public.*` subjects do not get sovereignty enforcement. Verify the data is genuinely public before placing a subject under this prefix.

### Wildcards in legacy patterns

NATS wildcards (`*`, `>`) in subscriptions translate one-for-one. Only the prefix changes:

```
mf.net-metafactory.grove.>     → local.metafactory.grove.>
mf.net-metafactory.*.completed → local.metafactory.*.completed
```

Wildcards are forbidden in publish-side subjects in both legacy and new patterns — no change there.

---

## Rollback

If a migration goes wrong:

1. Revert the publisher change so it emits on the legacy subject again.
2. Subscribers that were dual-subscribing keep working — they're already listening on both.
3. Subscribers that fully cut over need to re-add the legacy subscription. Keep the dual-subscribe code in a feature-flagged path so toggling it back is one config flip.

The migration is non-breaking by design: at any point during transition, every subscriber is either dual-subscribed or has cut over, and every publisher is either dual-publishing or has cut over. There is no atomic flip.

---

## Machine-parseable mapping

For automation tooling (subject rewriters, lint rules), the deterministic mapping is:

```typescript
type Classification = "local" | "federated" | "public";

interface SubjectRewrite {
  from: RegExp;
  to: (match: RegExpMatchArray, classification: Classification) => string;
}

const REWRITES: SubjectRewrite[] = [
  // mf.net-{operator}.<rest> → {classification}.{operator}.<rest>
  {
    from: /^mf\.net-([a-z][a-z0-9-]*)\.(.+)$/,
    to: (m, classification) =>
      classification === "public"
        ? `public.${m[2]}`
        : `${classification}.${m[1]}.${m[2]}`,
  },
];
```

The classification cannot be inferred from the legacy subject alone — it requires knowing the envelope or the operator's policy. Tooling should accept a classification argument or read it from `sovereignty.classification` on each envelope.

---

## References

- [`specs/namespace.md`](../specs/namespace.md) — the authoritative myelin namespace convention
- [`docs/design-agent-task-routing.md`](./design-agent-task-routing.md) §Decision #6 — `mf.net-*` superseded
- [F-5 Sovereignty Policy Engine](../src/sovereignty/) — egress validation that enforces classification ↔ subject alignment
- [F-019 TASKS stream + subject convention](../.specify/specs/f-019-tasks-stream-subject-convention/spec.md) — task-routing-specific subject grammar building on this convention
- [F-020 Dispatch lifecycle envelopes](../src/dispatch/) — example of correct namespace usage in production code

---

## Status

This guide is **draft** until the F-1 audit phase confirms every legacy subject in active use across grove, pulse, miner, pilot, and ecosystem repos. Tracked as feature F-1 (MY-103); a follow-up issue captures the inventory work once the ecosystem audit runs.
