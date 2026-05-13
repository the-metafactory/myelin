/**
 * F-5 T-10.3 — combined end-to-end integration test.
 *
 * Wires the full sovereignty stack exactly as `docs/sovereignty-operator.md`
 * §3 prescribes (KV PolicyStore → AuditLog → SovereigntyEngine →
 * SovereignTransport over NATSTransport), then exercises four flows
 * against live NATS:
 *
 *   1. Allowed egress publish round-trips + audit `allow.egress` lands.
 *   2. Blocked egress publish throws SovereigntyBlockedError + structured
 *      nak lands on `_nak.sovereignty.egress.<id>` + audit `block.egress`
 *      lands.
 *   3. Allowed ingress subscribe delivers envelope to handler + audit
 *      `allow.ingress` lands.
 *   4. Blocked ingress subscribe never calls handler + structured nak
 *      lands on `_nak.sovereignty.ingress.<id>` + audit `block.ingress`
 *      lands.
 *
 * Per-slice tests already cover the pieces (policy-store, audit-log,
 * engine, transport). This suite proves the parts compose correctly
 * under the operator-doc-driven wiring sequence.
 *
 * Conventions per cumulative Holly findings:
 *  - All stack instances are tracked in arrays and torn down in
 *    afterAll (not just the last). #86 cycle-1 flagged this.
 *  - Per-run unique stream/bucket/subject names avoid the JetStream
 *    "no overlapping subjects across streams" rule. #86 cycle-1.
 *  - Integration tests use `crypto.randomUUID()` for envelope IDs
 *    (isolation, not determinism). Different from unit-test convention.
 *  - Subscribers use `deliverPolicy: "all"` so pre-subscribe publishes
 *    are caught. #86 cycle-1.
 *  - Test policy imported from `src/sovereignty/test-fixtures.ts` —
 *    no fixture duplication.
 *
 * Skipped when NATS_URL is unset (CI provides it via docker-compose).
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { connect } from "@nats-io/transport-node";
import type { NatsConnection } from "@nats-io/nats-core";
import { jetstream, jetstreamManager } from "@nats-io/jetstream";
import type { JetStreamClient, JetStreamManager } from "@nats-io/jetstream";
import { Kvm } from "@nats-io/kv";
import { createAuditLog, type AuditLog } from "../../src/sovereignty/audit-log";
import { createSovereigntyEngine } from "../../src/sovereignty/engine";
import { createKVPolicyStore, type PolicyStore } from "../../src/sovereignty/policy-store";
import { testPolicy } from "../../src/sovereignty/test-fixtures";
import {
  SovereigntyBlockedError,
  createSovereignTransport,
  type SovereigntyNakDetail,
} from "../../src/sovereignty/transport";
import { NATSTransport } from "../../src/transport/nats";
import type { AuditEntry, NakReasonCode } from "../../src/sovereignty/types";
import type { MyelinEnvelope } from "../../src/types";
import { hasNats, NATS_URL, sovereigntyEnvelope, testPrefix, waitFor } from "./setup";

interface Stack {
  // Control-plane connection driving KV + JetStream manager.
  nc: NatsConnection;
  js: JetStreamClient;
  jsm: JetStreamManager;
  // Data-plane transport (its own NATS connection, opened lazily).
  natsTransport: NATSTransport;
  // Wired components — same order as operator doc §3.
  policyStore: PolicyStore;
  auditLog: AuditLog;
  sov: ReturnType<typeof createSovereignTransport>;
  // Per-run unique names.
  bucket: string;
  trafficStream: string;
  auditStream: string;
  nakPrefix: string;
  auditSubjectPrefix: string;
}

const suite = hasNats ? describe : describe.skip;

suite("F-5 sovereignty end-to-end (integration)", () => {
  const stacks: Stack[] = [];
  // Cumulative observer for ingress blocks across the whole suite.
  const ingressBlocks: SovereigntyNakDetail[] = [];

  let stack: Stack;

  /**
   * Wire the full stack as the operator doc prescribes. Stack is shared
   * across the 4 flow tests so we prove a single live wiring composes —
   * not 4 isolated mini-wirings.
   */
  async function buildStack(): Promise<Stack> {
    const bucket = testPrefix("SOV_E2E_POLICY");
    const trafficStream = testPrefix("SOV_E2E_TRAFFIC");
    const auditStream = testPrefix("SOV_E2E_AUDIT");
    // Per-run nak + audit subject prefixes scoped to this stack so
    // streams can be re-provisioned across reruns without tripping
    // JetStream's "no overlapping subjects across streams" rule.
    const nakPrefix = `_nak.t${trafficStream.toLowerCase()}`;
    const auditSubjectPrefix = `_audit.t${auditStream.toLowerCase()}`;

    // 0. Control-plane NATS connection (KV + JSM ride on this).
    const nc = await connect({ servers: NATS_URL, name: `myelin-test-${trafficStream}` });
    const js = jetstream(nc);
    const jsm = await jetstreamManager(nc);

    // 1. Provision the policy bucket with the canonical valid policy.
    //    Per operator doc §1+§2: operator-side action before consumer wiring.
    const kvm = new Kvm(nc);
    const kv = await kvm.create(bucket, { history: 3 });
    await kv.put("config", JSON.stringify(testPolicy));

    // 2. Wire the consumer-side stack in operator-doc §3 order.
    //    a) policy store + hot reload watcher.
    const policyStore = createKVPolicyStore({ kv });
    await policyStore.reload();
    await policyStore.watch();
    //    b) audit log on its own dedicated stream.
    const auditLog = await createAuditLog({
      js,
      jsm,
      stream: auditStream,
      subjectPrefix: auditSubjectPrefix,
    });
    //    c) engine orchestrates validators + emits audit entries.
    const engine = createSovereigntyEngine({ policyStore, auditLog });
    //    d) data-plane NATSTransport with its traffic + nak subjects on
    //       a single stream so subscribers can consume either side.
    const natsTransport = new NATSTransport({
      servers: NATS_URL,
      name: `myelin-test-data-${trafficStream}`,
      streamName: trafficStream,
      reconnect: true,
      maxReconnectAttempts: 5,
    });
    await natsTransport.ensureStream(trafficStream, [
      "local.metafactory.tasks.>",
      "federated.metafactory.tasks.>",
      "federated.operator-b.tasks.>",
      `${nakPrefix}.>`,
    ]);
    //    e) SovereignTransport wraps the data-plane transport.
    const sov = createSovereignTransport({
      transport: natsTransport,
      engine,
      nakSubjectPrefix: nakPrefix,
      onIngressBlock: (detail) => ingressBlocks.push(detail),
    });

    return {
      nc,
      js,
      jsm,
      natsTransport,
      policyStore,
      auditLog,
      sov,
      bucket,
      trafficStream,
      auditStream,
      nakPrefix,
      auditSubjectPrefix,
    };
  }

  beforeAll(async () => {
    if (!hasNats) return;
    stack = await buildStack();
    stacks.push(stack);
  });

  /**
   * Operator doc §3 shutdown order: data plane → audit → policy store
   * watcher → control-plane connection. Tear down every stack, not
   * just the last — Holly cycle-1 review of #86 flagged a teardown
   * bug where freshStack() was iterated but only one was closed.
   */
  afterAll(async () => {
    if (!hasNats) return;
    for (const s of stacks) {
      // 1. Stop the data-plane transport.
      try {
        await s.sov.close();
      } catch {
        // best-effort
      }
      // 2. Flush + close audit log.
      try {
        await s.auditLog.close();
      } catch {
        // best-effort
      }
      // 3. Stop the KV watcher iterator.
      try {
        await s.policyStore.close();
      } catch {
        // best-effort
      }
      // 4. Delete provisioned streams + bucket via the control plane.
      try {
        await s.jsm.streams.delete(s.trafficStream);
      } catch {
        // best-effort
      }
      try {
        await s.jsm.streams.delete(s.auditStream);
      } catch {
        // best-effort
      }
      try {
        const kvm = new Kvm(s.nc);
        const kv = await kvm.open(s.bucket);
        await kv.destroy();
      } catch {
        // best-effort
      }
      // 5. Drain the control-plane connection last.
      try {
        await s.nc.close();
      } catch {
        // best-effort
      }
    }
  });

  /**
   * Pull the next matching audit entry off the audit stream. Each
   * call creates a uniquely-named consumer scoped by direction +
   * decision so we don't interleave reads across tests. Filter
   * subject narrows JetStream to the exact decision/direction so the
   * fetch returns the targeted entry without scanning unrelated ones.
   */
  async function fetchAuditEntry(
    s: Stack,
    direction: "egress" | "ingress",
    decision: "allow" | "block",
    envelopeId: string,
    consumerSuffix: string,
  ): Promise<AuditEntry> {
    const filterSubject = `${s.auditSubjectPrefix}.${decision}.${direction}`;
    const durableName = `e2e-${decision}-${direction}-${consumerSuffix}`;
    await s.jsm.consumers.add(s.auditStream, {
      durable_name: durableName,
      filter_subject: filterSubject,
      // `as never` — `@nats-io/jetstream` types `ack_policy` as an
      // enum (AckPolicy.Explicit etc.) and refuses the literal
      // string here even though the wire protocol accepts it. Same
      // workaround as `sovereignty-engine.test.ts` and
      // `sovereignty-audit-log.test.ts`.
      ack_policy: "explicit",
    });
    const consumer = await s.js.consumers.get(s.auditStream, durableName);
    let received: AuditEntry | null = null;
    await waitFor(
      async () => {
        const iter = await consumer.fetch({ max_messages: 8, expires: 1500 });
        for await (const msg of iter) {
          const entry = JSON.parse(new TextDecoder().decode(msg.data)) as AuditEntry;
          msg.ack();
          // Other tests in the suite may have shipped entries onto
          // the same decision/direction subject. Match on envelope_id
          // so we always return the one this test produced.
          if (entry.envelope_id === envelopeId) {
            received = entry;
            return true;
          }
        }
        return false;
      },
      {
        timeoutMs: 4000,
        intervalMs: 50,
        message: `no ${decision}.${direction} audit entry for envelope ${envelopeId}`,
      },
    );
    // `waitFor` only returns once the predicate populated `received`
    // — guaranteed non-null at this point. The double-cast in older
    // tests (`as unknown as AuditEntry`) is just the noisier form
    // of the same non-null assertion.
    return received!;
  }

  /**
   * Pull a structured nak envelope off `${nakPrefix}.<direction>.<id>`.
   * deliverPolicy: "all" guarantees we pick up the nak even though it
   * was published before this consumer attached.
   */
  async function fetchNakDetail(
    s: Stack,
    direction: "egress" | "ingress",
    envelopeId: string,
    consumerSuffix: string,
  ): Promise<SovereigntyNakDetail> {
    const subject = `${s.nakPrefix}.${direction}.${envelopeId}`;
    const collected: MyelinEnvelope[] = [];
    const sub = await s.natsTransport.subscribe(
      subject,
      async (msg) => {
        collected.push(msg);
      },
      {
        durableName: `e2e-nak-${direction}-${consumerSuffix}`,
        deliverPolicy: "all",
      },
    );
    try {
      await waitFor(() => collected.length >= 1, {
        timeoutMs: 3000,
        intervalMs: 50,
        message: `nak envelope not delivered on ${subject}`,
      });
    } finally {
      await sub.unsubscribe();
    }
    // Guaranteed non-null by the `waitFor` predicate (collected.length >= 1).
    const first = collected[0];
    if (!first) throw new Error(`unreachable: collected guaranteed non-empty above`);
    return first.payload as unknown as SovereigntyNakDetail;
  }

  it("allowed egress: publish round-trips and audit allow.egress lands", async () => {
    const env = sovereigntyEnvelope("local");
    const subject = "local.metafactory.tasks.review";

    await stack.sov.publish(subject, env);

    // Round-trip via the data plane to prove the envelope actually
    // made it onto the underlying stream — the wrapper didn't
    // short-circuit and synthesize a fake success.
    const received: MyelinEnvelope[] = [];
    const sub = await stack.natsTransport.subscribe(
      subject,
      async (msg) => {
        received.push(msg);
      },
      { durableName: `e2e-roundtrip-allow-egress`, deliverPolicy: "all" },
    );
    try {
      await waitFor(() => received.some((m) => m.id === env.id), {
        timeoutMs: 3000,
        intervalMs: 50,
        message: "allowed envelope never reached underlying stream",
      });
    } finally {
      await sub.unsubscribe();
    }

    const entry = await fetchAuditEntry(stack, "egress", "allow", env.id, "egress");
    expect(entry.envelope_id).toBe(env.id);
    expect(entry.decision).toBe("allow");
    expect(entry.direction).toBe("egress");
    expect(entry.subject).toBe(subject);
    expect(entry.classification).toBe("local");
    expect(entry.reason_code).toBeUndefined();
  });

  it("blocked egress: throws SovereigntyBlockedError, nak lands, audit block.egress lands", async () => {
    const env = sovereigntyEnvelope("local");
    const subject = "federated.metafactory.tasks.review"; // local→federated escape

    await expect(stack.sov.publish(subject, env)).rejects.toBeInstanceOf(SovereigntyBlockedError);

    const detail = await fetchNakDetail(stack, "egress", env.id, "egress");
    expect(detail.code).toBe<NakReasonCode>("compliance-block:classification-mismatch");
    expect(detail.direction).toBe("egress");
    expect(detail.envelope_id).toBe(env.id);
    expect(detail.subject).toBe(subject);

    const entry = await fetchAuditEntry(stack, "egress", "block", env.id, "egress");
    expect(entry.envelope_id).toBe(env.id);
    expect(entry.decision).toBe("block");
    expect(entry.direction).toBe("egress");
    expect(entry.subject).toBe(subject);
    expect(entry.reason_code).toBe("compliance-block:classification-mismatch");
  });

  it("allowed ingress: handler invoked and audit allow.ingress lands", async () => {
    // Per testPolicy: principal `did:mf:echo` is the imported principal
    // for partner `operator-b`, scope `federated.operator-b.tasks.>`,
    // capabilities `["code-review"]`. An envelope signed by `did:mf:echo`
    // arriving on a subject under that scope is allowed.
    const env = sovereigntyEnvelope("federated", {
      signed_by: [
        {
          method: "ed25519",
          principal: "did:mf:echo",
          signature: "x",
          at: new Date().toISOString(),
        },
      ],
    });
    const subject = "federated.operator-b.tasks.review";

    const handlerSeen: MyelinEnvelope[] = [];
    // No deliverPolicy override — default "new" is correct because
    // the publish happens AFTER the subscriber attaches. Forcing
    // "all" here would replay messages earlier tests landed on the
    // same `federated.operator-b.tasks.>` wildcard (the blocked
    // ingress case below in particular), polluting the assertion.
    const sub = await stack.sov.subscribe(
      subject,
      async (msg) => {
        handlerSeen.push(msg);
      },
      { durableName: `e2e-handler-allow-ingress` },
    );
    try {
      // Publish via the underlying transport so the envelope appears
      // on the wire exactly as a federation partner would deliver it
      // (no recursive egress validation through the wrapper).
      await stack.natsTransport.publish(subject, env);
      await waitFor(() => handlerSeen.some((m) => m.id === env.id), {
        timeoutMs: 3000,
        intervalMs: 50,
        message: "allowed federated envelope never reached handler",
      });
    } finally {
      await sub.unsubscribe();
    }

    const entry = await fetchAuditEntry(stack, "ingress", "allow", env.id, "ingress");
    expect(entry.envelope_id).toBe(env.id);
    expect(entry.decision).toBe("allow");
    expect(entry.direction).toBe("ingress");
    expect(entry.subject).toBe(subject);
    expect(entry.principal).toBe("did:mf:echo");
    expect(entry.reason_code).toBeUndefined();
  });

  it("blocked ingress: handler never called, nak lands, audit block.ingress lands", async () => {
    // Unknown principal — testPolicy rejects unknown partners.
    const env = sovereigntyEnvelope("federated", {
      signed_by: [
        {
          method: "ed25519",
          principal: "did:mf:rogue",
          signature: "x",
          at: new Date().toISOString(),
        },
      ],
    });
    const subject = "federated.operator-b.tasks.review";

    const ingressBlocksBefore = ingressBlocks.length;
    let handlerCalls = 0;
    // Default deliverPolicy ("new") — the publish that drives this
    // case happens AFTER subscribe attaches. Using "all" would
    // replay the allowed-ingress envelope from the previous test
    // case (signed by did:mf:echo, scope match) and the wrapper
    // would correctly forward it, lifting handlerCalls to 1 and
    // failing the assertion.
    const sub = await stack.sov.subscribe(
      subject,
      async () => {
        handlerCalls += 1;
      },
      { durableName: `e2e-handler-block-ingress` },
    );
    try {
      await stack.natsTransport.publish(subject, env);
      await waitFor(() => ingressBlocks.length > ingressBlocksBefore, {
        timeoutMs: 3000,
        intervalMs: 50,
        message: "ingress block observer never fired",
      });
    } finally {
      await sub.unsubscribe();
    }
    expect(handlerCalls).toBe(0);
    // `waitFor` above guarantees `ingressBlocks` grew by at least one
    // entry, so the last index is non-null.
    const lastBlock = ingressBlocks[ingressBlocks.length - 1];
    expect(lastBlock).toBeDefined();
    expect(lastBlock?.code).toBe("compliance-block:unknown-principal");

    const detail = await fetchNakDetail(stack, "ingress", env.id, "ingress");
    expect(detail.code).toBe<NakReasonCode>("compliance-block:unknown-principal");
    expect(detail.direction).toBe("ingress");
    expect(detail.envelope_id).toBe(env.id);
    expect(detail.subject).toBe(subject);

    const entry = await fetchAuditEntry(stack, "ingress", "block", env.id, "ingress");
    expect(entry.envelope_id).toBe(env.id);
    expect(entry.decision).toBe("block");
    expect(entry.direction).toBe("ingress");
    expect(entry.subject).toBe(subject);
    expect(entry.reason_code).toBe("compliance-block:unknown-principal");
    expect(entry.principal).toBe("did:mf:rogue");
  });
});
