# Examples

Runnable scripts demonstrating the myelin nervous-system patterns. Every example uses `InMemoryTransport` so it runs without a NATS broker — substitute `NATSTransport` for production.

| Script | What it shows |
|---|---|
| [`grove-agent.ts`](./grove-agent.ts) | L3 (envelope) + L4 (identity) + L2 (transport): agent provisions an Ed25519 keypair, signs an envelope, publishes through `EnvelopeTransport`, and a parallel handler receives it. Matches the namespace convention from F-1 (`local.{org}.grove.>`). |
| [`pilot-job.ts`](./pilot-job.ts) | Task dispatch end-to-end: F-019 task subjects (`tasks.@{principal}.{capability}`), F-020 dispatch lifecycle events (`received` → `assigned` → `started` → `completed`), correlation_id threading. Two `EnvelopeTransport`s share one in-memory broker so pilot and echo address each other through it. |
| [`arc-search.ts`](./arc-search.ts) | F-11 capability-filtered search: three agents register signed capability advertisements, an arc-style consumer filters by capability tag (`code-review`) and verifies each registration against the principal registry. |
| [`valid-envelope.json`](./valid-envelope.json) | Minimal valid envelope for JSON Schema validation. |
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
- **Sovereignty.** Examples publish under `classification: "local"` because they're org-internal. Federation requires `classification: "federated"` and the sovereignty engine (F-5) running on the leaf-node boundary; the `valid-envelope.json` covers the federated shape.
- **Correlation.** `pilot-job.ts` threads a single `correlation_id` through the task envelope and every lifecycle event so a downstream consumer (or audit log) can reconstruct the trace via F-9 helpers.
