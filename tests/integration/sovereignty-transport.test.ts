/**
 * F-5 T-8.x integration test for SovereignTransport against live NATS.
 *
 * Provisions a unique stream per case, wraps a real NATSTransport in
 * a SovereignTransport whose engine is bound to an in-memory policy
 * store, and verifies:
 *   - allowed publish lands on the underlying stream
 *   - blocked publish throws SovereigntyBlockedError and emits a
 *     structured nak envelope on `_nak.sovereignty.egress.<id>`
 *   - subscribe-side blocks fire onIngressBlock, never call the user
 *     handler, and surface a nak on `_nak.sovereignty.ingress.<id>`
 *
 * Skipped when NATS_URL is unset.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { NATSTransport } from "../../src/transport/nats";
import { createSovereigntyEngine } from "../../src/sovereignty/engine";
import { createInMemoryPolicyStore } from "../../src/sovereignty/policy-store";
import { testPolicy as policy } from "../../src/sovereignty/test-fixtures";
import {
  SOVEREIGNTY_NAK_PREFIX_DEFAULT,
  SovereigntyBlockedError,
  createSovereignTransport,
  type SovereigntyNakDetail,
} from "../../src/sovereignty/transport";
import type { MyelinEnvelope } from "../../src/types";
import { hasNats, NATS_URL, testPrefix, waitFor } from "./setup";

function envelope(
  classification: "local" | "federated" | "public",
  overrides: Partial<MyelinEnvelope> = {},
): MyelinEnvelope {
  return {
    id: crypto.randomUUID(),
    source: "metafactory.echo.local",
    type: "tasks.code-review",
    timestamp: new Date().toISOString(),
    sovereignty: {
      classification,
      data_residency: "CH",
      max_hop: 0,
      frontier_ok: false,
      model_class: "any",
    },
    payload: {},
    ...overrides,
  };
}

const suite = hasNats ? describe : describe.skip;

suite("F-5 SovereignTransport (integration)", () => {
  const streamsCreated: string[] = [];
  const transportsCreated: NATSTransport[] = [];

  async function freshStack(streamSubjects: string[]): Promise<{
    transport: NATSTransport;
    streamName: string;
    nakStreamName: string;
    sov: ReturnType<typeof createSovereignTransport>;
    ingressBlocks: SovereigntyNakDetail[];
  }> {
    const streamName = testPrefix("SOV_TX");
    const nakStreamName = testPrefix("SOV_NAK");
    streamsCreated.push(streamName, nakStreamName);
    const transport = new NATSTransport({
      servers: NATS_URL,
      name: `myelin-test-${streamName}`,
      streamName,
      reconnect: true,
      maxReconnectAttempts: 5,
    });
    transportsCreated.push(transport);
    await transport.ensureStream(streamName, streamSubjects);
    await transport.ensureStream(nakStreamName, [`${SOVEREIGNTY_NAK_PREFIX_DEFAULT}.>`]);
    const engine = createSovereigntyEngine({
      policyStore: createInMemoryPolicyStore({ initial: policy }),
    });
    const ingressBlocks: SovereigntyNakDetail[] = [];
    const sov = createSovereignTransport({
      transport,
      engine,
      onIngressBlock: (detail) => ingressBlocks.push(detail),
    });
    return { transport, streamName, nakStreamName, sov, ingressBlocks };
  }

  afterAll(async () => {
    if (!hasNats) return;
    // Best-effort stream cleanup via the first live transport — any of
    // them can address every stream we created.
    const cleaner = transportsCreated[0];
    if (cleaner) {
      for (const name of streamsCreated) {
        try {
          await cleaner.deleteStream(name);
        } catch {
          // best-effort
        }
      }
    }
    for (const t of transportsCreated) {
      try {
        await t.close();
      } catch {
        // best-effort — already closed or never connected
      }
    }
  });

  it("allowed publish lands on the underlying stream", async () => {
    const { transport, streamName, sov } = await freshStack(["local.metafactory.tasks.>"]);
    const env = envelope("local");
    await sov.publish("local.metafactory.tasks.review", env);

    const received: MyelinEnvelope[] = [];
    const sub = await transport.subscribe(
      "local.metafactory.tasks.review",
      async (msg) => {
        received.push(msg);
      },
      { durableName: `consumer-${streamName}-allow` },
    );
    await waitFor(() => received.length >= 1, {
      timeoutMs: 2000,
      message: "envelope not delivered",
    });
    expect(received[0]!.id).toBe(env.id);
    await sub.unsubscribe();
  });

  it("blocked publish throws SovereigntyBlockedError and emits structured nak", async () => {
    const { transport, nakStreamName, sov } = await freshStack(["federated.metafactory.tasks.>"]);
    const env = envelope("local");

    await expect(sov.publish("federated.metafactory.tasks.review", env)).rejects.toBeInstanceOf(
      SovereigntyBlockedError,
    );

    const nakSubject = `${SOVEREIGNTY_NAK_PREFIX_DEFAULT}.egress.${env.id}`;
    const received: MyelinEnvelope[] = [];
    const sub = await transport.subscribe(
      nakSubject,
      async (msg) => {
        received.push(msg);
      },
      { durableName: `consumer-${nakStreamName}-egressnak` },
    );
    await waitFor(() => received.length >= 1, {
      timeoutMs: 2000,
      message: "nak envelope not delivered",
    });
    const detail = received[0]!.payload as unknown as SovereigntyNakDetail;
    expect(detail.code).toBe("compliance-block:classification-mismatch");
    expect(detail.direction).toBe("egress");
    expect(detail.envelope_id).toBe(env.id);
    await sub.unsubscribe();
  });

  it("subscribe-side block: handler not called, onIngressBlock fires, ingress nak emitted", async () => {
    const { transport, nakStreamName, sov, ingressBlocks } = await freshStack(
      ["federated.operator-b.tasks.>"],
    );
    let handlerCalls = 0;
    await sov.subscribe(
      "federated.operator-b.tasks.review",
      async () => {
        handlerCalls += 1;
      },
      { durableName: `consumer-block` },
    );

    // Inject a federated envelope with an unknown principal directly via
    // the raw transport so it hits the wrapper's subscribe side.
    const blocked = envelope("federated", {
      signed_by: { method: "ed25519", principal: "did:mf:rogue", signature: "x", at: new Date().toISOString() },
    });
    await transport.publish("federated.operator-b.tasks.review", blocked);

    await waitFor(() => ingressBlocks.length >= 1, {
      timeoutMs: 3000,
      message: "ingress block observer never fired",
    });
    expect(handlerCalls).toBe(0);
    expect(ingressBlocks[0]!.code).toBe("compliance-block:unknown-principal");

    const nakSubject = `${SOVEREIGNTY_NAK_PREFIX_DEFAULT}.ingress.${blocked.id}`;
    const received: MyelinEnvelope[] = [];
    const sub = await transport.subscribe(
      nakSubject,
      async (msg) => {
        received.push(msg);
      },
      { durableName: `consumer-${nakStreamName}-ingressnak` },
    );
    await waitFor(() => received.length >= 1, {
      timeoutMs: 3000,
      message: "ingress nak envelope not delivered",
    });
    expect((received[0]!.payload as unknown as SovereigntyNakDetail).code).toBe(
      "compliance-block:unknown-principal",
    );
    await sub.unsubscribe();
  });
});
