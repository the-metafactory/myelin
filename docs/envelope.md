# Layer 3: Envelope

The wire format every Myelin message uses — canonical schema, ID conventions, timestamp rules, sovereignty metadata, NATS subject namespace, and the boundary between signable and mutable fields.

> **Invariant:** *Sovereignty travels with the message.* The envelope is the unit of sovereignty travel; an L3 envelope is self-contained and self-describing.

## Overview

The envelope sits between the transport (M2) and identity (M4). Every signal that crosses Myelin — alert, task, review, heartbeat, bid — is wrapped in one. One schema for all signals means any consumer can parse any envelope without per-domain glue; the payload is the only domain-specific part.

The envelope is the *cleanest* layer in the stack: designed to a contract from the start, no transport coupling, no per-application carve-outs.

## Canonical fields

| Field | Required | Type | Purpose |
|---|---|---|---|
| `id` | yes | UUID | Unique envelope identifier |
| `source` | yes | string | Origin address (`org.agent.instance`, 3-5 segments) |
| `type` | yes | string | Signal type (`domain.entity.action`, 2-5 segments) |
| `timestamp` | yes | ISO-8601 | When the envelope was created |
| `sovereignty` | yes | object | Classification, residency, hop budget, model constraints |
| `payload` | yes | object | Domain-specific signal content — opaque to L3 |
| `correlation_id` | no | UUID | Links related envelopes across a workflow |
| `signed_by` | no | object[] | L4 identity attestation chain (ed25519 / hub-stamp stamps — see [identity.md § Chain of Stamps](identity.md#chain-of-stamps)). The validator also accepts a single object as a back-compat shim; wire form is always an array. |
| `economics` | no | object | F-15 token budget, actual usage, billing attribution |
| `extensions` | no | object | Forward-compatible metadata (routing hints, trace IDs) |
| `requirements` | no | string[] | F-021 capability tags the task needs |
| `sovereignty_required` | no | enum | F-021 minimum agent sovereignty mode |
| `deadline` | no | ISO-8601 | F-021 soft deadline |
| `distribution_mode` | no | enum | F-021 `broadcast` / `direct` / `delegate` |
| `target_principal` | no | DID | F-021 receiver DID (required when direct/delegate) |
| `originator` | no | object | myelin#160 — policy-level actor identity (signer ≠ claim subject) |

Schema: [`schemas/envelope.schema.json`](../schemas/envelope.schema.json) (JSON Schema draft 2020-12, `additionalProperties: false`).
TypeScript interface: [`src/types.ts`](../src/types.ts) — `MyelinEnvelope`.

### Example

```json
{
  "id": "d3a8c1f4-7e2b-4a91-8c5e-1f9b3d6a2c80",
  "source": "metafactory.pilot.local",
  "type": "code.pr.review",
  "timestamp": "2026-05-11T14:33:00Z",
  "correlation_id": "c7e2b1a4-9d3f-4e58-a6c0-2b8f5d1e4a9c",
  "sovereignty": {
    "classification": "federated",
    "data_residency": "CH",
    "max_hop": 2,
    "frontier_ok": false,
    "model_class": "local-only"
  },
  "payload": {
    "repo": "the-metafactory/myelin",
    "pr": 50,
    "branch": "f-11-discovery"
  }
}
```

`id` and `correlation_id` are UUIDs (the validator's `UUID_RE` in [`src/uuid.ts`](../src/uuid.ts) requires the canonical `8-4-4-4-12` hex form).

## Sovereignty

The sovereignty block is the load-bearing M3 invention. Most messaging systems attach policy out-of-band — ACLs, sidecars, a policy service. Myelin disagrees: every envelope carries its own classification, residency, and model constraints.

| Field | Values | Meaning |
|---|---|---|
| `classification` | `local` / `federated` / `public` | Maximum reach. `local` never leaves the org. `federated` may cross subject to sovereignty rules. `public` is unrestricted. |
| `data_residency` | ISO 3166-1 alpha-2 | Geographic constraint (`CH`, `DE`, `EU` etc. — `EU` is a regional convention) |
| `max_hop` | non-negative integer | Federation-hop budget. `0` = origin only; each forwarding consumes one. |
| `frontier_ok` | boolean | Whether the message may be processed by frontier (cloud) models |
| `model_class` | `local-only` / `frontier` / `any` | Tighter constraint than `frontier_ok` — `local-only` overrides any cloud routing |

Two consequences follow:

1. **Single-pass policy evaluation.** Any layer above M3 can decide compliance without a database round-trip — the whole answer is in the envelope.
2. **Policy travels with archives.** A replayed envelope from six months ago carries the policy that was attached at origin. No "what was allowed at the time" lookup.

`parseSovereignty()` in [`src/envelope.ts`](../src/envelope.ts) is the canonical reader; it returns derived booleans (`canFederate`, `canReachFrontier`, `isLocalOnly`) without re-implementing the rules.

## Inside vs outside the signature

The envelope distinguishes **attested fields** (covered by `signed_by`) from **mutable fields** (carve-out for routing/observability).

**Attested** (covered by each L4 stamp — RFC 8785 JCS canonicalization):
`id`, `source`, `type`, `timestamp`, `sovereignty`, `payload`, the F-021 task-routing fields when present (`requirements`, `sovereignty_required`, `deadline`, `distribution_mode`, `target_principal`), `originator` when present (myelin#160 — the signer commits to the attribution claim), and the prior `signed_by` chain (stamps `0..i-1` with their signatures intact; stamp `i`'s own `signature` is stripped before signing — can't sign yourself).

**Mutable** (intentionally excluded from the signature):
`correlation_id`, `economics`, `extensions`.

**Hard contract:** clients MUST NOT make security or trust decisions based on mutable-field values. The carve-out exists so hubs can annotate routing, accumulate economics, and trace correlation without invalidating attestations. Anything that needs to be both mutable AND attested is a signal to add a new attested mechanism — not to expand the carve-out.

Cross-reference: `architecture.md` §5.2.

## NATS subject namespace

The subject prefix is structural, not advisory. The NATS leaf-node topology enforces it: `local.>` is not replicated across operator boundaries.

```
local.{org}.{domain}.{entity}.{action}     # never leaves org boundary
federated.{org}.{domain}.{entity}.{action} # cross-org, sovereignty-gated
public.{domain}.{entity}.{action}          # unrestricted (no org segment)
```

| Subject prefix | Required `sovereignty.classification` |
|---|---|
| `local.*` | `local` |
| `federated.*` | `federated` |
| `public.*` | `public` |

Mismatch is a protocol violation. `validateSubjectEnvelopeAlignment()` in [`src/envelope.ts`](../src/envelope.ts) is the runtime check; `deriveNatsSubject()` produces the correct subject from envelope fields.

Full namespace spec — including the `tasks` domain extension with Broadcast / Direct / Delegate / dead-letter shapes, principal encoding for `@`-prefixed segments, reserved prefixes, and the TASKS JetStream stream — lives in [`specs/namespace.md`](../specs/namespace.md).

## Validation rules

`validateEnvelope(unknown): ValidationResult` ([`src/envelope.ts`](../src/envelope.ts)) returns `{ valid, errors[] }`. Highlights:

- `id` — UUID v4/v7
- `source` — `^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){2,4}$` (3-5 lowercase segments)
- `type` — `^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){1,4}$` (2-5 lowercase segments)
- `timestamp` — ISO-8601 (with `Z` or `±HH:MM` offset)
- `sovereignty` — all five sub-fields required; `additionalProperties: false`
- `signed_by` — when present, accepts a single stamp (back-compat shim) or an array of stamps; each stamp is `oneOf` ed25519 (signature ≥88 base64 chars) or hub-stamp (adds `stamped_by`). Wire form is always an array — see [identity.md § Migration from pre-#31](identity.md#migration-from-pre-31)
- `requirements` — max 10 capability tags, each `^[a-z](?:[a-z0-9]|-(?!-)){0,62}[a-z0-9]$` (no consecutive or trailing hyphens)
- `target_principal` — required when `distribution_mode ∈ {direct, delegate}` (cross-field rule)
- top-level `additionalProperties: false` — unknown fields fail validation

The validator is the source of truth; the JSON Schema mirrors it. When they drift, fix the validator and regenerate the schema in the same PR.

## Construction

```typescript
import { createEnvelope, createSignedEnvelope, validateEnvelope } from "@the-metafactory/myelin";

const envelope = createEnvelope({
  source: "metafactory.pilot.local",
  type: "code.pr.review",
  sovereignty: {
    classification: "federated",
    data_residency: "CH",
    max_hop: 2,
    frontier_ok: false,
    model_class: "local-only",
  },
  payload: { pr: 50 },
});

// Optionally sign in one step (L4):
const signed = await createSignedEnvelope(input, { did: "did:mf:pilot", privateKey: privKeyBase64 });

const { valid, errors } = validateEnvelope(envelope);
if (!valid) throw new Error(errors.map((e) => `${e.field}: ${e.message}`).join("\n"));
```

`createEnvelope` populates `id` (random UUID) and `timestamp` (now) automatically and omits optional fields when not provided — no nulls on the wire.

## Originator — signer ≠ actor (myelin#160)

The `signed_by` chain answers **who signed**. The `originator` block answers **whose capabilities this envelope asserts**. These are distinct identities in real flows:

- A Discord adapter receives a DM from a human user. The adapter's stack key signs (`signed_by[0].principal = did:mf:andreas-meta-factory`); the policy engine should authorize against the resolved human (`originator.principal = did:mf:mike`).
- A federated peer relays a claim from an upstream operator. The relay's key signs; `originator` names the upstream actor with `attribution: "federated"`.

Humans don't hold NKeys — they DM a bot. The stack is necessarily the signer; the user identity is necessarily a claim ABOUT what the stack is asserting on the user's behalf. `originator` is that claim.

| Field | Type | Description |
|---|---|---|
| `originator.principal` | DID | The actor whose capabilities this envelope asserts |
| `originator.attribution` | enum | `adapter-resolved` / `federated` / `delegated` — how the signer learned the identity |

**Semantics:**

- Absent `originator` → signer is the actor (degenerate case; equivalent to `originator.principal === signed_by[0].principal`).
- Present `originator` → policy engines consult `originator.principal` for authorization. `signed_by` is still verified against the signer's key.
- `originator` is **inside the signature** — the signer commits to the attribution claim. Tampering with `originator` invalidates every subsequent stamp.

```json
{
  "id": "...",
  "source": "metafactory.cortex.dispatch",
  "type": "code.pr.review",
  "timestamp": "2026-05-17T10:00:00Z",
  "sovereignty": { "classification": "local", "data_residency": "CH", "max_hop": 0, "frontier_ok": false, "model_class": "local-only" },
  "payload": { "pr": 50 },
  "originator": {
    "principal": "did:mf:mike",
    "attribution": "adapter-resolved"
  },
  "signed_by": [
    { "method": "ed25519", "principal": "did:mf:andreas-meta-factory", "signature": "...", "at": "2026-05-17T10:00:00Z", "role": "origin" }
  ]
}
```

`getActorPrincipal(envelope)` in [`src/envelope.ts`](../src/envelope.ts) returns `originator.principal` when set, else falls back to `signed_by[0].principal`. Use this from policy engines that want a single answer for "whose capabilities does this envelope assert?".

## Forward-compatibility — `extensions`

The `extensions` object is the documented escape hatch for forward-compatible metadata. Use it for:

- Routing hints a transport-layer middleware reads
- Trace IDs / OpenTelemetry context
- Debug breadcrumbs (request origin, retry count)
- Domain-specific metadata that does not warrant a schema version bump

`extensions` is mutable (outside the signature) and `additionalProperties: true`. Anything that needs to be attested or schema-validated does not belong in `extensions` — it belongs in a new top-level field with a schema entry and a PR that updates this document.

## Status

**Implemented.** L3 is closed-contract; changes require a schema version bump (`$id` in `envelope.schema.json` carries the version).

| Concern | Status |
|---|---|
| Core envelope (`id`, `source`, `type`, `timestamp`, `sovereignty`, `payload`) | shipped |
| `signed_by` attestation (single-stamp) | shipped — see [identity.md](identity.md) |
| `signed_by` chain-of-stamps | shipped — [myelin#31](https://github.com/the-metafactory/myelin/issues/31) closed by [PR #92](https://github.com/the-metafactory/myelin/pull/92) |
| Sovereignty enforcement (transport-level) | spec pending — myelin#11 |
| Economics block (F-15) | shipped |
| Task routing fields (F-021: `requirements`, `distribution_mode`, etc.) | shipped |
| Originator field (signer ≠ actor) | shipped — [myelin#160](https://github.com/the-metafactory/myelin/issues/160) |
| Namespace spec (MY-101) | shipped — [`specs/namespace.md`](../specs/namespace.md) |

Source-of-truth issue: [myelin#6](https://github.com/the-metafactory/myelin/issues/6) (namespace, closed).

## Cross-references

- [`docs/architecture.md`](architecture.md) — seven-layer model and §5 cross-layer invariants (sovereignty, mutable-field trust contract, transport-independence).
- [`docs/identity.md`](identity.md) — L4 attestation: how `signed_by` works and what the signature actually covers.
- [`docs/sovereignty.md`](sovereignty.md) — sovereignty engine: how the declared envelope sovereignty becomes enforced policy.
- [`specs/namespace.md`](../specs/namespace.md) — NATS subject namespace, tasks domain, principal encoding, JetStream stream spec.
