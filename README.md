# myelin

The seven-layer protocol stack for the agentic nervous system.

Myelin defines the contracts that connect agents across the metafactory ecosystem — envelopes, transports, identity, and (in progress) discovery and composition. One schema for all signals; sovereignty travels with the message.

> **Start here:** [`docs/architecture.md`](docs/architecture.md) — the seven-layer model, per-layer charter, code mapping, and current status. Read it before changing anything that crosses a layer boundary.

## What's here

```
docs/
  architecture.md         Seven-layer model — canonical reference

schemas/
  envelope.schema.json    JSON Schema (draft 2020-12) for the Myelin envelope

specs/
  namespace.md            NATS subject namespace convention (local/federated/public)

examples/
  valid-envelope.json     A well-formed envelope that passes schema validation
  invalid-missing-sovereignty.json   Intentionally invalid — rejected by validator
```

## Quick start

Validate an envelope:

```bash
pip install jsonschema
python3 -c "
import json, jsonschema
schema = json.load(open('schemas/envelope.schema.json'))
envelope = json.load(open('examples/valid-envelope.json'))
jsonschema.validate(envelope, schema)
print('Valid.')
"
```

## The envelope

Every message on the network is wrapped in a Myelin envelope. Core fields:

| Field | Type | Description |
|-------|------|-------------|
| `id` | uuid | Unique envelope identifier |
| `source` | string | Origin: `org.agent.instance` (3-5 segments) |
| `type` | string | Signal type: `domain.entity.action` |
| `timestamp` | ISO-8601 | When the envelope was created |
| `correlation_id` | uuid | Links related envelopes across a workflow (optional) |
| `sovereignty` | object | The message's passport — classification, data residency, model constraints |
| `payload` | object | Arbitrary signal content |
| `extensions` | object | Forward-compatible metadata (optional) |
| `economics` | object | Reserved for future marketplace integration |

## NATS namespace

Three prefixes determine signal reach. `local.` and `federated.` carry an operator-supplied `{stack}` segment (myelin#113 / IAW Phase A.5):

| Prefix | Reach | Rule |
|--------|-------|------|
| `local.{org}.{stack}.{domain}.{entity}.{action}` | Org only | Never leaves org boundary |
| `federated.{org}.{stack}.{domain}.{entity}.{action}` | Cross-org | Subject to envelope sovereignty |
| `public.{domain}.{entity}.{action}` | Unrestricted | Open to all (no org-scope, no stack) |

Stack-less 5-segment legacy subjects continue to interoperate during the migration window — subscribers default-derive the missing stack to `default`. See `specs/namespace.md` for the full grammar, naming rules, reserved prefixes, and examples.

## Subject derivation for ecosystem consumers

External consumers (Sage, Cortex, Grove, Pulse, …) historically maintained their own copies of subject-derivation logic. To eliminate that fan-out, myelin exposes two stable subpath entry points:

| Subpath | Module | When to import |
|---------|--------|----------------|
| `@the-metafactory/myelin/subjects` | `./src/subjects.ts` | **No envelope dependency.** Pure-string primitives for audit pipelines, analytics, JetStream consumer filters, OpenTelemetry traces. |
| `@the-metafactory/myelin/envelope` | `./src/envelope.ts` | Full envelope schema + envelope-bound subject helpers. Use when you already have a `MyelinEnvelope` in hand. |
| `@the-metafactory/myelin` | `./src/index.ts` | Aggregated re-exports of everything above. Convenient for myelin-native code; heavier import for external consumers that only need subjects. |

### `./subjects` — pure-string grammar (recommended for ecosystem consumers)

```ts
import {
  deriveSubject,
  subjectPrefixAligns,
  detectSubjectForm,
  isSubjectClassification,
  STACK_SEGMENT_REGEX,
  type SubjectClassification,
  type SubjectForm,
  type SubjectFormDetection,
} from '@the-metafactory/myelin/subjects';

// Derive subjects from string primitives — no envelope object needed.
deriveSubject('local', 'acme', 'ops.deploy.completed');
// → 'local.acme.ops.deploy.completed'              (legacy 5-segment)

deriveSubject('local', 'andreas', 'experiments.run.completed', 'research');
// → 'local.andreas.research.experiments.run.completed'  (stack-aware)

deriveSubject('public', 'unused', 'registry.package.published');
// → 'public.registry.package.published'            (public ignores org/stack)

// Classify wire form for audit/analytics — no envelope object needed.
detectSubjectForm('local.andreas.research.experiments.run.completed');
// → { form: 'legacy' }    (conservative no-hint default — see JSDoc)

detectSubjectForm(
  'local.andreas.research.experiments.run.completed',
  'experiments.run.completed',          // envelopeType hint
);
// → { form: 'stack-aware', stack: 'research' }

// Verify subject ↔ claimed-classification alignment.
subjectPrefixAligns('local.acme.ops.deploy.completed', 'local');
// → { aligned: true, expected: 'local', actual: 'local' }
```

The `./subjects` module has **no transitive dependency on the envelope schema**, no Zod, no Ajv, no NATS client. Importing it is cheap — ideal for log shippers, audit pipelines, and consumers that operate on wire-level subjects without ever instantiating an envelope.

### `./envelope` — envelope-bound helpers

```ts
import {
  deriveNatsSubject,
  validateSubjectEnvelopeAlignment,
  type MyelinEnvelope,
} from '@the-metafactory/myelin/envelope';

deriveNatsSubject(envelope);                   // legacy form
deriveNatsSubject(envelope, 'research');       // stack-aware

const alignment = validateSubjectEnvelopeAlignment(subject, envelope);
// → { aligned, expected, actual, form, stack? }
```

These are one-line shims around the `./subjects` primitives. Use them when you already have a `MyelinEnvelope` and want the ergonomic API.

## Roadmap

Myelin's roadmap is layered. See [`docs/architecture.md`](docs/architecture.md) for the canonical seven-layer model and per-layer status. Headline items in flight:

- **L4 Identity** — single-stamp shipped (MY-400 / [#8](https://github.com/the-metafactory/myelin/issues/8)); chain-of-stamps proposal open ([#31](https://github.com/the-metafactory/myelin/issues/31))
- **L5 Discovery** — runtime capability registry ([#9](https://github.com/the-metafactory/myelin/issues/9), spec pending)
- **L6 Composition** — pipeline / fan-out / request-reply patterns ([#10](https://github.com/the-metafactory/myelin/issues/10), spec pending)
- **Cross-layer** — sovereignty enforcement protocol ([#11](https://github.com/the-metafactory/myelin/issues/11))

## License

MIT — see [LICENSE](LICENSE).
