---
task: "Implement zero-dependency aPaaS features: envelope schema, namespace convention, operating principles"
project: Myelin
effort: advanced
effort_source: auto
phase: verify
progress: 30/30
mode: interactive
started: 2026-05-06T15:00:00Z
updated: 2026-05-06T15:30:00Z
---

## Problem

The MetaFactory aPaaS vision ("nervous system for agentic work") has a complete design document but zero protocol-level artifacts. No envelope schema exists for agents to wrap messages in. No namespace convention exists for NATS subject routing. Luna's operating principles (Substrate, Composition, Authority, Flow, Topology) are crystallized in the vision doc but not codified in the compass repo where ecosystem agents can discover them. Without these three foundations, nothing downstream (registry indexing, envelope library, sovereignty enforcement) can start.

## Vision

A developer reads the myelin repo and in 10 minutes understands exactly how to format a message envelope and which NATS subject prefix to use. The envelope JSON Schema validates with any standard tool. The namespace convention is unambiguous — given an org, domain, entity, and action, there's exactly one correct subject. The compass principles are discoverable by any ecosystem agent reading `compass/ecosystem/`. The foundation is laid for MY-102 (TS library) and everything above.

## Out of Scope

- TypeScript library (MY-102) — depends on MY-100, next iteration
- Existing NATS subject migration (MY-103) — depends on MY-101
- Sovereignty enforcement at leaf nodes (MY-200) — iteration 2
- Cryptographic attestation (MY-300) — iteration 3
- Registry indexing (F7-700..704) — separate repo, separate work
- Token economics / wallet layer — deferred per vision doc
- Marketplace bidding protocol — deferred per vision doc
- Interface schemas for typed composition — deferred per vision doc

## Principles

- Protocol, not platform — the test: "can someone connect in 10 minutes without our SDK?"
- Gateway connects, never decides — routes WHERE, never decides WHAT
- Sovereignty travels with the message — the artifact declares its own constraints
- Plain text is the database — everything `rg`-able by humans and agents alike
- One envelope for all signals — not ten schemas for ten domains

## Constraints

- Myelin repo depends on nothing — zero ecosystem imports
- JSON Schema must validate with standard tooling (ajv, jsonschema, etc.)
- NATS subjects must be valid NATS subject tokens (no spaces, alphanumeric + dots + wildcards)
- Blueprint features must match blueprint.yaml IDs exactly (MY-100, MY-101)

## Goal

Ship two artifacts: (1) a JSON Schema file defining the Myelin envelope format with sovereignty block and reserved economics block, (2) a markdown spec for the three-prefix NATS namespace convention (local/federated/public). Both are zero-dependency and unblock iteration 2 work. C-200 (operating principles) tracked separately in compass PR #57.

## Criteria

