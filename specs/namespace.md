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
local.{org}.{domain}.{entity}.{action}
```

Signals that must stay within an organization's infrastructure. NATS leaf node configuration prevents `local.>` subjects from replicating to other clusters.

**Examples:**
- `local.switch.security.alert.created` — security alert within SWITCH
- `local.switch.soc.incident.escalated` — SOC incident escalation
- `local.metafactory.grove.pipeline.completed` — Grove pipeline run finished

### federated

```
federated.{org}.{domain}.{entity}.{action}
```

Signals that may cross organizational boundaries, subject to the envelope's sovereignty block. The receiving leaf node validates the envelope before accepting.

**Examples:**
- `federated.metafactory.code.pr.review` — PR review request, may reach external reviewers
- `federated.switch.threat.ioc.shared` — threat intelligence shared with trusted peers
- `federated.metafactory.pipeline.job.published` — job available for marketplace bidding

### public

```
public.{domain}.{entity}.{action}
```

No `{org}` segment — public signals are not organization-scoped. Open to all network participants.

**Examples:**
- `public.registry.package.published` — new package available in the registry
- `public.status.network.heartbeat` — network health signal
- `public.community.agent.registered` — agent capability announcement

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
| `{org}` | Organization identifier. Unique across the network. | `switch`, `metafactory`, `acme-corp` |
| `{domain}` | Functional domain. Groups related signals. | `code`, `security`, `pipeline`, `grove`, `registry` |
| `{entity}` | The thing being acted on. | `pr`, `alert`, `job`, `agent`, `package` |
| `{action}` | What happened. Past tense preferred for events, imperative for commands. | `created`, `completed`, `review`, `publish` |

### Wildcards

NATS wildcards apply:
- `*` matches a single segment: `local.switch.security.*.created`
- `>` matches one or more trailing segments: `federated.metafactory.code.>`

Wildcards are for subscriptions only. Published subjects must be fully qualified — no wildcards in published messages.

---

## Reserved Prefixes

The following prefixes are reserved and must not be used for application signals:

| Prefix | Purpose |
|--------|---------|
| `_system.` | Internal NATS cluster management |
| `_internal.` | Myelin protocol control signals (health checks, schema negotiation) |
| `_audit.` | Compliance and audit trail signals |
| `_test.` | Test harness signals — stripped in production |

---

## Relationship to Envelope

The subject prefix and the envelope's `sovereignty.classification` must align:

| Subject Prefix | Required `classification` |
|----------------|--------------------------|
| `local.*` | `local` |
| `federated.*` | `federated` |
| `public.*` | `public` |

A mismatch between subject prefix and envelope classification is a protocol violation. Transport middleware rejects mismatched envelopes before delivery.

---

## Migration Path

Existing NATS subjects (grove, pulse, miner, pilot) predate this convention. Feature MY-103 will produce the migration guide. During transition, old subjects continue to work — new subjects follow this convention. No breaking change.
