# F-5 Sovereignty — Operator Guide

> Operator-facing setup for the F-5 sovereignty engine. Covers KV
> bucket provisioning, policy shape, hot-reload, failure recovery,
> and consumer-side wiring of `SovereignTransport`. This is the
> minimum path to operational. Federation setup via NSC is covered
> in §7 below.

## Overview

The sovereignty engine has three runtime pieces:

| Piece | Provided by | Operator responsibility |
|---|---|---|
| `SOVEREIGNTY_POLICY` KV bucket holding `config` | NATS JetStream | Provision once per org; keep the JSON inside it valid. |
| `_AUDIT` JetStream stream collecting decision events | `createAuditLog` (provisions on first call, idempotent) | Optional — capacity-plan around 90-day retention. |
| `SovereignTransport` wrapper around `NATSTransport` | Consumer code | Wire it once at boot; no further ops work needed. |

The engine **fails closed**: if the policy is missing or invalid at
startup, the engine refuses to start. No advisory mode. The bucket
must exist with a valid policy before the engine wakes up.

## 1. Provision the policy bucket

One-time per NATS account.

```bash
# Bucket. History>=1 so the previous version is recoverable if a bad
# update lands. File storage for durability.
nats kv add SOVEREIGNTY_POLICY \
  --history=5 \
  --storage=file \
  --replicas=1
```

Replicas: bump to `3` in production clusters.

## 2. Put the initial policy

The policy is JSON matching `SovereigntyPolicy` from the
`@the-metafactory/myelin` package. Minimum-viable example:

```json
{
  "version": 1,
  "org": "metafactory",
  "egress": {
    "block_local_escape": true,
    "rules": [
      {
        "classification": "local",
        "allowed_subjects": ["local.metafactory.>"]
      },
      {
        "classification": "federated",
        "allowed_subjects": ["federated.metafactory.>"]
      },
      {
        "classification": "public",
        "allowed_subjects": ["public.>"]
      }
    ]
  },
  "ingress": {
    "scope_mappings": [],
    "reject_unknown_partners": true
  },
  "chain_of_stamps": {
    "verify_delegation_sovereignty": false
  }
}
```

Put it under the `config` key:

```bash
nats kv put SOVEREIGNTY_POLICY config "$(cat policy.json)"
```

### Field reference

