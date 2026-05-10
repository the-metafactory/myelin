/**
 * F-14 example: grove agent publishing a signed envelope.
 *
 * Demonstrates the L3 (envelope) + L4 (identity) + L2 (transport)
 * flow end to end:
 *   1. Provision a grove agent identity (Ed25519 keypair)
 *   2. Construct a signed envelope describing a pipeline event
 *   3. Publish through EnvelopeTransport (InMemoryTransport here so
 *      this runs without a NATS broker)
 *   4. Subscribe in a parallel handler to show round-trip
 *
 * Run: `bun examples/grove-agent.ts`
 */

import { utils, getPublicKeyAsync } from "@noble/ed25519";
import {
  EnvelopeTransport,
  InMemoryTransport,
  type Sovereignty,
} from "@the-metafactory/myelin";

function bytesToBase64(b: Uint8Array): string {
  return Buffer.from(b).toString("base64");
}

async function main() {
  // 1. Provision a grove agent identity. In production you'd persist
  //    keys via F-7 (`saveAgentIdentity` / `loadAgentIdentity`); here
  //    we generate fresh keys for demonstration.
  const groveSecret = utils.randomSecretKey();
  const grovePub = await getPublicKeyAsync(groveSecret);
  const grove = {
    did: "did:mf:grove",
    privateKey: bytesToBase64(groveSecret),
    publicKey: bytesToBase64(grovePub),
  };
  console.log(`provisioned identity: ${grove.did}`);

  // 2. Network sovereignty defines the org-wide envelope defaults. In
  //    production this lives in operator config. The agent layer can
  //    override per-message via input.sovereignty.
  const networkSovereignty: Sovereignty = {
    classification: "local",
    data_residency: "CH",
    max_hop: 0,
    frontier_ok: false,
    model_class: "any",
  };

  // 3. InMemoryTransport stands in for NATSTransport here so the
  //    example is self-contained.
  const inMemory = new InMemoryTransport();
  const transport = new EnvelopeTransport({
    publisher: inMemory,
    subscriber: inMemory,
    networkSovereignty,
    identity: { did: grove.did, privateKey: grove.privateKey },
  });

  // 4. Subscribe to grove pipeline events on the namespace convention
  //    from F-1 (local.{org}.grove.>).
  const subscription = await transport.subscribe(
    "local.metafactory.grove.>",
    async (envelope) => {
      console.log("received:", {
        id: envelope.id,
        type: envelope.type,
        source: envelope.source,
        signed_by: envelope.signed_by?.principal,
        classification: envelope.sovereignty.classification,
      });
    },
  );

  // 5. Publish a pipeline-completed event. EnvelopeTransport handles
  //    construction, sovereignty merging, validation, and signing.
  await transport.publish(
    {
      source: "metafactory.grove.pipeline",
      type: "grove.pipeline.completed",
      payload: { pipeline_id: "build-2026-05-10-001", status: "success", duration_ms: 12_345 },
    },
    "local.metafactory.grove.pipeline.completed",
  );

  // Allow in-memory delivery to flush.
  await new Promise((r) => setTimeout(r, 10));
  await subscription.unsubscribe();
  await transport.close();
}

main().catch((err) => {
  console.error("grove-agent example failed:", err);
  process.exit(1);
});
