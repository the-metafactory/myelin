import { afterEach, describe, expect, it } from "bun:test";
import type {
  JetStreamClient,
  JetStreamManager,
  StreamConfig,
  StreamInfo,
} from "@nats-io/jetstream";
import {
  AUDIT_RETENTION_NS_DEFAULT,
  AUDIT_STREAM_DEFAULT,
  AUDIT_SUBJECT_FILTER_DEFAULT,
  AUDIT_SUBJECT_PREFIX_DEFAULT,
  auditSubject,
  createAuditLog,
} from "./audit-log";
import type { AuditEntry } from "./types";

interface PublishedMessage {
  subject: string;
  payload: Uint8Array;
}

interface FakeStream {
  config: Partial<StreamConfig>;
}

class FakeJsm {
  readonly addedStreams: FakeStream[] = [];
  existingStreams = new Set<string>();
  infoErrorOnce: string | null = null;

  streams = {
    info: async (name: string): Promise<StreamInfo> => {
      if (this.infoErrorOnce === name) {
        this.infoErrorOnce = null;
        throw new Error("stream not found");
      }
      if (!this.existingStreams.has(name)) {
        throw new Error(`unknown stream ${name}`);
      }
      return { config: { name } } as unknown as StreamInfo;
    },
    add: async (cfg: Partial<StreamConfig>): Promise<StreamInfo> => {
      this.addedStreams.push({ config: cfg });
      if (cfg.name) this.existingStreams.add(cfg.name);
      return { config: cfg } as unknown as StreamInfo;
    },
  };

  asJsm(): JetStreamManager {
    return this as unknown as JetStreamManager;
  }
}

class FakeJs {
  readonly published: PublishedMessage[] = [];
  failNextN = 0;

  async publish(subject: string, payload: Uint8Array): Promise<{ seq: number }> {
    if (this.failNextN > 0) {
      this.failNextN -= 1;
      throw new Error("publish-failure-injected");
    }
    this.published.push({ subject, payload });
    return { seq: this.published.length };
  }

  asJs(): JetStreamClient {
    return this as unknown as JetStreamClient;
  }
}

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    timestamp: "2026-05-11T13:00:00Z",
    envelope_id: "550e8400-e29b-41d4-a716-446655440000",
    direction: "egress",
    decision: "allow",
    subject: "local.metafactory.tasks.review",
    classification: "local",
    data_residency: "CH",
    ...overrides,
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("auditSubject", () => {
  it("derives `<prefix>.<decision>.<direction>`", () => {
    expect(auditSubject("_audit.sovereignty", "allow", "egress")).toBe(
      "_audit.sovereignty.allow.egress",
    );
    expect(auditSubject("_audit.sovereignty", "block", "ingress")).toBe(
      "_audit.sovereignty.block.ingress",
    );
  });
});

describe("createAuditLog — stream provisioning", () => {
  it("creates the audit stream when missing", async () => {
    const jsm = new FakeJsm();
    const js = new FakeJs();
    const log = await createAuditLog({ js: js.asJs(), jsm: jsm.asJsm() });
    expect(jsm.addedStreams.length).toBe(1);
    const cfg = jsm.addedStreams[0]!.config;
    expect(cfg.name).toBe(AUDIT_STREAM_DEFAULT);
    expect(cfg.subjects).toEqual([AUDIT_SUBJECT_FILTER_DEFAULT]);
    expect(cfg.max_age).toBe(AUDIT_RETENTION_NS_DEFAULT);
    expect(cfg.storage).toBe("file");
    expect(cfg.retention).toBe("limits");
    expect(cfg.discard).toBe("old");
    expect(cfg.num_replicas).toBe(1);
    await log.close();
  });

  it("is idempotent — does not re-add when stream exists", async () => {
    const jsm = new FakeJsm();
    jsm.existingStreams.add(AUDIT_STREAM_DEFAULT);
    const js = new FakeJs();
    const log = await createAuditLog({ js: js.asJs(), jsm: jsm.asJsm() });
    expect(jsm.addedStreams.length).toBe(0);
    await log.close();
  });

  it("respects custom stream + subjectPrefix + retentionNs + numReplicas", async () => {
    const jsm = new FakeJsm();
    const js = new FakeJs();
    const log = await createAuditLog({
      js: js.asJs(),
      jsm: jsm.asJsm(),
      stream: "_MY_AUDIT",
      subjectPrefix: "_audit.tenant",
      retentionNs: 7 * 24 * 60 * 60 * 1e9,
      numReplicas: 3,
    });
    const cfg = jsm.addedStreams[0]!.config;
    expect(cfg.name).toBe("_MY_AUDIT");
    expect(cfg.subjects).toEqual(["_audit.tenant.>"]);
    expect(cfg.max_age).toBe(7 * 24 * 60 * 60 * 1e9);
    expect(cfg.num_replicas).toBe(3);
    await log.close();
  });
});

