/**
 * F-14 example: pilot job dispatch with sovereignty + lifecycle events.
 *
 * Demonstrates F-019 task subjects + F-020 dispatch lifecycle. The
 * pilot orchestrator publishes a signed task envelope; a downstream
 * agent (echo) acknowledges and emits lifecycle events.
 *
 * Run: `bun examples/pilot-job.ts`
 */

import { utils } from "@noble/ed25519";
import {
  EnvelopeTransport,
  InMemoryTransport,
  generateCorrelationId,
  createLifecycleEmitter,
  subscribeLifecycle,
  bytesToBase64,
  type Sovereignty,
} from "@the-metafactory/myelin";

async function makeIdentity(did: string) {
  const secret = utils.randomSecretKey();
  return { did, privateKey: bytesToBase64(secret) };
}

async function main() {
  const pilot = await makeIdentity("did:mf:pilot");
  const echo = await makeIdentity("did:mf:echo");
  console.log(`pilot=${pilot.did} echo=${echo.did}`);

  const sovereignty: Sovereignty = {
    classification: "local",
    data_residency: "CH",
    max_hop: 0,
    frontier_ok: false,
    model_class: "any",
  };

  // Two EnvelopeTransports share one InMemoryTransport — they can
  // address each other through it.
  const inMemory = new InMemoryTransport();
  const pilotTransport = new EnvelopeTransport({
    publisher: inMemory, subscriber: inMemory, networkSovereignty: sovereignty,
    identity: pilot,
  });
  const echoTransport = new EnvelopeTransport({
    publisher: inMemory, subscriber: inMemory, networkSovereignty: sovereignty,
    identity: echo,
  });

  // Lifecycle subscriber observes EVERY dispatch.task.* event for
  // metafactory. In production this feeds dashboards, audit, billing.
  const lifecycleSub = await subscribeLifecycle({
    subscriber: inMemory,
    principal: "metafactory",
    handler: async (env) => {
      console.log("lifecycle:", {
        type: env.type,
        task_id: (env.payload as { task_id?: string }).task_id,
        principal: (env.payload as { principal?: string }).principal,
      });
    },
  });

  // Lifecycle emitter — publishes received/assigned/started/completed
  // through the pilot's EnvelopeTransport (transport-layer-signs
  // pattern from F-020).
  const lifecycle = createLifecycleEmitter({
    publisher: pilotTransport,
    principal: "metafactory",
    source: "metafactory.pilot.dispatch",
    sovereignty,
  });

  const correlation_id = generateCorrelationId();
  const task_id = generateCorrelationId();

  await lifecycle.received({
    task_id,
    correlation_id,
    distribution_mode: "delegate",
    target_principal: echo.did,
    requirements: ["code-review"],
  });

  // Echo subscribes to its direct-address subject (F-019 convention:
  // tasks.@{principal}.{capability}; principal-encoding `:`→`-`).
  const echoSub = await echoTransport.subscribe(
    "local.metafactory.tasks.@did-mf-echo.code-review",
    async (envelope) => {
      console.log("echo received task:", { id: envelope.id, payload: envelope.payload });
      await lifecycle.started({ task_id, correlation_id, distribution_mode: "delegate", principal: echo.did });
      await lifecycle.completed({ task_id, correlation_id, distribution_mode: "delegate", principal: echo.did });
    },
  );

  // Assigned BEFORE publish — InMemoryTransport.publish() is synchronous
  // so the echo handler (started → completed) runs inline. Canonical
  // F-020 order: received → assigned → started → completed.
  await lifecycle.assigned({
    task_id,
    correlation_id,
    distribution_mode: "delegate",
    principal: echo.did,
    claimed_at: new Date().toISOString(),
  });

  await pilotTransport.publish(
    {
      source: "metafactory.pilot.dispatch",
      type: "tasks.code-review",
      payload: { pr_url: "https://example.com/pr/42" },
      correlation_id,
    },
    "local.metafactory.tasks.@did-mf-echo.code-review",
  );

  await new Promise((r) => setTimeout(r, 30));
  await echoSub.unsubscribe();
  await lifecycleSub.unsubscribe();
  await inMemory.close();
}

main().catch((err) => {
  console.error("pilot-job example failed:", err);
  process.exit(1);
});
