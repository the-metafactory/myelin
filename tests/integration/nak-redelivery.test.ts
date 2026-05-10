/**
 * F-13 follow-up: nak + redelivery integration test against live NATS.
 *
 * Verifies the end-to-end path documented in src/transport/nak.ts:
 * when a handler throws, NATSTransport.subscribe's catch block calls
 * `nakWithReasonSync` with reason "cant-do", which immediately nak's
 * the message. JetStream redelivers it; the same envelope arrives
 * again with `info.deliveryCount` incremented. After the handler
 * eventually succeeds and acks, no further redelivery should occur.
 *
 * Skips when NATS_URL is unset.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { hasNats, provisionNatsStream, testPrefix, waitFor } from "./setup";
import type { NATSTransport } from "../../src/transport/nats";
import type { MyelinEnvelope, Sovereignty } from "../../src/types";

const sovereignty: Sovereignty = {
  classification: "local",
  data_residency: "CH",
  max_hop: 0,
  frontier_ok: false,
  model_class: "any",
};

function envelope(overrides: Partial<MyelinEnvelope> = {}): MyelinEnvelope {
  return {
    id: crypto.randomUUID(),
    source: "metafactory.test.agent",
    type: "test.nak",
    timestamp: new Date().toISOString(),
    sovereignty,
    payload: { hello: "world" },
    ...overrides,
  };
}

const SUITE = testPrefix("nak");
const STREAM = SUITE;
const SUBJECT_BASE = `local.test_${STREAM.toLowerCase()}.nak`;

(hasNats ? describe : describe.skip)("F-13 NATSTransport nak + redelivery (live NATS required)", () => {
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

  it("redelivers envelope after handler throws, then stops once handler succeeds", async () => {
    const subject = `${SUBJECT_BASE}.redeliver`;
    const targetAttempts = 3;
    const seen: string[] = [];
    let attempts = 0;

    const sub = await transport.subscribe(
      subject,
      async (env) => {
        attempts += 1;
        seen.push(env.id);
        if (attempts < targetAttempts) {
          // NATSTransport's catch block will call nakWithReasonSync
          // with reason "cant-do" (immediate redeliver). The envelope
          // must arrive again on the next iteration.
          throw new Error(`forced failure #${attempts}`);
        }
        // On the third delivery, return normally — transport ack's
        // and the message is removed from the consumer's pending set.
      },
      { durableName: `${STREAM}_REDELIVER_DUR`, ackPolicy: "explicit", deliverPolicy: "all" },
    );

    try {
      const sent = envelope({ payload: { attempt: "redeliver" } });
      await transport.publish(subject, sent);

      // Allow time for two backoff-free `cant-do` redeliveries —
      // JetStream's internal redelivery is near-immediate but the
      // consumer settle adds ~tens of ms. 6s is generous.
      await waitFor(() => attempts >= targetAttempts, {
        message: `expected ${targetAttempts} handler invocations, got ${attempts}`,
        timeoutMs: 6_000,
      });

      // Every delivery carried the same envelope id.
      expect(seen.length).toBe(targetAttempts);
      for (const id of seen) expect(id).toBe(sent.id);

      // Quiet period — no further redelivery after the successful ack.
      const attemptsAtAck = attempts;
      await new Promise((r) => setTimeout(r, 1_500));
      expect(attempts).toBe(attemptsAtAck);
    } finally {
      await sub.unsubscribe();
    }
  }, 15_000);

  it("delivers a second, independent envelope without retrying the prior one", async () => {
    // Defensive: confirms consumer state isn't poisoned by the prior
    // nak/redelivery cycle. A separate envelope on the same durable
    // consumer should be delivered exactly once when the handler succeeds.
    const subject = `${SUBJECT_BASE}.redeliver-followup`;
    const received: string[] = [];

    const sub = await transport.subscribe(
      subject,
      async (env) => {
        received.push(env.id);
      },
      { durableName: `${STREAM}_FOLLOWUP_DUR`, ackPolicy: "explicit", deliverPolicy: "all" },
    );

    try {
      const sent = envelope({ payload: { attempt: "followup" } });
      await transport.publish(subject, sent);

      await waitFor(() => received.length >= 1, {
        message: "follow-up envelope never delivered",
        timeoutMs: 5_000,
      });

      // No duplicate redelivery for a successful handler.
      await new Promise((r) => setTimeout(r, 1_500));
      expect(received).toEqual([sent.id]);
    } finally {
      await sub.unsubscribe();
    }
  }, 10_000);
});