describe("AuditLog.emit", () => {
  it("publishes to `<prefix>.<decision>.<direction>` with JSON payload", async () => {
    const jsm = new FakeJsm();
    const js = new FakeJs();
    const log = await createAuditLog({ js: js.asJs(), jsm: jsm.asJsm() });
    log.emit(entry({ decision: "allow", direction: "egress" }));
    await log.close();
    expect(js.published.length).toBe(1);
    expect(js.published[0]!.subject).toBe(`${AUDIT_SUBJECT_PREFIX_DEFAULT}.allow.egress`);
    const decoded = JSON.parse(new TextDecoder().decode(js.published[0]!.payload));
    expect(decoded.envelope_id).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(decoded.decision).toBe("allow");
    expect(decoded.direction).toBe("egress");
  });

  it("routes block + ingress to the corresponding subject", async () => {
    const jsm = new FakeJsm();
    const js = new FakeJs();
    const log = await createAuditLog({ js: js.asJs(), jsm: jsm.asJsm() });
    log.emit(entry({ decision: "block", direction: "ingress", reason_code: "compliance-block:unknown-principal" }));
    await log.close();
    expect(js.published[0]!.subject).toBe(`${AUDIT_SUBJECT_PREFIX_DEFAULT}.block.ingress`);
  });

  it("does not await ack in hot path — emit returns before publish resolves", async () => {
    const jsm = new FakeJsm();
    const js = new FakeJs();
    // Make publish() block on an external gate so we can prove the hot path
    // doesn't wait for it.
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const originalPublish = js.publish.bind(js);
    js.publish = (async (subject: string, payload: Uint8Array) => {
      await gate;
      return originalPublish(subject, payload);
    }) as typeof js.publish;

    const log = await createAuditLog({ js: js.asJs(), jsm: jsm.asJsm() });
    const start = Date.now();
    log.emit(entry());
    const elapsed = Date.now() - start;
    // emit() must return promptly even though publish is gated.
    expect(elapsed).toBeLessThan(10);
    expect(js.published.length).toBe(0);
    releaseGate();
    await log.close();
    expect(js.published.length).toBe(1);
  });

  it("surfaces publish failures through onPublishError without throwing", async () => {
    const jsm = new FakeJsm();
    const js = new FakeJs();
    js.failNextN = 1;
    const errors: Array<{ err: Error; entry: AuditEntry }> = [];
    const log = await createAuditLog({
      js: js.asJs(),
      jsm: jsm.asJsm(),
      onPublishError: (err, e) => errors.push({ err, entry: e }),
    });
    const e = entry();
    expect(() => log.emit(e)).not.toThrow();
    await log.close();
    expect(errors.length).toBe(1);
    expect(errors[0]!.err.message).toBe("publish-failure-injected");
    expect(errors[0]!.entry.envelope_id).toBe(e.envelope_id);
  });

  it("drops emits after close()", async () => {
    const jsm = new FakeJsm();
    const js = new FakeJs();
    const log = await createAuditLog({ js: js.asJs(), jsm: jsm.asJsm() });
    await log.close();
    log.emit(entry());
    await tick();
    expect(js.published.length).toBe(0);
  });

  it("close() awaits in-flight publishes", async () => {
    const jsm = new FakeJsm();
    const js = new FakeJs();
    const log = await createAuditLog({ js: js.asJs(), jsm: jsm.asJsm() });
    log.emit(entry());
    log.emit(entry({ envelope_id: "550e8400-e29b-41d4-a716-446655440001" }));
    log.emit(entry({ envelope_id: "550e8400-e29b-41d4-a716-446655440002" }));
    await log.close();
    expect(js.published.length).toBe(3);
  });
});

afterEach(() => {
  // No global state — keeps the symbol exported for clarity.
});
