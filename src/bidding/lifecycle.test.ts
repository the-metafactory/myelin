import { describe, it, expect } from "bun:test";
import { utils, getPublicKeyAsync } from "@noble/ed25519";
import { createBidLifecycleEvent } from "./lifecycle";
import type { Sovereignty } from "../types";
import type { SigningIdentity } from "../identity/types";

function bytesToBase64(b: Uint8Array): string {
  return Buffer.from(b).toString("base64");
}

async function makeIdentity(did: string): Promise<SigningIdentity> {
  const priv = utils.randomSecretKey();
  await getPublicKeyAsync(priv);
  return { did, privateKey: bytesToBase64(priv) };
}

const sovereignty: Sovereignty = {
  classification: "local",
  data_residency: "CH",
  max_hop: 0,
  frontier_ok: false,
  model_class: "any",
};

describe("createBidLifecycleEvent", () => {
  it("derives subject and emits a signed envelope", async () => {
    const identity = await makeIdentity("did:mf:cortex");
    const result = await createBidLifecycleEvent({
      org: "metafactory",
      source: "metafactory.cortex.dispatch",
      sovereignty,
      identity,
      type: "bid-opened",
      input: { task_id: "t1", participants: 0 },
    });
    expect(result.subject).toBe("local.metafactory.dispatch.task.bid-opened");
    expect(result.envelope.type).toBe("dispatch.task.bid-opened");
    expect(result.envelope.payload.task_id).toBe("t1");
    expect(result.envelope.signed_by?.principal).toBe("did:mf:cortex");
  });

  it("supports all 5 lifecycle event types", async () => {
    const identity = await makeIdentity("did:mf:cortex");
    const types = ["bid-opened", "bid-received", "bid-closed", "bid-retry", "assigned"] as const;
    for (const type of types) {
      const result = await createBidLifecycleEvent({
        org: "metafactory",
        source: "metafactory.cortex.dispatch",
        sovereignty,
        identity,
        type,
        input: { task_id: "t1" },
      });
      expect(result.envelope.type).toBe(`dispatch.task.${type}`);
    }
  });

  it("includes optional metadata in payload", async () => {
    const identity = await makeIdentity("did:mf:cortex");
    const result = await createBidLifecycleEvent({
      org: "metafactory",
      source: "metafactory.cortex.dispatch",
      sovereignty,
      identity,
      type: "assigned",
      input: { task_id: "t1", winner: "did:mf:luna", participants: 3, selection_reason: "lowest-load: 0.10" },
    });
    expect(result.envelope.payload.winner).toBe("did:mf:luna");
    expect(result.envelope.payload.participants).toBe(3);
    expect(result.envelope.payload.selection_reason).toBe("lowest-load: 0.10");
  });
});
