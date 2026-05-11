/**
 * F-13/F-17 follow-up: integration test for NATSTransport.getConsumerHealth.
 *
 * Verifies the JetStream consumer.info() snapshot — counts of pending,
 * ack-pending, redelivered, and delivered-seq — surfaces correctly
 * through the new public method against a live broker.
 *
 * Skips when NATS_URL is unset.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { envelope, hasNats, provisionNatsStream, testPrefix, waitFor } from "./setup";
import type { ConsumerHealth, NATSTransport } from "../../src/transport/nats";

const SUITE = testPrefix("chealth");
const STREAM = SUITE;
const SUBJECT_BASE = `local.test_${STREAM.toLowerCase()}.events`;

(hasNats ? describe : describe.skip)("F-17 NATSTransport.getConsumerHealth (live NATS required)", () => {
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

  it("returns null for an unknown durable consumer", async () => {
    const result = await transport.getConsumerHealth(`NEVER_BOUND_${STREAM}`);
    expect(result).toBeNull();
  });

  it("returns counts that grow as messages are published and acked", async () => {
    const subject = `${SUBJECT_BASE}.health`;
    const durableName = `${STREAM}_HEALTH_DUR`;
    const acked: string[] = [];

    // Subscribe creates the consumer and starts the deliver loop. The
    // handler succeeds on every message — acks are automatic via the
    // transport's catch-free path.
    const sub = await transport.subscribe(
      subject,
      async (env) => {
        acked.push(env.id);
      },
      { durableName, ackPolicy: "explicit", deliverPolicy: "all" },
    );

    try {
      // Publish 3 envelopes, wait for delivery, then snapshot health.
      const sent: string[] = [];
      for (let i = 0; i < 3; i++) {
        const e = envelope({ payload: { i } });
        sent.push(e.id);
        await transport.publish(subject, e);
      }
      await waitFor(() => acked.length === 3, {
        message: "expected 3 deliveries before health snapshot",
        timeoutMs: 5_000,
      });

      const health = await transport.getConsumerHealth(durableName);
      expect(health).not.toBeNull();
      expect(health!.durableName).toBe(durableName);
      expect(health!.streamName).toBe(STREAM);
      // All 3 were delivered and acked.
      expect(health!.deliveredConsumerSeq).toBeGreaterThanOrEqual(3);
      expect(health!.ackFloorConsumerSeq).toBeGreaterThanOrEqual(3);
      // No outstanding work.
      expect(health!.pending).toBe(0);
      expect(health!.ackPending).toBe(0);
      // No nak cycles in this test path.
      expect(health!.redelivered).toBe(0);
    } finally {
      await sub.unsubscribe();
    }
  }, 15_000);

  it("reports redelivered > 0 after a nak/redeliver cycle", async () => {
    const subject = `${SUBJECT_BASE}.health-nak`;
    const durableName = `${STREAM}_HEALTH_NAK_DUR`;
    let attempts = 0;

    const sub = await transport.subscribe(
      subject,
      async () => {
        attempts++;
        if (attempts === 1) {
          // First delivery throws → transport nak's with "cant-do" →
          // immediate redeliver → second delivery succeeds.
          throw new Error("forced once");
        }
      },
      { durableName, ackPolicy: "explicit", deliverPolicy: "all" },
    );

    try {
      await transport.publish(subject, envelope({ payload: { kind: "health-nak" } }));
      await waitFor(() => attempts >= 2, {
        message: `expected at least 2 deliveries, got ${attempts}`,
        timeoutMs: 6_000,
      });

      // consumer.info() is eventually consistent — the ack we just
      // observed in the handler may not have propagated to the consumer's
      // info response yet. Poll for the expected counts so the test
      // doesn't flake on slow CI.
      const health = await waitFor<ConsumerHealth | null>(
        async () => {
          const h = await transport.getConsumerHealth(durableName);
          if (h && h.redelivered >= 1 && h.ackPending === 0) return h;
          return null;
        },
        {
          message: "consumer info never reflected redelivered>=1 + ackPending==0",
          timeoutMs: 5_000,
          intervalMs: 100,
        },
      );
      expect(health).not.toBeNull();
      expect(health!.redelivered).toBeGreaterThanOrEqual(1);
      expect(health!.ackPending).toBe(0);
    } finally {
      await sub.unsubscribe();
    }
  }, 15_000);
});