| Field | Meaning |
|---|---|
| `version` | Schema version. Must be `1` for the current engine. |
| `org` | Lowercase slug, kebab-case, matches `^[a-z][a-z0-9-]{0,62}[a-z0-9]$`. Appears in subject namespaces. |
| `egress.block_local_escape` | When `true`, any `classification: "local"` envelope is rejected unless its target subject begins with `local.`. |
| `egress.rules[]` | Per-classification subject allowlist. Patterns use NATS-style wildcards (`*` single token, `>` multi-token). |
| `egress.rules[].data_residency_constraints` | Optional `{ "CH": ["federated.ch.>"] }` style map — restricts a residency code to specific subject patterns. |
| `ingress.scope_mappings[]` | Per-partner federation contract: which partner DIDs can land on which local-scope subjects, with which capability ceiling. Empty array is fine until you federate. |
| `ingress.reject_unknown_partners` | When `true`, any incoming envelope whose `signed_by.principal` doesn't match a scope mapping is rejected. |
| `chain_of_stamps.verify_delegation_sovereignty` | Feature flag for the chain-of-stamps validator (T-6.x — leave `false` until #31 lands). |

## 3. Wire `SovereignTransport` into the consumer

Once the bucket holds a valid policy, the consumer wires the engine
plus the wrapper. The pattern is the same in every service:

```ts
import { connect } from "@nats-io/transport-node";
import { jetstream, jetstreamManager } from "@nats-io/jetstream";
import { Kvm } from "@nats-io/kv";
import {
  NATSTransport,
  createAuditLog,
  createKVPolicyStore,
  createSovereigntyEngine,
  createSovereignTransport,
} from "@the-metafactory/myelin";

// Control-plane connection: drives the KV bucket + JetStream
// manager. NATSTransport opens its own data-plane connection
// lazily on first publish/subscribe — keeping the two separate
// means a slow KV watcher can't backpressure the publish path.
const nc = await connect({ servers: process.env.NATS_URL });
const js = jetstream(nc);
const jsm = await jetstreamManager(nc);

// `open()` binds to the bucket the operator already provisioned
// in step 1. `create()` would also work, but `open()` is the
// semantically correct call here — the consumer is a reader of
// existing ops state, not the provisioner.
const kv = await new Kvm(nc).open("SOVEREIGNTY_POLICY");

// 1. Policy store: load + watch for hot reload.
const policyStore = createKVPolicyStore({ kv });
await policyStore.reload();   // fail-closed: throws if config missing or invalid
await policyStore.watch();    // hot reload via KV watch + 100ms debounce

// 2. Audit log: idempotent stream provisioning, fire-and-forget emit.
const auditLog = await createAuditLog({ js, jsm });

// 3. Engine: orchestrates validators + emits audit entries.
const engine = createSovereigntyEngine({ policyStore, auditLog });

// 4. Wrap the transport. From here, every publish/subscribe is
//    sovereignty-checked.
const nats = new NATSTransport({ servers: process.env.NATS_URL, streamName: "TASKS" });
const transport = createSovereignTransport({ transport: nats, engine });

// Use `transport` everywhere you previously used `nats`.
await transport.publish("local.metafactory.tasks.review", envelope);
```

### Shutdown

Tear down in reverse-of-init order so in-flight work drains before
the underlying connection closes:

```ts
async function shutdown(): Promise<void> {
  // 1. Stop accepting new work. `transport.close()` closes the
  //    wrapped NATSTransport (its data-plane NATS connection).
  await transport.close();

  // 2. Flush pending audit publishes via Promise.allSettled.
  //    Post-close emits are silently dropped, so no fire-and-forget
  //    audit entry gets lost.
  await auditLog.close();

  // 3. Stop the KV watcher iterator, release its handles.
  await policyStore.close();

  // 4. Drain the control-plane connection. Must come last — js,
  //    jsm, and kv all ride on this NatsConnection.
  await nc.close();
}

process.on("SIGTERM", () => { void shutdown(); });
process.on("SIGINT",  () => { void shutdown(); });
```

The wrapper throws `SovereigntyBlockedError` to producers on egress
blocks and silently acks (handler never sees) the envelope on
ingress blocks, while emitting a structured nak on
`_nak.sovereignty.<direction>.<envelope_id>` for downstream
observers (alerting, compliance dashboards, etc.).

## 4. Update the policy (hot reload)

```bash
nats kv put SOVEREIGNTY_POLICY config "$(cat new-policy.json)"
```

The engine's `policyStore.watch()` picks up the new value within
~100ms (debounce window). Invalid JSON or schema-invalid payloads
are rejected and logged via the store's `onInvalidUpdate` callback
(defaults to `console.error`); the previous policy stays cached.
**There is no service restart.**

Audit a change rolled out cleanly by tailing recent decisions:

```bash
nats stream view _AUDIT --last=20
```

Each entry is a JSON `AuditEntry` with `direction`, `decision`,
`reason_code` (on blocks), `principal`, `subject`, `classification`,
and `data_residency`.

## 5. Failure recovery

### Symptom: engine refuses to start

The startup log shows
`sovereignty policy missing in KV (key 'config') — fail-closed`
or `invalid sovereignty policy in KV: …`.

Recovery:

```bash
# Inspect what's actually in the bucket.
nats kv get SOVEREIGNTY_POLICY config

# If the JSON is malformed or schema-invalid, push a known-good
# policy back. With history>=2, the prior revision is reachable:
nats kv history SOVEREIGNTY_POLICY config
nats kv get SOVEREIGNTY_POLICY config --revision=<N>

# Then put the corrected JSON.
nats kv put SOVEREIGNTY_POLICY config "$(cat fixed-policy.json)"
```

The engine reloads on the next `reload()` call (or automatically
within ~100ms if `watch()` is already running).

### Symptom: an envelope is rejected unexpectedly

Pull the nak from the audit stream:

```bash
nats stream view _AUDIT --subject="_audit.sovereignty.block.>" --last=10
```

The `reason_code` is one of:

| Code | Meaning | Likely fix |
|---|---|---|
| `compliance-block:classification-mismatch` | Local envelope tried to leave `local.>` (with `block_local_escape: true`) or hit no rule. | Confirm the envelope's classification + the policy's allowed_subjects for that classification. |
| `compliance-block:residency-violation` | Envelope's `data_residency` had constraints in the rule, and the target subject didn't match any constraint pattern. | Either widen the constraint patterns or change the residency at the source. |
| `compliance-block:unknown-principal` | Ingress envelope's `signed_by.principal` doesn't appear in any `ingress.scope_mappings[].imported_principals`. | Add the partner DID to the mapping, or accept that this partner is rejected. |
| `compliance-block:scope-exceeded` | Known principal claimed a subject outside its `local_scope`, OR a `requirements[]` entry exceeds the mapping's `max_capabilities`. | Widen `local_scope` patterns / `max_capabilities`, or correct the source's target subject. |
| `compliance-block:partner-unknown` | Reserved code. Whole-partner-org rejection currently surfaces as `unknown-principal` (the validator doesn't distinguish "principal not in any mapping" from "partner not configured"). Higher-level observability can disambiguate. | Add a scope mapping for the partner. |
| `compliance-block:chain-invalid` | (T-6.x, currently off) Stamp in the chain has no sovereignty. | Only relevant once chain-of-stamps verification is enabled. |

### Symptom: nak storms

If the audit stream fills with blocks for the same envelope_id pattern,
it usually means a producer is retrying a request the engine keeps
rejecting. Stop the producer; fix the policy or the producer's claim;
restart. The 90-day retention on `_AUDIT` means storms are visible for
post-incident review even after the immediate fire is out.

## 6. Operational checklist

- [ ] `SOVEREIGNTY_POLICY` bucket exists with `history >= 2`, file storage.
- [ ] `config` key holds a JSON policy that round-trips through `validatePolicy()` (importable from the package).
- [ ] Every consumer service wires `createSovereignTransport(...)` and uses its surface — no service publishes directly through the raw `NATSTransport`.
- [ ] `_AUDIT` stream is monitored (alert on `_audit.sovereignty.block.>` rate exceeding the org's baseline).
- [ ] Policy updates go through change control: validate JSON locally with `validatePolicy()` before pushing to the KV.

## 7. Federation setup (NSC)

Cross-org federation requires NATS Security Context (NSC) configuration
on both sides of the boundary. myelin emits the `nsc` commands as
strings — operators apply them via shell or paste them into an existing
NSC workflow. No subprocess runs from inside the library.

The convention: `federated.{org}.*` subjects cross account boundaries;
`local.*` subjects never do.

### Generate the commands

`generateFederationScript(policy)` produces a complete script —
exports for every `federated`/`public` subject in `egress.rules`, plus
imports for every `ingress.scope_mappings[]`. Or call the two pieces
separately:

```ts
import {
  generateFederationScript,
  generateExportCommands,
  generateImportCommands,
} from "@the-metafactory/myelin";

const policy = JSON.parse(await Bun.file("policy.json").text());

// Full script (exports + every partner's imports):
const all = generateFederationScript(policy);
await Bun.write("federation.sh", all.join("\n") + "\n");

// Or just the exports:
const exports = generateExportCommands(policy);

// Or imports for a single partner mapping:
const imports = generateImportCommands(policy.ingress.scope_mappings[0]);
```

By default the script uses two shell placeholders:

| Placeholder | Meaning |
|---|---|
| `${ACCOUNT}` | Local NSC account name. |
| `${PARTNER_ACCOUNT_<ORG>}` | Partner's NSC account public key (looked up from the partner's NSC keystore). |

Override the account at generation time with the options arg:

```ts
generateFederationScript(policy, { account: "metafactory-prod" });
```

### Generated shape

Exports (one pair per `federated`/`public` subject):

```bash
# myelin sovereignty exports for org: metafactory
# Generated from SovereigntyPolicy. Re-run safely: existing exports
# are deleted before being re-added.
# Set ACCOUNT in the shell environment, or replace ${ACCOUNT}.
nsc delete export --account ${ACCOUNT} --subject 'federated.metafactory.>' 2>/dev/null || true
nsc add export --account ${ACCOUNT} --name myelin-export-federated-metafactory-all --subject 'federated.metafactory.>' --stream
```

Imports (one pair per `local_scope` entry per partner):

```bash
# myelin sovereignty imports from partner: operator-b
# Imported principals (enforced at ingress validation, not NSC):
#   - did:mf:echo
# Set ${PARTNER_ACCOUNT_OPERATOR_B} to the partner's NSC account public key.
nsc delete import --account ${ACCOUNT} --src-account ${PARTNER_ACCOUNT_OPERATOR_B} --subject 'federated.operator-b.tasks.>' 2>/dev/null || true
nsc add import --account ${ACCOUNT} --src-account ${PARTNER_ACCOUNT_OPERATOR_B} --name myelin-import-operator-b-federated-operator-b-tasks-all --subject 'federated.operator-b.tasks.>'
```

### Apply the script

```bash
ACCOUNT=metafactory-prod \
PARTNER_ACCOUNT_OPERATOR_B=AB1234CDEF... \
bash federation.sh
nsc push -a $ACCOUNT
```

`nsc push` propagates the updated account JWT to the nats-account-server
(or operator's signing service) so leaf nodes pick up the new
export/import contract.

### Idempotency

Each `add` is preceded by a `delete ... 2>/dev/null || true` for the
same subject, so re-running the script on an already-configured account
lands the same end state. Subjects removed from the policy are NOT
auto-deleted from NSC — that's a separate operational cleanup.

### What NSC does vs what the engine does

NSC controls subject-level account-to-account flow at the NATS layer.
The sovereignty engine enforces principal-level scope at the envelope
layer. The two together:

| Layer | What it gates | Reject path |
|---|---|---|
| NSC export/import | Cross-account subject reachability. Partner can't even publish to a non-imported subject. | NATS-level "no responders" / permission deny. |
| `validateIngress` | `signed_by.principal` ∈ `imported_principals` for the partner, and target subject ∈ `local_scope`. | `compliance-block:unknown-principal` / `:scope-exceeded` nak. |

Both must agree. Imported principals that aren't in the policy mapping
will pass the NATS layer but fail at ingress validation.

### Updating the federation contract

The same hot-reload story applies: push a new policy JSON to the KV;
the engine picks it up within ~100ms. If the change adds/removes
exports or imports, regenerate the federation script and re-apply on
NSC. The two updates aren't atomic — order them so NSC widens
permissions before the policy adds a partner, and the policy removes a
partner before NSC tightens permissions.

## See also

- `src/sovereignty/policy-store.ts` — `createKVPolicyStore` + hot-reload semantics
- `src/sovereignty/audit-log.ts` — `createAuditLog` + stream provisioning
- `src/sovereignty/engine.ts` — orchestration
- `src/sovereignty/transport.ts` — `createSovereignTransport` + structured nak shape
- `src/sovereignty/nsc.ts` — `generateExportCommands`, `generateImportCommands`, `generateFederationScript`
- `.specify/specs/f-5-sovereignty-policy-engine/spec.md` — feature spec
