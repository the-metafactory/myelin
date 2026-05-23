# Myelin NATS Namespace Convention

**Version:** 1.0.0
**Status:** Draft
**Feature:** MY-101

The NATS subject namespace IS the architecture. Routing decisions live here, not in gateway code. Get the namespace right, everything follows.

---

## Three Prefixes

Every NATS subject in the Myelin network starts with one of three prefixes. The prefix determines the signal's maximum reach.

| Prefix | Reach | Sovereignty Rule |
|--------|-------|-----------------|
| `local.` | Never leaves org boundary | Enforced at NATS leaf node — local subjects are not replicated |
| `federated.` | Crosses org boundaries | Subject to envelope `sovereignty` block rules |
| `public.` | Unrestricted | No sovereignty constraints applied |

---

## Subject Format

### local

```
local.{org}.{stack}.{domain}.{entity}.{action}
```

Signals that must stay within an organization's infrastructure. NATS leaf node configuration prevents `local.>` subjects from replicating to other clusters.

The `{stack}` segment scopes the signal to one of an operator's stacks (see [Stack segment](#stack-segment) below). Operators running a single stack use `default`.

**Examples:**
- `local.acme.default.ops.deploy.completed` — deploy notification within acme (single-stack operator)
- `local.andreas.research.experiments.run.completed` — research-stack signal under operator `andreas`
- `local.andreas.security.alerts.scanner.triggered` — security-stack signal under the same operator
- `local.metafactory.default.grove.pipeline.completed` — Grove pipeline run finished

### federated

```
federated.{org}.{stack}.{domain}.{entity}.{action}
```

Signals that may cross organizational boundaries, subject to the envelope's sovereignty block. The receiving leaf node validates the envelope before accepting.

**Examples:**
- `federated.metafactory.default.code.pr.review` — PR review request, may reach external reviewers
- `federated.acme.research.data.report.shared` — research-stack data report shared with trusted peers
- `federated.metafactory.default.pipeline.job.published` — job available for marketplace bidding

### public

```
public.{domain}.{entity}.{action}
```

No `{org}` segment — public signals are not organization-scoped, and therefore carry no `{stack}` segment either (stacks are scoped to an operator). Open to all network participants.

**Examples:**
- `public.registry.package.published` — new package available in the registry
- `public.status.network.heartbeat` — network health signal
- `public.community.agent.registered` — agent capability announcement

### Stack segment

