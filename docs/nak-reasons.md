# Structured Nak Reasons (F-022)

When an agent rejects a delivered task, the nak carries a structured reason code so consumers — the dead-letter handler (F-4), threshold-review logic, the orchestrator's retry policy — can act on the *kind* of mismatch instead of treating every nak the same way.

Source: `docs/design-agent-task-routing.md` §Nak with structured reasons.

---

## Reason codes

| Reason | Meaning | Consumer routing (per F-4) |
|---|---|---|
| `cant-do` | Static capability mismatch — agent lacks tool / environment / reach | Retry up to `max_deliver`, then dead-letter |
| `wont-do` | Sovereignty / policy refusal — agent is capable but declines | Retry up to `max_deliver`, then dead-letter |
| `not-now` | Load / availability — agent is at capacity | Bounce with exponential backoff (does NOT count toward `max_deliver`) |
| `compliance-block` | M7 attestation refusal (trifecta gate, expired credential, unapproved tool) | Immediate dead-letter (no retry against same policy) |

---

## Wire format

Reason rides on NATS message headers:

```
Myelin-Nak-Reason: cant-do | wont-do | not-now | compliance-block
Myelin-Nak-Description: <free-form, optional>
```

Headers preserve across redelivery (NATS 2.10+). Consumers read headers before ack/nak decision; if absent, the nak is treated as `cant-do` (back-compat default).

---

## Agent-side usage

```typescript
import { nakWithReason } from "@the-metafactory/myelin";

for await (const msg of consumer.consume()) {
  const envelope = decodeEnvelope(msg.data);

  if (!agent.hasCapabilities(envelope.requirements ?? [])) {
    await nakWithReason(
      { msg, envelope, agentPrincipal: agent.did, publisher, org: "metafactory" },
      { reason: "cant-do", description: "missing typescript-codemod" },
    );
    continue;
  }

  if (agent.isAtCapacity()) {
    await nakWithReason(
      { msg, envelope, agentPrincipal: agent.did, publisher, org: "metafactory" },
      { reason: "not-now" },
    );
    continue;
  }

  // ... process and ack
}
```

For handler error paths where async overhead matters, use `nakWithReasonSync(msg, { reason: "cant-do", description: err.message })` — same wire effect, no lifecycle event emission.

---

## Lifecycle event (`dispatch.task.rejected`)

When `nakWithReason` runs with a publisher + org, it emits:

- **Subject:** `local.{org}.dispatch.task.rejected`
- **Payload (`TaskRejectedEvent`):**

```typescript
{
  task_id: string;            // envelope.id
  correlation_id: string;     // envelope.correlation_id ?? envelope.id
  agent_principal: string;    // DID of the rejecting agent
  reason: NakReason;
  description?: string;
  timestamp: string;          // ISO-8601
  delivery_count: number;
}
```

Consumers of this event:
- **Threshold-review** counts rejections per agent / per task to detect velocity-class harm
- **Audit / chain-of-stamps (#31)** binds the rejection to the originating task's correlation chain
- **Surface-router (M7)** can route `compliance-block` rejections to a paging surface

Lifecycle emission is best-effort — the nak still happens even if the publisher fails.

---

## Backoff for `not-now`

`not-now` triggers exponential redeliver via `nak(delayNs)`:

| Re-nak # | Delay |
|---|---|
| 1 | 1s |
| 2 | 2s |
| 3 | 4s |
| 4 | 8s |
| 5 | 16s |
| 6 | 32s |
| 7+ | 60s (cap) |

Backoff state is keyed by stream sequence and stays at the cap once reached — further re-naks return 60s rather than resetting. The intent is to surface genuinely-stuck tasks, not to silently restart the schedule.

`not-now` does **not** count toward `max_deliver` (per F-4). Transient overload is not a failure signal — load lifts, redelivery succeeds. Dead-lettering on transient overload would surface the wrong incident class.

---

## Cross-references

- `docs/design-agent-task-routing.md` §Nak with structured reasons, Implementation step 7
- F-4 dead-letter routing — consumer-side action per reason
- F-021 task envelope extension — `requirements` / `sovereignty_required` fields drive reason selection
- [#40](https://github.com/the-metafactory/myelin/issues/40) — tracking issue
