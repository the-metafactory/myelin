# Decision memo — grove-v2 dropped myelin (H3)

**Status:** DECISION NEEDED (human). Draft per remediation task H3. Surfacing, not deciding.

## The observation

`grove-v2` has **no myelin dependency** in any of its four `package.json` files:

- `grove-v2/package.json` — 0 myelin references
- `grove-v2/src/webhook-proxy/package.json` — 0
- `grove-v2/src/worker/package.json` — 0
- `grove-v2/src/mission-control/package.json` — 0

Meanwhile `grove` (v1) is the **heaviest transport consumer** of myelin. Its
`src/` uses at least:

- `createTransport` — the config-driven transport factory
- `EnvelopeTransport` — the envelope-canonicalizing transport wrapper
- `createSignedEnvelope` — envelope creation + signing
- `verifyEnvelopeIdentity` — L4 identity verification

So the question is not academic: v1 leans on myelin's L2/L3/L4 surface, and v2 —
the intended successor — currently speaks none of it.

## The two readable outcomes

### A. grove-v2 re-adopts myelin
If grove-v2 is meant to replace grove-v1's role in the ecosystem, it must replace
the v1 usage above with the current myelin API. Concretely it needs equivalents
for: transport construction (`createTransport` / an edge transport if v2 runs on
Workers), signed-envelope emission (`createSignedEnvelope` / `createEnvelope` +
signing), and identity verification (`verifyEnvelopeIdentity`). If v2 is
edge/Worker-shaped, the `@the-metafactory/myelin/edge` + `/transport/websocket`
subpaths are the relevant surface.

### B. The drop is deliberate and gets ratified
If grove-v2 intentionally does **not** participate in the myelin bus (e.g. it is a
pure webhook/HTTP surface that never emits or verifies envelopes), then the drop
is correct — but it must be **documented** so no one later "fixes" it by re-adding
myelin, and so the ecosystem map stops treating grove as a transport consumer.

## Recommendation

**Surface to the grove owner; do not decide here.** The determining fact is
whether grove-v2 crosses the myelin bus at all. If yes → A (list the v1 symbols it
must replace, above). If no → B (write one paragraph in grove-v2's README + the
ecosystem CONTEXT-MAP recording the intentional drop).

## What this memo does NOT do

Add or remove any dependency, or edit grove-v1/v2. Human confirms intent.