- [x] ISC-1: `myelin/schemas/envelope.schema.json` exists and is valid JSON
- [x] ISC-2: Schema has required fields: id, source, type, timestamp, correlation_id, payload
- [x] ISC-3: Schema `id` field is `format: uuid`
- [x] ISC-4: Schema `source` field is string with pattern for `org.agent.instance`
- [x] ISC-5: Schema `timestamp` field is `format: date-time` (ISO-8601)
- [x] ISC-6: Schema `correlation_id` is string format uuid
- [x] ISC-7: Schema `type` field is string with pattern for `domain.entity.action`
- [x] ISC-8: Schema has `sovereignty` object with required fields: classification, data_residency, max_hop, frontier_ok, model_class
- [x] ISC-9: `sovereignty.classification` is enum: `["local", "federated", "public"]`
- [x] ISC-10: `sovereignty.data_residency` is ISO 3166-1 alpha-2 string pattern
- [x] ISC-11: `sovereignty.max_hop` is integer ≥ 0
- [x] ISC-12: `sovereignty.frontier_ok` is boolean
- [x] ISC-13: `sovereignty.model_class` is enum: `["local-only", "frontier", "any"]`
- [x] ISC-14: Schema has `economics` object marked as reserved (empty object or stub with description)
- [x] ISC-15: Schema `payload` is type object with no additional constraints (arbitrary content)
- [x] ISC-16: Schema validates a well-formed example envelope without errors (ajv or equivalent)
- [x] ISC-17: Schema rejects an envelope missing required `sovereignty.classification` field
- [x] ISC-18: Anti: Schema does NOT define interface/capability fields (out of scope — MY-301)
- [x] ISC-19: `myelin/specs/namespace.md` exists
- [x] ISC-20: Namespace doc specifies three prefixes: `local.`, `federated.`, `public.`
- [x] ISC-21: `local.` format documented as `local.{org}.{domain}.{entity}.{action}`
- [x] ISC-22: `federated.` format documented as `federated.{org}.{domain}.{entity}.{action}`
- [x] ISC-23: `public.` format documented as `public.{domain}.{entity}.{action}` (no org segment)
- [x] ISC-24: Doc specifies that `local.` signals never leave org boundary
- [x] ISC-25: Doc specifies that `federated.` signals are subject to envelope sovereignty rules
- [x] ISC-26: Doc specifies that `public.` signals are unrestricted
- [x] ISC-27: Doc includes naming rules for each segment (allowed characters, case convention)
- [x] ISC-28: Doc lists reserved prefixes (e.g., `_system.`, `_internal.`)
- [x] ISC-29: Doc includes at least 3 concrete subject examples per prefix
- [x] ISC-30: Anti: Namespace doc does NOT specify routing implementation (that's AXON layer, not spec)
- [x] ISC-31: [DROPPED — C-200 tracked in compass PR #57, not this PR. See Decisions 2026-05-06]
- [x] ISC-32: [DROPPED — see ISC-31]
- [x] ISC-33: [DROPPED — see ISC-31]
- [x] ISC-34: [DROPPED — see ISC-31]

## Test Strategy

```yaml
- isc: ISC-1
  type: file-exists
  check: JSON parse succeeds
  threshold: valid JSON
  tool: "cat myelin/schemas/envelope.schema.json | python3 -m json.tool"

- isc: ISC-16
  type: schema-validation
  check: valid envelope passes schema
  threshold: 0 errors
  tool: "bun -e 'import Ajv from \"ajv\"; ...' or python3 jsonschema"

- isc: ISC-17
  type: schema-validation
  check: invalid envelope rejected
  threshold: ≥1 error
  tool: same validator with malformed input

- isc: ISC-19
  type: file-exists
  check: markdown file present
  threshold: file exists
  tool: "test -f myelin/specs/namespace.md"

- isc: ISC-31
  type: content-check
  check: all 5 principle names present
  threshold: 5 matches
  tool: "grep -c 'Substrate\|Composition\|Authority\|Flow\|Topology' compass/ecosystem/principles.md"

- isc: ISC-33
  type: content-check
  check: original 10 items unchanged
  threshold: git diff shows only additions
  tool: "cd compass && git diff ecosystem/principles.md"
```

## Features

```yaml
- name: EnvelopeSchema
  description: "JSON Schema for Myelin envelope format with sovereignty + reserved economics"
  satisfies: [ISC-1, ISC-2, ISC-3, ISC-4, ISC-5, ISC-6, ISC-7, ISC-8, ISC-9, ISC-10, ISC-11, ISC-12, ISC-13, ISC-14, ISC-15, ISC-16, ISC-17, ISC-18]
  depends_on: []
  parallelizable: true

- name: NamespaceConvention
  description: "NATS namespace convention specification document"
  satisfies: [ISC-19, ISC-20, ISC-21, ISC-22, ISC-23, ISC-24, ISC-25, ISC-26, ISC-27, ISC-28, ISC-29, ISC-30]
  depends_on: []
  parallelizable: true

- name: OperatingPrinciples
  description: "Luna's 5 operating principles added to compass ecosystem principles"
  satisfies: [ISC-31, ISC-32, ISC-33, ISC-34]
  depends_on: []
  parallelizable: true
```
