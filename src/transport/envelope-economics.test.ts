import { describe, it, expect } from "bun:test";
import { utils, getPublicKeyAsync } from "@noble/ed25519";
import { verifyEnvelopeIdentity } from "../identity/verify";
import { createInMemoryRegistry } from "../identity/registry";
import type { MyelinEnvelope, Sovereignty } from "../types";
import { InMemoryTransport } from "./in-memory";
import { EnvelopeTransport } from "./envelope";
import type { EnvelopePublishInput } from "./types";
import type { SigningIdentity } from "../identity/types";

// node #321 — EnvelopeTransport forwards a caller's RFC-0009 economics block
// unchanged. The block sits in RFC-0004's mutable carve-out: it is NOT in the
// signed bytes, so signing still verifies and nobody may trust its values.

const sovereignty: Sovereignty = {
  classification: "local",
  data_residency: "CH",
  max_hop: 0,
  frontier_ok: true,
  model_class: "any",
};

const input: EnvelopePublishInput = {
  source: "metafactory.vigil.runner",
  type: "execution.run.finished",
  payload: { run: "r-1" },
};

function makeTransport(identity?: SigningIdentity) {
  const wire = new InMemoryTransport();
  const transport = new EnvelopeTransport({
    publisher: wire,
    subscriber: wire,
    networkSovereignty: sovereignty,
    ...(identity && { identity }),
  });
  const received: MyelinEnvelope[] = [];
  return { wire, transport, received };
}

async function capture(wire: InMemoryTransport, received: MyelinEnvelope[]) {
  await wire.subscribe("local.>", async (env) => {
    received.push(env);
  });
}

describe("EnvelopeTransport — economics", () => {
  it("publish carries economics to the subscriber", async () => {
    const { wire, transport, received } = makeTransport();
    await capture(wire, received);
    await transport.publish({ ...input, economics: { actual: { duration_ms: 1234 } } });
    expect(received).toHaveLength(1);
    expect(received[0]!.economics?.actual?.duration_ms).toBe(1234);
  });

  it("request envelope carries the same economics block", async () => {
    const { wire, transport } = makeTransport();
    let requestEnvelope: MyelinEnvelope | undefined;
    await wire.subscribe("local.>", async (env) => {
      const replyTo = env.extensions?.reply_to as string | undefined;
      if (!replyTo) return;
      requestEnvelope = env;
      await wire.publish(replyTo, {
        ...env,
        id: crypto.randomUUID(),
        type: "execution.run.ack",
        extensions: {},
      });
    });
    await transport.request({ ...input, economics: { actual: { duration_ms: 1234 } } });
    expect(requestEnvelope?.economics).toEqual({ actual: { duration_ms: 1234 } });
  });

  it("omits the economics key when the input has none", async () => {
    const { wire, transport, received } = makeTransport();
    await capture(wire, received);
    await transport.publish(input);
    expect("economics" in received[0]!).toBe(false);
  });

  it("rejects an invalid block before anything reaches the transport", async () => {
    const { wire, transport, received } = makeTransport();
    await capture(wire, received);
    await expect(
      transport.publish({ ...input, economics: { actual: { duration_ms: -1 } } }),
    ).rejects.toThrow(/^Envelope validation failed: economics\.actual\.duration_ms: /);
    expect(received).toHaveLength(0);
  });

  it("signed envelope with economics verifies, and economics stays outside the signed bytes", async () => {
    const privKey = utils.randomSecretKey();
    const pubKey = await getPublicKeyAsync(privKey);
    const identity: SigningIdentity = {
      did: "did:mf:test-bot",
      privateKey: Buffer.from(privKey).toString("base64"),
    };
    const { wire, transport, received } = makeTransport(identity);
    await capture(wire, received);
    await transport.publish({ ...input, economics: { actual: { duration_ms: 1234 } } });

    const registry = createInMemoryRegistry();
    registry.add({
      id: "did:mf:test-bot",
      display_name: "Test Bot",
      network: "OP_TEST",
      public_key: Buffer.from(pubKey).toString("base64"),
      type: "agent",
      created_at: new Date().toISOString(),
    });

    const env = received[0]!;
    expect(env.economics?.actual?.duration_ms).toBe(1234);
    expect((await verifyEnvelopeIdentity(env, registry)).status).toBe("verified");

    // RFC-0004 mutable carve-out: a relay may rewrite economics without
    // breaking the stamp — which is why the block is never trust-bearing.
    const rewritten = { ...env, economics: { actual: { duration_ms: 9999 } } };
    expect((await verifyEnvelopeIdentity(rewritten, registry)).status).toBe("verified");
  });
});
