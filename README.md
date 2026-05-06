# myelin

The envelope protocol for the agentic nervous system.

Myelin defines the universal message format and NATS namespace convention that connect agents across the metafactory ecosystem. One schema for all signals — sovereignty travels with the message.

## What's here

```
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

- **MY-102**: TypeScript library for creating/validating envelopes
- **MY-103**: Migration guide for existing NATS subjects
- **MY-200**: Sovereignty enforcement at NATS leaf node boundaries
- **MY-300**: Cryptographic attestation for sovereignty claims

## License

MIT — see [LICENSE](LICENSE).
