/**
 * F-13: roundtrip integration test against a live NATS server.
 *
 * Skips when NATS_URL is unset so the suite is safe to run via
 * `bun test` on machines without a broker. CI sets NATS_URL via
 * docker-compose.test.yml + .github/workflows/integration.yml.
 *
 * Run locally:
 *   docker compose -f docker-compose.test.yml up -d
 *   NATS_URL=nats://localhost:4222 bun test tests/integration
 *   docker compose -f docker-compose.test.yml down
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { envelope, hasNats, provisionNatsStream, testPrefix, waitFor } from "./setup";
import type { NATSTransport } from "../../src/transport/nats";
import type { MyelinEnvelope } from "../../src/types";

const SUITE = testPrefix("roundtrip");
const STREAM = SUITE;
const SUBJECT_BASE = `local.test_${STREAM.toLowerCase()}.events`;

(hasNats ? describe : describe.skip)("F-13 NATSTransport roundtrip (live NATS required)", () => {
  let transport: NATSTransport;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const provisioned = await provisionNatsStream({
      streamName: STREAM,
      subjects: [`${SUBJECT_BASE}.>`],
    });
    transport = provisioned.transport;
    cleanup = provisioned.cleanup;
  });

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  it("publish/subscribe roundtrip preserves envelope identity", async () => {
    const subject = `${SUBJECT_BASE}.roundtrip`;
    const received: MyelinEnvelope[] = [];
    const sub = await transport.subscribe(
      subject,
      async (env) => {
        received.push(env);
      },
      { durableName: `${STREAM}_RT_DUR`, ackPolicy: "explicit", deliverPolicy: "all" },
    );
    try {
      const sent = envelope({ payload: { trip: "ok" } });
      await transport.publish(subject, sent);
      const got = await waitFor(() => (received.length > 0 ? received[0] : undefined), {
        message: "subscriber did not receive envelope",
      });
      expect(got).toBeDefined();
      expect(got!.id).toBe(sent.id);
      expect(got!.source).toBe(sent.source);
      expect(got!.type).toBe(sent.type);
      expect(got!.timestamp).toBe(sent.timestamp);
      expect(got!.payload).toEqual(sent.payload);
      expect(got!.sovereignty).toEqual(sent.sovereignty);
    } finally {
      await sub.unsubscribe();
    }
  });

  it("durable consumer receives only messages published while inactive (resume semantics)", async () => {
    const subject = `${SUBJECT_BASE}.resume`;
    const durableName = `${STREAM}_RESUME_DUR`;

    // First subscriber drains 5 envelopes, then disconnects.
    const firstReceived: string[] = [];
    const sub1 = await transport.subscribe(
      subject,
      async (env) => {
        firstReceived.push(env.id);
      },
      { durableName, ackPolicy: "explicit", deliverPolicy: "all" },
    );
    const sentFirst: string[] = [];
    for (let i = 0; i < 5; i++) {
      const e = envelope({ payload: { batch: "first", n: i } });
      sentFirst.push(e.id);
      await transport.publish(subject, e);
    }
    await waitFor(() => firstReceived.length === 5, {
      message: "first batch: expected 5 messages within timeout",
      timeoutMs: 8_000,
    });
    await sub1.unsubscribe();

    // Three more envelopes published while no subscriber is active.
    const sentSecond: string[] = [];
    for (let i = 0; i < 3; i++) {
      const e = envelope({ payload: { batch: "second", n: i } });
      sentSecond.push(e.id);
      await transport.publish(subject, e);
    }

    // Reconnect with the same durable name — must resume from last ack,
    // delivering only the 3 new envelopes (not the original 5).
    const secondReceived: string[] = [];
    const sub2 = await transport.subscribe(
      subject,
      async (env) => {
        secondReceived.push(env.id);
      },
      { durableName, ackPolicy: "explicit", deliverPolicy: "all" },
    );
    try {
      await waitFor(() => secondReceived.length === 3, {
        message: "second batch: expected 3 messages within timeout",
        timeoutMs: 8_000,
      });
      // Each second-batch id present, no duplicate of first-batch ids.
      for (const id of sentSecond) expect(secondReceived).toContain(id);
      for (const id of sentFirst) expect(secondReceived).not.toContain(id);
    } finally {
      await sub2.unsubscribe();
    }
  });

  it("JetStream replay delivers historical envelopes in order with deliverPolicy:all", async () => {
    const subject = `${SUBJECT_BASE}.replay`;

    // Publish first, subscribe second — the standard JetStream
    // persistence test. Without persistence, a late subscriber sees
    // nothing; with deliverPolicy:all it gets everything.
    const sentIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const e = envelope({ payload: { idx: i } });
      sentIds.push(e.id);
      await transport.publish(subject, e);
    }

    const replayed: MyelinEnvelope[] = [];
    const sub = await transport.subscribe(
      subject,
      async (env) => {
        replayed.push(env);
      },
      { durableName: `${STREAM}_REPLAY_DUR`, ackPolicy: "explicit", deliverPolicy: "all" },
    );
    try {
      await waitFor(() => replayed.length === 3, {
        message: "replay: expected 3 messages within timeout",
        timeoutMs: 8_000,
      });
      expect(replayed.map((e) => e.id)).toEqual(sentIds);
      // Timestamps preserved (JetStream doesn't rewrite envelope fields).
      replayed.forEach((e, i) => {
        expect((e.payload as { idx: number }).idx).toBe(i);
      });
    } finally {
      await sub.unsubscribe();
    }
  });
});
