/**
 * F-5 T-7.1 integration test — full engine + audit log + KV PolicyStore
 * wire-up against live NATS. Provisions a unique policy bucket and a
 * unique audit stream per case, runs validateEgress/validateIngress
 * decisions, consumes the audit entries back, and verifies subject +
 * payload shape.
 *
 * Skips when NATS_URL is unset.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { connect } from "@nats-io/transport-node";
import type { NatsConnection } from "@nats-io/nats-core";
import { jetstream, jetstreamManager } from "@nats-io/jetstream";
import type { JetStreamClient, JetStreamManager } from "@nats-io/jetstream";
import { Kvm } from "@nats-io/kv";
import { createAuditLog } from "../../src/sovereignty/audit-log";
import { createSovereigntyEngine } from "../../src/sovereignty/engine";
import { createKVPolicyStore } from "../../src/sovereignty/policy-store";
import type { AuditEntry, SovereigntyPolicy } from "../../src/sovereignty/types";
import type { MyelinEnvelope } from "../../src/types";
import { hasNats, NATS_URL, testPrefix, waitFor } from "./setup";

const policy: SovereigntyPolicy = {
  version: 1,
  org: "metafactory",
  egress: {
    block_local_escape: true,
    rules: [
      { classification: "local", allowed_subjects: ["local.metafactory.>"] },
      { classification: "federated", allowed_subjects: ["federated.metafactory.>"] },
      { classification: "public", allowed_subjects: ["public.>"] },
    ],
  },
  ingress: { scope_mappings: [], reject_unknown_partners: true },
  chain_of_stamps: { verify_delegation_sovereignty: false },
};

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

suite("F-5 SovereigntyEngine + AuditLog (integration)", () => {
  let nc: NatsConnection;
  let js: JetStreamClient;
  let jsm: JetStreamManager;
  let kvm: Kvm;
  const kvBuckets: string[] = [];
  const auditStreams: string[] = [];

  beforeAll(async () => {
    if (!hasNats) return;
    nc = await connect({ servers: NATS_URL, name: "myelin-test-engine-audit" });
    js = jetstream(nc);
    jsm = await jetstreamManager(nc);
    kvm = new Kvm(nc);
  });

  afterAll(async () => {
    if (!hasNats) return;
    for (const bucket of kvBuckets) {
      try {
        const kv = await kvm.open(bucket);
        await kv.destroy();
      } catch {
        // best-effort
      }
    }
    for (const stream of auditStreams) {
      try {
        await jsm.streams.delete(stream);
      } catch {
        // best-effort
      }
    }
    await nc.close();
  });

  async function freshFixture(): Promise<{
    bucket: string;
    auditStream: string;
    auditSubjectPrefix: string;
  }> {
    const bucket = testPrefix("SOV_POLICY");
    const auditStream = testPrefix("AUDIT");
    const auditSubjectPrefix = `_audit.t${auditStream.toLowerCase()}`;
    kvBuckets.push(bucket);
    auditStreams.push(auditStream);
    const kv = await kvm.create(bucket, { history: 3 });
    await kv.put("config", JSON.stringify(policy));
    return { bucket, auditStream, auditSubjectPrefix };
  }

  it("emits a JetStream audit entry for an allowed egress decision", async () => {
    const { bucket, auditStream, auditSubjectPrefix } = await freshFixture();
    const kv = await kvm.open(bucket);
    const store = createKVPolicyStore({ kv });
    await store.reload();
    const audit = await createAuditLog({
      js,
      jsm,
      stream: auditStream,
      subjectPrefix: auditSubjectPrefix,
    });
    const engine = createSovereigntyEngine({ policyStore: store, auditLog: audit });

    const env = envelope("local");
    const result = engine.validateEgress(env, "local.metafactory.tasks.review");
    expect(result.valid).toBe(true);
    await audit.close();
    await store.close();

    await jsm.consumers.add(auditStream, {
      durable_name: "engine-allow",
      ack_policy: "explicit",
    });
    const consumer = await js.consumers.get(auditStream, "engine-allow");
    let received: AuditEntry | null = null;
    await waitFor(
      async () => {
        const iter = await consumer.fetch({ max_messages: 1, expires: 2000 });
        for await (const msg of iter) {
          received = JSON.parse(new TextDecoder().decode(msg.data)) as AuditEntry;
          msg.ack();
          break;
        }
        return received !== null;
      },
      { timeoutMs: 3000, intervalMs: 50, message: "no allow entry on audit stream" },
    );
    const entry = received as unknown as AuditEntry;
    expect(entry.envelope_id).toBe(env.id);
    expect(entry.decision).toBe("allow");
    expect(entry.direction).toBe("egress");
    expect(entry.subject).toBe("local.metafactory.tasks.review");
  });

  it("emits a JetStream audit entry for a blocked egress decision", async () => {
    const { bucket, auditStream, auditSubjectPrefix } = await freshFixture();
    const kv = await kvm.open(bucket);
    const store = createKVPolicyStore({ kv });
    await store.reload();
    const audit = await createAuditLog({
      js,
      jsm,
      stream: auditStream,
      subjectPrefix: auditSubjectPrefix,
    });
    const engine = createSovereigntyEngine({ policyStore: store, auditLog: audit });

    const env = envelope("local");
    const result = engine.validateEgress(env, "federated.metafactory.tasks.review");
    expect(result.valid).toBe(false);
    await audit.close();
    await store.close();

    await jsm.consumers.add(auditStream, {
      durable_name: "engine-block",
      filter_subject: `${auditSubjectPrefix}.block.egress`,
      ack_policy: "explicit",
    });
    const consumer = await js.consumers.get(auditStream, "engine-block");
    let received: AuditEntry | null = null;
    await waitFor(
      async () => {
        const iter = await consumer.fetch({ max_messages: 1, expires: 2000 });
        for await (const msg of iter) {
          received = JSON.parse(new TextDecoder().decode(msg.data)) as AuditEntry;
          msg.ack();
          break;
        }
        return received !== null;
      },
      { timeoutMs: 3000, intervalMs: 50, message: "no block entry on audit stream" },
    );
    const entry = received as unknown as AuditEntry;
    expect(entry.envelope_id).toBe(env.id);
    expect(entry.decision).toBe("block");
    expect(entry.direction).toBe("egress");
    expect(entry.reason_code).toBe("compliance-block:classification-mismatch");
  });
});
