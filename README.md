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

Three prefixes determine signal reach:

| Prefix | Reach | Rule |
|--------|-------|------|
| `local.{org}.{domain}.{entity}.{action}` | Org only | Never leaves org boundary |
| `federated.{org}.{domain}.{entity}.{action}` | Cross-org | Subject to envelope sovereignty |
| `public.{domain}.{entity}.{action}` | Unrestricted | Open to all |

See `specs/namespace.md` for naming rules, reserved prefixes, and examples.

## Roadmap

Myelin's roadmap is layered. See [`docs/architecture.md`](docs/architecture.md) for the canonical seven-layer model and per-layer status. Headline items in flight:

- **L4 Identity** — single-stamp shipped (MY-400 / [#8](https://github.com/the-metafactory/myelin/issues/8)); chain-of-stamps proposal open ([#31](https://github.com/the-metafactory/myelin/issues/31))
- **L5 Discovery** — runtime capability registry ([#9](https://github.com/the-metafactory/myelin/issues/9), spec pending)
- **L6 Composition** — pipeline / fan-out / request-reply patterns ([#10](https://github.com/the-metafactory/myelin/issues/10), spec pending)
- **Cross-layer** — sovereignty enforcement protocol ([#11](https://github.com/the-metafactory/myelin/issues/11))

## License

MIT — see [LICENSE](LICENSE).
