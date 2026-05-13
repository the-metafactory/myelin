/**
 * myelin#107 — integration test covering the `discard` knob on
 * `NATSTransport.ensureStream()`.
 *
 * Verifies the round-trip from the public API arg → JetStream stream
 * config → server-side stream info. Catches drift if a future refactor
 * silently drops the arg or pins the value back to `"old"`.
 *
 * Skipped when NATS_URL is unset.
 *
 * Run locally:
 *   docker compose -f docker-compose.test.yml up -d
 *   NATS_URL=nats://localhost:4222 bun test tests/integration/ensure-stream-discard.test.ts
 *   docker compose -f docker-compose.test.yml down
 */
import { afterAll, describe, expect, it } from "bun:test";
import { connect, type NatsConnection } from "@nats-io/transport-node";
import { jetstreamManager } from "@nats-io/jetstream";
import { hasNats, NATS_URL, testPrefix } from "./setup";
import { NATSTransport } from "../../src/transport/nats";

const suite = hasNats ? describe : describe.skip;

suite("F-13 ensureStream — discard policy (myelin#107)", () => {
  const created: Array<{ transport: NATSTransport; streamName: string }> = [];

  // A separate, read-only NATS client used to verify what landed on the
  // server. Decouples assertion from any internal state the transport
  // might cache between ensureStream and a subsequent info() call.
  let probe: NatsConnection | undefined;

  async function getProbeJsm() {
    if (!probe) probe = await connect({ servers: NATS_URL });
    // Honor NATS_JS_DOMAIN when set so local-leaf-node setups work
    // (e.g., `domain: leaf-jc` in the host nats config); CI's
    // docker-compose nats runs without a domain and ignores it.
    const domain = process.env.NATS_JS_DOMAIN;
    return jetstreamManager(probe, domain ? { domain } : undefined);
  }

  afterAll(async () => {
    for (const { transport, streamName } of created) {
      try {
        const jsm = await getProbeJsm();
        await jsm.streams.delete(streamName);
      } catch {
        // already gone — ignore
      }
      await transport.close();
    }
    if (probe) await probe.close();
  });

  async function ensureWithDiscard(
    discard: "old" | "new" | undefined,
    subjectSuffix: string,
  ) {
    const streamName = testPrefix("DISCARD");
    const subject = `local.test_${streamName.toLowerCase()}.${subjectSuffix}`;
    const transport = new NATSTransport({
      servers: NATS_URL,
      name: `myelin-test-${streamName}`,
      streamName,
      reconnect: true,
      maxReconnectAttempts: 5,
    });
    created.push({ transport, streamName });

    await transport.ensureStream(
      streamName,
      [`${subject}.>`],
      // Tiny storage budget — these tests only assert config shape, never publish.
      discard === undefined
        ? { maxBytes: 1 * 1024 * 1024 }
        : { discard, maxBytes: 1 * 1024 * 1024 },
    );

    const jsm = await getProbeJsm();
    const info = await jsm.streams.info(streamName);
    return info.config.discard;
  }

  it("defaults to discard='old' when config omitted (backward compatible)", async () => {
    const discard = await ensureWithDiscard(undefined, "default");
    // JetStream returns the discard policy as the string "old" or "new"
    // (the @nats-io/jetstream `DiscardPolicy` enum values match these
    // strings on the wire).
    expect(discard).toBe("old");
  });

  it("defaults to discard='old' when config supplies other knobs but not discard", async () => {
    // Ensure the new optional knob does not get clobbered when the caller
    // passes a config object without it (regression guard against future
    // refactors that read `config?.discard` incorrectly).
    const streamName = testPrefix("DISCARD");
    const subject = `local.test_${streamName.toLowerCase()}.partial`;
    const transport = new NATSTransport({
      servers: NATS_URL,
      name: `myelin-test-${streamName}`,
      streamName,
      reconnect: true,
      maxReconnectAttempts: 5,
    });
    created.push({ transport, streamName });

    await transport.ensureStream(streamName, [`${subject}.>`], {
      maxBytes: 1 * 1024 * 1024,
      retention: "limits",
    });

    const jsm = await getProbeJsm();
    const info = await jsm.streams.info(streamName);
    expect(info.config.discard).toBe("old");
  });

  it("accepts discard='new' and round-trips it through JetStream stream config", async () => {
    const discard = await ensureWithDiscard("new", "newdiscard");
    expect(discard).toBe("new");
  });

  it("accepts discard='old' explicitly", async () => {
    const discard = await ensureWithDiscard("old", "olddiscard");
    expect(discard).toBe("old");
  });
});