The `{stack}` segment names a stack under the operator identified by `{org}`. Stacks are a protocol primitive (IAW Phase A / cortex#112 lock-in Q7) — operators may run several stacks side-by-side and the namespace must let subscribers, audit trails, JetStream consumers, and federation routers distinguish them.

| Field | Description | Examples |
|-------|-------------|----------|
| `{stack}` | Stack identifier under the operator. Operator's choice; convention is purpose-named. | `default`, `research`, `security`, `devops` |

Subject to the same segment format rules as every other segment (lowercase alphanumeric + hyphens, start with letter, 1–63 chars; total subject ≤ 255 chars).

**Why the segment exists:**

1. **Per-stack subscription scoping.** `local.andreas.research.>` vs `local.andreas.security.>` — subscribers no longer need payload inspection to filter.
2. **Audit trail attribution.** Stamps and audit pipelines can tag "which stack emitted this signal" directly from the wire-form subject.
3. **JetStream consumer filtering.** Consumers can filter `(operator, stack)` pairs: `local.*.*.tasks.>` instead of `local.*.tasks.>`.
4. **Federation routing.** Phase D federation can bridge specific stacks (e.g. only `research`) rather than entire operators.

### Backward compatibility — default-derivation

The `{stack}` segment is a grammar extension, not a clean break. Existing operators on the legacy 5-segment shape continue to interoperate via this rule:

> Implementations encountering a subject without a stack segment (5-segment `local.{org}.{domain}.{entity}.{action}` or 5-segment `federated.{org}.{domain}.{entity}.{action}`) SHOULD treat it as `{org}.default.>`. Emitters MAY omit the stack segment in their first migration step but SHOULD upgrade to explicit-stack publishing within one release cycle.

This means:

- **Subscribers** on `local.andreas.>` still match both the legacy 5-segment shape and the new 6-segment shape (NATS `>` is multi-segment), so existing wildcard subscribers do not break when a publisher upgrades.
- **Publishers** can adopt the segment in two steps: first vendor the new schema (validator/derivation accepts both forms), then opt in to emitting the explicit `{stack}` once their stack identity is wired through configuration.
- **Validators** accept both forms during the migration window and warn on the legacy form; a later release will promote that warning to an error once the ecosystem has cut over.

---

## Naming Rules

### Segment Format

| Rule | Specification |
|------|--------------|
| Character set | Lowercase alphanumeric and hyphens: `[a-z0-9-]` |
| Case | Always lowercase. No camelCase, no UPPER. |
| Separators | Dots between segments only. Hyphens within segments for multi-word names. |
| Length | Each segment: 1-63 characters. Total subject: ≤ 255 characters. |
| Start character | Each segment starts with a letter: `[a-z]` |

### Segment Semantics

| Segment | Description | Examples |
|---------|------------|---------|
| `{org}` | Organization identifier. Unique across the network. | `metafactory`, `acme`, `example-corp` |
| `{stack}` | Stack identifier under the operator (see [Stack segment](#stack-segment)). Present in `local.` and `federated.` only. | `default`, `research`, `security`, `devops` |
| `{domain}` | Functional domain. Groups related signals. | `code`, `security`, `pipeline`, `grove`, `registry` |
| `{entity}` | The thing being acted on. | `pr`, `alert`, `job`, `agent`, `package` |
| `{action}` | What happened. Past tense preferred for events, imperative for commands. | `created`, `completed`, `review`, `publish` |

### Wildcards

NATS wildcards apply:
- `*` matches a single segment: `local.acme.ops.*.created`
- `>` matches one or more trailing segments: `federated.metafactory.code.>`

Wildcards are for subscriptions only. Published subjects must be fully qualified — no wildcards in published messages.

### Principal-address segments (`@`-prefixed)

The `@` character is allowed as the **first character of a segment** to denote a principal address (used by the `tasks` domain for Direct/Delegate routing — see Tasks Domain below). Segments starting with `@` follow this pattern:

```
@[a-z][a-z0-9-]*
```

The `@` is positional — it may only appear as the first character. Segments containing `@` anywhere else are invalid. The body after `@` follows the standard start-with-letter rule (`[a-z]`) and the standard character set (`[a-z0-9-]`); total segment length still bounded at 1–63 characters.

This is a grammar extension, not an exception — it generalizes the segment rule (every other segment still starts with `[a-z]`; `@`-segments still start with `[a-z]` *after* the leading `@`).

---

## Reserved Prefixes

The following prefixes are reserved and must not be used for application signals:

| Prefix | Purpose |
|--------|---------|
| `_system.` | Internal NATS cluster management |
| `_internal.` | Myelin protocol control signals (health checks, schema negotiation) |
| `_audit.` | Compliance and audit trail signals |
| `_test.` | Test harness signals — stripped in production |

### Reserved segments inside the `tasks` domain

Two segment patterns inside `local.{org}.tasks.*` (and federated counterpart) are reserved:

| Pattern | Purpose | Validation rule |
|---|---|---|
| `@*` (any segment starting with `@`) | Direct/Delegate principal address (see Tasks Domain) | No capability tag may start with `@` |
| `dead-letter` | Unclaimable-task escalation path | No capability tag may equal `dead-letter` |

A capability tag matching either pattern is a publish-time validation error.

---

## Tasks Domain

The `tasks` domain carries capability-routed work for the agent-task-routing protocol. Tasks are competing-consumer envelopes claimed by qualified agents from a JetStream stream; lifecycle observability lives on the `dispatch` domain (F-020). The grammar below extends the standard `{prefix}.{org}.{stack}.{domain}.*` form with three operator-facing distribution shapes — Broadcast, Direct, Delegate — plus a dead-letter escalation path.

Source: `docs/design-agent-task-routing.md` §Pattern 4 (chosen 2026-05-09).

### Broadcast — competing consumers (open market)

```
local.{org}.{stack}.tasks.{capability}.{subcapability}
```

Any qualified agent in the matching consumer group may claim. JetStream queue-group semantics guarantee exactly-one delivery per group.

**Examples:**
- `local.metafactory.default.tasks.code-review.typescript`
- `local.metafactory.default.tasks.security-scan.dependency`
- `local.acme.research.tasks.deploy.cloudflare`
- `local.metafactory.default.tasks.chat` (free-form conversational dispatch — the canonical capability for `@assistant <message>` style interactions; see cortex's Direction A design for the dispatch-source taxonomy that publishes onto it)

### Direct / Delegate — named recipient

```
local.{org}.{stack}.tasks.@{principal}.{capability}
```

The `@{principal}` segment routes to a single agent by principal id. Direct (*"Forge, cut a release"*) and Delegate (*"Pilot, drive PR #32 to merge"*) modes share this wire shape; the difference is operator-facing — Delegate's receiving agent internally orchestrates a multi-step outcome and emits the dispatch lifecycle stream (F-020). Broker-side filtering — no payload inspection required.

**Principal encoding (reversible, injective).** A DID encodes to a single segment via:

| Source character | Encoded as |
|---|---|
| `:` (DID `did:method:` separators) | `-` (single hyphen) |
| `.` (inside method-specific-id) | `--` (double hyphen) |
| `-` (inside method-specific-id) | `-` (preserved) |
| `[a-z0-9]` | passthrough |

**Precondition for injectivity.** The DID method-specific-id MUST NOT contain consecutive hyphens (`--`). This is enforced by `DID_RE` in `src/identity/types.ts`:

```
^did:mf:[a-z](?:[a-z0-9._]|-(?!-))+$
```

The negative lookahead `-(?!-)` rejects `--` inside the method-specific-id at validation time, before any encoding happens. With this precondition, `--` in the *encoded* form unambiguously decodes to `.` (it cannot have come from a source `--`), so the mapping is injective.

`--` in a DID is degenerate — no principal in the codebase uses it. Tightening the regex is the right place for the constraint because the wire-format encoding is downstream of identity validation.

Decoding scans `@did-{method}-{encoded-msi}`, then within the msi: `--` → `.`, single `-` → `-`.

**Canonical implementation.** The encoding above is exported as `encodeDidSegment(did)` from `@the-metafactory/myelin/subjects` (myelin#135). Use the helper instead of re-deriving the grammar in consumer code — `DID_RE` validation is wired in and the test suite covers the spec examples directly:

```ts
import { encodeDidSegment } from '@the-metafactory/myelin/subjects';

encodeDidSegment('did:mf:forge');           // '@did-mf-forge'
encodeDidSegment('did:mf:hub.metafactory'); // '@did-mf-hub--metafactory'
```

**History.** The first draft of this spec mapped both `:` and `.` to `-`, colliding `did:mf:hub.metafactory` with `did:mf:hub-metafactory`. The second draft fixed the `.`/`-` collision but left a `.`/`--` collision against source `--`. This is the third draft (myelin#44 review feedback, cycles 1 + 2). `did:mf:hub.metafactory` already exists in `docs/identity.md`; collision was a real security boundary violation, not hypothetical.

**Examples:**
- `did:mf:forge` → `local.metafactory.default.tasks.@did-mf-forge.release`
- `did:mf:hub.metafactory` → `local.metafactory.default.tasks.@did-mf-hub--metafactory.release`
- `did:mf:hub-metafactory` → `local.metafactory.default.tasks.@did-mf-hub-metafactory.release` (distinct from above)
- `did:mf:pilot` → `local.metafactory.default.tasks.@did-mf-pilot.pr-merge`
- `did:mf:luna` → `local.acme.research.tasks.@did-mf-luna.code-review`

### Dead-letter — unclaimable escalation

```
local.{org}.{stack}.tasks.dead-letter.{capability}
```

Tasks that exhaust `max_deliver` without a successful claim — or that hit a `compliance-block` nak (F-022) — route here for operator review. The capability segment is preserved from the originating subject so monitoring tools can subscribe per-capability.

**Examples:**
- `local.metafactory.default.tasks.dead-letter.code-review`
- `local.metafactory.research.tasks.dead-letter.security-scan`

### Federated counterparts

The federated prefix mirrors all three patterns:

```
federated.{org}.{stack}.tasks.{capability}.{subcapability}
federated.{org}.{stack}.tasks.@{principal}.{capability}
federated.{org}.{stack}.tasks.dead-letter.{capability}
```

Same grammar, different prefix. Federated subjects are subject to envelope sovereignty rules (myelin#11) and federation principal mapping (myelin#43) — an agent originating from operator A cannot inherit operator B's principal scope when claiming work on B's `federated.tasks.>` tree.

---

## TASKS JetStream Stream

The `TASKS` stream carries every task envelope across local and federated subjects. Specification reference (concrete provisioning lives in infrastructure / cortex M7):

```typescript
{
  name: "TASKS",
  subjects: [
    "local.*.*.tasks.>",        // {org}.{stack}.tasks.>
    "federated.*.*.tasks.>",
  ],
  retention: RetentionPolicy.Limits,
  max_age: 7 * 24 * 60 * 60 * 1_000_000_000,  // 7 days in nanos
  storage: StorageType.File,
  replicas: 3,                                 // R=3 production; R=1 dev (configurable at install)
  discard: DiscardPolicy.Old,
}
```

### Consumer pattern (filtered, per-capability)

Cortex (M7) creates filtered durable consumers per capability tag — see `docs/design-agent-task-routing.md` Decision Q2 for the lifecycle ownership boundary. Reference shape:

```typescript
{
  durable_name: "code-review-workers",
  filter_subject: "local.metafactory.*.tasks.code-review.>",   // any stack under metafactory
  // or per-stack: "local.metafactory.research.tasks.code-review.>"
  ack_policy: AckPolicy.Explicit,
  max_deliver: 3,                              // retry budget before dead-letter
  ack_wait: 300_000_000_000,                   // 5 min to complete (in nanos)
}
```

Consumer lifecycle (creation/teardown on agent join/leave) is **not** part of this spec — it lives in cortex M7 per Decision Q2.

### Retention rationale

| Knob | Default | Rationale |
|---|---|---|
| `max_age` | 7 days | Long enough to bridge weekend bounces; short enough to bound storage. |
| `replicas` | R=3 (prod), R=1 (dev) | Standard JetStream HA — tolerates one node loss in single-region cluster. Dev/single-operator may run R=1. |

---

## Initial Capability Taxonomy

Operators may extend; the validator accepts any token matching `^[a-z][a-z0-9-]*$` (max 64 chars). The seed below prevents early ecosystem fragmentation:

| Tag | Purpose |
|---|---|
| `code-review` | Pull-request review tasks |
| `security-scan` | Static analysis, dependency scan, secret scan |
| `deploy` | Environment promotion / cloudflare / k8s deploy |
| `release` | Version cut, changelog, tag |

Per-operator extensions are recorded in `cortex.yaml` (or equivalent install config) — they are **not** part of this spec.

---

## Relationship to Envelope

The subject prefix and the envelope's `sovereignty.classification` must align:

| Subject Prefix | Required `classification` |
|----------------|--------------------------|
| `local.*` | `local` |
| `federated.*` | `federated` |
| `public.*` | `public` |

A mismatch between subject prefix and envelope classification is a protocol violation. Transport middleware rejects mismatched envelopes before delivery.

### Composing a Subject from Envelope Fields

Given an envelope and an optional `stack` value, the NATS subject is derived deterministically:

| Subject Segment | Envelope Field | Derivation |
|----------------|----------------|------------|
| prefix | `sovereignty.classification` | Direct: `local` → `local.`, `federated` → `federated.`, `public` → `public.` |
| org | `source` | First segment of `source` (e.g., `acme` from `acme.monitor.prod-01`) |
| stack | derivation argument (`local`/`federated` only) | Caller-supplied `stack`. Omitted → legacy 5-segment shape (migration window). Subscribers MUST treat the omitted form as `default` per [Backward compatibility — default-derivation](#backward-compatibility--default-derivation). |
| domain.entity.action | `type` | Direct: `type` field value (e.g., `security.alert.created`) |

**Examples (stack-aware emit):**

| Envelope (`source`, `type`, `classification`) | Stack arg | Derived Subject |
|---|---|---|
| `acme.monitor.prod-01`, `ops.deploy.completed`, `local` | `default` | `local.acme.default.ops.deploy.completed` |
| `andreas.runner.lab`, `experiments.run.completed`, `local` | `research` | `local.andreas.research.experiments.run.completed` |
| `metafactory.pilot.local`, `code.pr.review`, `federated` | `default` | `federated.metafactory.default.code.pr.review` |
| `community.registry.main`, `registry.package.published`, `public` | _n/a_ | `public.registry.package.published` |

**Examples (legacy emit — stack omitted):**

| Envelope (`source`, `type`, `classification`) | Derived Subject |
|---|---|
| `acme.monitor.prod-01`, `ops.deploy.completed`, `local` | `local.acme.ops.deploy.completed` *(treated as `acme.default.*` by subscribers)* |
| `metafactory.pilot.local`, `code.pr.review`, `federated` | `federated.metafactory.code.pr.review` *(treated as `metafactory.default.*`)* |

Note: `public.` subjects omit both the org and stack segments — the subject is `public.{type}` directly.

### Tasks-domain derivation extension

The standard derivation above produces Broadcast task subjects directly:

| Envelope (`source`, `type`, `classification`) | Stack | Derived Subject |
|---|---|---|
| `metafactory.cortex.dispatch`, `tasks.code-review.typescript`, `local` | `default` | `local.metafactory.default.tasks.code-review.typescript` ✓ |

For **Direct/Delegate** task subjects, an additional envelope field — `target_principal` (defined in F-021 task envelope extension) — is consumed; it is **not** part of `type`. Direct/Delegate subjects use this extended derivation:

| Subject Segment | Envelope Field | Derivation |
|---|---|---|
| prefix | `sovereignty.classification` | as above |
| org | `source` | as above |
| stack | derivation argument | as above |
| `tasks.@{principal}` | `target_principal` | DID encoded per Tasks Domain rules (`:` → `-`, `.` → `--`, `-` → `-`) |
| capability | `type` | last segment(s) of `type` after the `tasks.` prefix |

**Examples (with `stack=default`):**

| Envelope fields | Derived subject |
|---|---|
| `source=metafactory.cortex.dispatch`, `type=tasks.release`, `classification=local`, `target_principal=did:mf:forge` | `local.metafactory.default.tasks.@did-mf-forge.release` |
| `source=metafactory.cortex.dispatch`, `type=tasks.pr-merge`, `classification=local`, `target_principal=did:mf:pilot` | `local.metafactory.default.tasks.@did-mf-pilot.pr-merge` |
| `source=metafactory.cortex.dispatch`, `type=tasks.release`, `classification=local`, `target_principal=did:mf:hub.metafactory` | `local.metafactory.default.tasks.@did-mf-hub--metafactory.release` |

The `distribution_mode` envelope field (also F-021) selects between Broadcast (standard derivation, `target_principal` absent) and Direct/Delegate (extended derivation above). Implementers reading the standard composition table alone would mis-derive Direct/Delegate subjects — this section is the authoritative tasks-domain extension.

Cross-reference: `docs/design-agent-task-routing.md` §Distribution modes; F-021 envelope schema.

### Originator (myelin#160) — policy attribution vs. crypto provenance

Two envelope identities are distinct on the wire:

| Identity | Field | Answers |
|---|---|---|
| Cryptographic signer | `signed_by[].principal` | Whose NKey produced this signature? |
| Policy actor (originator) | `originator.principal` | Whose capabilities does this envelope assert? |

The subject namespace ITSELF is unaffected by `originator` — Direct/Delegate subjects still encode `target_principal` (the receiver), and broadcast subjects still derive from `source`/`type`. The originator is a wire-level **policy attribution claim**, not a routing input.

**When they differ.** An adapter (Discord/Slack/Mattermost/HTTP) accepts a request from a non-Myelin actor (e.g., a Discord user) and publishes a dispatch envelope. The stack key signs (`signed_by[0].principal = did:mf:stack-name`); the policy engine on the receive side authorizes against the resolved human (`originator.principal = did:mf:mike`, `attribution = adapter-resolved`).

**When they're equal.** A peer-to-peer dispatch where the signer IS the actor omits `originator` entirely. Policy engines fall back to `signed_by[0].principal` via `getActorPrincipal()`.

**Cryptographic binding.** `originator` is inside the signature (same as the F-021 task-routing fields). The signer commits to the attribution claim; tampering with `originator` invalidates every subsequent stamp. Intermediaries that need to override attribution MUST re-sign — they cannot mutate the field silently.

Cross-reference: `docs/envelope.md` § Originator; issue [myelin#160](https://github.com/the-metafactory/myelin/issues/160).

---

## Migration Path

Existing NATS subjects (grove, pulse, miner, pilot) predate this convention. Feature MY-103 will produce the migration guide. During transition, old subjects continue to work — new subjects follow this convention. No breaking change.
