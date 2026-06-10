# Examples

Runnable scripts demonstrating the myelin nervous-system patterns. Every example uses `InMemoryTransport` so it runs without a NATS broker — substitute `NATSTransport` for production.

| Script | What it shows |
|---|---|
| [`grove-agent.ts`](./grove-agent.ts) | L3 (envelope) + L4 (identity) + L2 (transport): agent provisions an Ed25519 keypair, signs an envelope, publishes through `EnvelopeTransport`, and a parallel handler receives it. Matches the namespace convention from F-1 (`local.{principal}.grove.>`). |
| [`pilot-job.ts`](./pilot-job.ts) | Task dispatch end-to-end: F-019 task subjects (`tasks.@{assistant}.{capability}`), F-020 dispatch lifecycle events (`received` → `assigned` → `started` → `completed`), correlation_id threading. Two `EnvelopeTransport`s share one in-memory broker so pilot and echo address each other through it. |
| [`arc-search.ts`](./arc-search.ts) | F-11 capability-filtered search: three agents register signed capability advertisements, an arc-style consumer filters by capability tag (`code-review`) and verifies each registration against the principal registry. |
| [`valid-envelope.json`](./valid-envelope.json) | Minimal valid envelope for JSON Schema validation — `classification: "local"`. |
| [`valid-envelope-federated.json`](./valid-envelope-federated.json) | `classification: "federated"` envelope — `code.pr.review` type carrying a cross-principal PR review, illustrative `max_hop > 0` and `data_residency`. Derived subject (in `extensions.subject`): `federated.metafactory.default.code.pr.review`. |
| [`valid-envelope-public.json`](./valid-envelope-public.json) | `classification: "public"` envelope — `registry.package.published` type carrying a registry publication notice. No principal/stack segments in the derived subject: `public.registry.package.published`. |
| [`invalid-missing-sovereignty.json`](./invalid-missing-sovereignty.json) | Counter-example missing the required `sovereignty` block — exercises the schema's failure path. |

## Running

```bash
bun examples/grove-agent.ts
bun examples/pilot-job.ts
bun examples/arc-search.ts
```

Each prints what it sends and what it receives. Inline comments in the source files explain the envelope shape, sovereignty fields, and lifecycle semantics.

## Design notes

- **InMemoryTransport vs NATSTransport.** Examples use the in-memory transport so they're self-contained. The `EnvelopeTransport` interface is the same — swapping in `NATSTransport` connected to a running broker requires only the constructor change. F-13 ships an integration test suite that exercises the same patterns against a live NATS server.
- **Identity provisioning.** Examples generate ephemeral keypairs via `@noble/ed25519`. In production, agents persist identity via `saveAgentIdentity` / `loadAgentIdentity` (F-7) so the DID + key survive restarts.
- **Sovereignty.** The runnable scripts publish under `classification: "local"` because they're org-internal and don't need the sovereignty engine running. The schema-level coverage of all three tiers lives in the three `valid-envelope*.json` files (see [Per-tier coverage](#per-tier-coverage) below) so JSON Schema consumers can exercise each shape without provisioning transport. Federation requires `classification: "federated"` and the sovereignty engine (F-5) running on the leaf-node boundary.
- **Correlation.** `pilot-job.ts` threads a single `correlation_id` through the task envelope and every lifecycle event so a downstream consumer (or audit log) can reconstruct the trace via F-9 helpers.

## Per-tier coverage

`schemas/envelope.schema.json` accepts three sovereignty tiers (`local` / `federated` / `public`). Each tier has its own JSON example and its own subject-grammar shape from `specs/namespace.md`:

| Tier | Example file | Derived subject | Notes |
|---|---|---|---|
| `local` | [`valid-envelope.json`](./valid-envelope.json) | `local.acme.default.ops.deploy.completed` | Legacy 5-segment shape — subscribers normalize to `acme.default.*` per spec backward-compat rule. |
| `federated` | [`valid-envelope-federated.json`](./valid-envelope-federated.json) | `federated.metafactory.default.code.pr.review` | Stack-aware 6-segment shape — `default` stack segment present. `max_hop = 2` illustrates multi-hop federation; `data_residency = CH` shows the canonical Swiss-residency case. |
| `public` | [`valid-envelope-public.json`](./valid-envelope-public.json) | `public.registry.package.published` | No principal or stack segments — public subjects omit both per the spec. |

Subject grammar reference: [`specs/namespace.md` §Subject Format](../specs/namespace.md#subject-format). The full derivation rule lives at [§Composing a Subject from Envelope Fields](../specs/namespace.md#composing-a-subject-from-envelope-fields).
