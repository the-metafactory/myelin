/**
 * F-14 example: capability-filtered search via F-11 capability registry.
 *
 * Demonstrates F-11 agent capability discovery: agents register their
 * capabilities, the search side filters by capability tag, and only
 * matching agents are returned. No NATS broker needed — uses the
 * in-memory capability store.
 *
 * Run: `bun examples/arc-search.ts`
 */

import { utils, getPublicKeyAsync } from "@noble/ed25519";
import {
  signCapabilityRegistration,
  InMemoryCapabilityStore,
  verifyCapabilityRegistration,
  createInMemoryRegistry,
  bytesToBase64,
  type CapabilityAdvertisement,
  type Principal,
} from "@the-metafactory/myelin";

async function provisionAgent(did: string) {
  const secret = utils.randomSecretKey();
  const pub = await getPublicKeyAsync(secret);
  return {
    identity: { did, privateKey: bytesToBase64(secret) },
    publicKey: bytesToBase64(pub),
  };
}

async function main() {
  const store = new InMemoryCapabilityStore();
  const registry = createInMemoryRegistry();

  // Register three agents with different capabilities.
  const agents = [
    { did: "did:mf:luna", caps: ["code-review", "docs-check"] },
    { did: "did:mf:fern", caps: ["security-scan"] },
    { did: "did:mf:kai",  caps: ["code-review", "deploy"] },
  ];

  for (const a of agents) {
    const { identity, publicKey } = await provisionAgent(a.did);
    const principal: Principal = {
      id: a.did,
      operator: "metafactory",
      public_key: publicKey,
      type: "agent",
      created_at: new Date().toISOString(),
    };
    registry.add(principal);

    const advertisement: CapabilityAdvertisement = {
      principal: a.did,
      capabilities: a.caps,
      sovereignty: "open",
      load: 0.1,
      maxConcurrent: 4,
      updatedAt: new Date().toISOString(),
    };
    const signed = await signCapabilityRegistration(advertisement, identity);
    await store.put(signed);
    console.log(`registered ${a.did} → [${a.caps.join(", ")}]`);
  }

  // Arc-style capability filter: list every agent that can do
  // "code-review", verifying each registration against the principal
  // registry as we go.
  console.log("\nsearch capability=code-review:");
  const all = await store.list();
  for (const reg of all) {
    if (!reg.advertisement.capabilities.includes("code-review")) continue;
    const result = await verifyCapabilityRegistration(reg, registry);
    if (result.status !== "verified") {
      console.warn(`  ${reg.advertisement.principal} — UNVERIFIED (${result.reason})`);
      continue;
    }
    console.log(`  ${reg.advertisement.principal} (load=${reg.advertisement.load})`);
  }

  await store.close();
}

main().catch((err) => {
  console.error("arc-search example failed:", err);
  process.exit(1);
});
