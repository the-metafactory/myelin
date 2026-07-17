/**
 * F-5 T-8.x integration test for SovereignTransport against live NATS.
 *
 * Each case provisions a unique JetStream stream whose subject set
 * spans both the test's traffic subjects and the test's nak subject
 * prefix (made unique per case so JetStream's "no overlapping
 * subjects across streams" rule never trips). Subscribers use
 * `deliverPolicy: "all"` so they pick up envelopes the wrapper
 * published before subscribe was attached.
 *
 * Skipped when NATS_URL is unset.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { utils } from "@noble/ed25519";
import { NATSTransport } from "../../src/transport/nats";
import { createSovereigntyEngine } from "../../src/sovereignty/engine";
import { createInMemoryPolicyStore } from "../../src/sovereignty/policy-store";
import { testPolicy as policy } from "../../src/sovereignty/test-fixtures";
import {
  SovereigntyBlockedError,
  createSovereignTransport,
  type SovereigntyNakDetail,
} from "../../src/sovereignty/transport";
import type { MyelinEnvelope } from "../../src/types";
import type { SigningIdentity } from "../../src/identity/types";
import { hasNats, NATS_URL, sovereigntyEnvelope, testPrefix, waitFor } from "./setup";

// Enforcing-stack signing identity for the nak. A 3-segment DID name so the
// derived nak `source` is schema-valid.
const TEST_IDENTITY: SigningIdentity = {
  did: "did:mf:metafactory.echo.local",
  privateKey: Buffer.from(utils.randomSecretKey()).toString("base64"),
};

const suite = hasNats ? describe : describe.skip;

suite("F-5 SovereignTransport (integration)", () => {
  const streamsCreated: string[] = [];
  const transportsCreated: NATSTransport[] = [];

  async function freshStack(streamSubjects: string[]): Promise<{
    transport: NATSTransport;
    streamName: string;
    nakPrefix: string;
    sov: ReturnType<typeof createSovereignTransport>;
    ingressBlocks: SovereigntyNakDetail[];
  }> {
    const streamName = testPrefix("SOV_TX");
    // Per-test nak prefix keeps subjects unique across cases so
    // JetStream's "no overlapping subjects across streams" rule
    // doesn't trip when ensureStream runs in the next test.
    const nakPrefix = `_audit.t${streamName.toLowerCase()}`;
    streamsCreated.push(streamName);
    const transport = new NATSTransport({
      servers: NATS_URL,
      name: `myelin-test-${streamName}`,
      streamName,
      reconnect: true,
      maxReconnectAttempts: 5,
    });
    transportsCreated.push(transport);
    // One stream covers both traffic and nak subjects so a single
    // transport instance can consume either side.
    await transport.ensureStream(streamName, [...streamSubjects, `${nakPrefix}.>`]);
    const engine = createSovereigntyEngine({
      policyStore: createInMemoryPolicyStore({ initial: policy }),
    });
    const ingressBlocks: SovereigntyNakDetail[] = [];
    const sov = createSovereignTransport({
      transport,
      engine,
      signingIdentity: TEST_IDENTITY,
      nakSubjectPrefix: nakPrefix,
      onIngressBlock: (detail) => ingressBlocks.push(detail),
    });
    return { transport, streamName, nakPrefix, sov, ingressBlocks };
  }

  afterAll(async () => {
    if (!hasNats) return;
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
        // best-effort
      }
    }
  });

  it("allowed publish lands on the underlying stream", async () => {
    const { transport, streamName, sov } = await freshStack(["local.metafactory.tasks.>"]);
    const env = sovereigntyEnvelope("local");
    await sov.publish("local.metafactory.tasks.review", env);

    const received: MyelinEnvelope[] = [];
    const sub = await transport.subscribe(
      "local.metafactory.tasks.review",
      async (msg) => {
        received.push(msg);
      },
      { durableName: `consumer-${streamName}-allow`, deliverPolicy: "all" },
    );
    await waitFor(() => received.length >= 1, {
      timeoutMs: 2000,
      message: "envelope not delivered",
    });
    expect(received[0]!.id).toBe(env.id);
    await sub.unsubscribe();
  });

  it("blocked publish throws SovereigntyBlockedError and emits structured nak", async () => {
    const { transport, streamName, nakPrefix, sov } = await freshStack([
      "federated.metafactory.tasks.>",
    ]);
    const env = sovereigntyEnvelope("local");

    await expect(sov.publish("federated.metafactory.tasks.review", env)).rejects.toBeInstanceOf(
      SovereigntyBlockedError,
    );

    const nakSubject = `${nakPrefix}.egress.${env.id}`;
    const received: MyelinEnvelope[] = [];
    const sub = await transport.subscribe(
      nakSubject,
      async (msg) => {
        received.push(msg);
      },
      { durableName: `consumer-${streamName}-egressnak`, deliverPolicy: "all" },
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
    const { transport, streamName, nakPrefix, sov, ingressBlocks } = await freshStack([
      "federated.principal-b.tasks.>",
    ]);
    let handlerCalls = 0;
    await sov.subscribe(
      "federated.principal-b.tasks.review",
      async () => {
        handlerCalls += 1;
      },
      { durableName: `consumer-${streamName}-handler` },
    );

    const blocked = sovereigntyEnvelope("federated", {
      signed_by: [{ method: "ed25519", identity: "did:mf:rogue", signature: "x", at: new Date().toISOString() }],
    });
    await transport.publish("federated.principal-b.tasks.review", blocked);

    await waitFor(() => ingressBlocks.length >= 1, {
      timeoutMs: 3000,
      message: "ingress block observer never fired",
    });
    expect(handlerCalls).toBe(0);
    expect(ingressBlocks[0]!.code).toBe("compliance-block:unknown-principal");

    const nakSubject = `${nakPrefix}.ingress.${blocked.id}`;
    const received: MyelinEnvelope[] = [];
    const sub = await transport.subscribe(
      nakSubject,
      async (msg) => {
        received.push(msg);
      },
      { durableName: `consumer-${streamName}-ingressnak`, deliverPolicy: "all" },
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
