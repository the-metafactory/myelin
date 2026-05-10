# Integration tests

End-to-end tests that exercise `NATSTransport` against a running NATS server with JetStream. Complements the in-memory unit suite by catching transport-level issues only visible with real NATS semantics: durable consumer resume, JetStream replay ordering, ack/nak redelivery, reconnection.

## Skip-on-no-NATS

Every test in `tests/integration/` checks `process.env.NATS_URL`. Without it, the suite skips silently — `bun test` on a developer machine without docker stays green. CI sets `NATS_URL` and brings up the broker.

## Local

```bash
docker compose -f docker-compose.test.yml up -d
NATS_URL=nats://localhost:4222 bun test tests/integration
docker compose -f docker-compose.test.yml down
```

## CI

`.github/workflows/integration.yml` runs on every PR touching `src/`, `tests/integration/`, the docker-compose file, or the workflow itself, plus every push to `main`. The workflow spins up `nats:2.10-alpine` with JetStream (`-js`), sets `NATS_URL`, and runs `bun test tests/integration`.

## Adding tests

- Use `provisionNatsStream({ streamName, subjects })` from `setup.ts` to get a transport plus a per-suite stream. The `cleanup()` function deletes the stream and closes the transport.
- Suite names should pass through `testPrefix(suiteName)` so reruns and parallel suites don't collide on stream names.
- Use `waitFor()` to poll for asynchronous delivery; never `setTimeout(N)` and assume.
- Wrap the `describe` with `(hasNats ? describe : describe.skip)(...)` so the suite skips cleanly without NATS.

## Scope

This is the harness + a roundtrip suite. Additional suites can ride on the same scaffolding:

- `nak-redelivery.test.ts` — F-022 structured nak + max_deliver redelivery
- `reconnect.test.ts` — MY-201 transport recovery under partition (kill+restart sidecar)
- `creds-auth.test.ts` — credential file authentication path
- `dispatch-lifecycle.test.ts` — F-020 lifecycle envelopes hitting JetStream

Each follows the same skip-on-no-NATS pattern.
