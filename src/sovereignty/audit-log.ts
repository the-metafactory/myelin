import type { JetStreamClient, JetStreamManager } from "@nats-io/jetstream";
import type { AuditDecision, AuditDirection, AuditEntry } from "./types";

/**
 * F-5 T-3.x sovereignty audit log on JetStream.
 *
 * Decisions about envelopes (allow / block at egress / ingress) are
 * emitted to `${subjectPrefix}.<decision>.<direction>` on a
 * file-backed JetStream stream (defaults to `_AUDIT` with the
 * subject filter `_audit.sovereignty.>`, 90-day retention). Emit is
 * fire-and-forget: the call returns immediately; failures surface
 * through `onPublishError` so they never block the hot validation
 * path.
 */

export const AUDIT_STREAM_DEFAULT = "_AUDIT";
export const AUDIT_SUBJECT_PREFIX_DEFAULT = "_audit.sovereignty";
/** 90 days in nanoseconds (jetstream max_age unit). Fits in JS number. */
export const AUDIT_RETENTION_NS_DEFAULT = 90 * 24 * 60 * 60 * 1_000_000_000;

export interface AuditLog {
  /** Fire-and-forget emit. Errors surface through `onPublishError`. */
  emit(entry: AuditEntry): void;
  /** Await any in-flight publishes, then release resources. */
  close(): Promise<void>;
}

export interface AuditLogOptions {
  /** JetStream client used for publish. */
  js: JetStreamClient;
  /** JetStream manager used to provision the audit stream on first init. */
  jsm: JetStreamManager;
  /** Stream name. Defaults to `_AUDIT`. */
  stream?: string;
  /** Subject prefix. Defaults to `_audit.sovereignty`. */
  subjectPrefix?: string;
  /** Stream max_age in nanoseconds. Defaults to 90 days. */
  retentionNs?: number;
  /** Number of replicas. Defaults to 1. */
  numReplicas?: number;
  /** Callback for publish failures. Defaults to `console.error`. */
  onPublishError?: (error: Error, entry: AuditEntry) => void;
}

export function auditSubject(
  prefix: string,
  decision: AuditDecision,
  direction: AuditDirection,
): string {
  return `${prefix}.${decision}.${direction}`;
}

/**
 * Provision the audit JetStream stream (idempotent) and return an
 * `AuditLog` bound to it. The stream is created with:
 *   - subjects: `${subjectPrefix}.>`
 *   - retention: limits, max_age = retentionNs
 *   - storage: file
 *   - discard: old
 */
export async function createAuditLog(options: AuditLogOptions): Promise<AuditLog> {
  const stream = options.stream ?? AUDIT_STREAM_DEFAULT;
  const subjectPrefix = options.subjectPrefix ?? AUDIT_SUBJECT_PREFIX_DEFAULT;
  const subjectFilter = `${subjectPrefix}.>`;
  const retentionNs = options.retentionNs ?? AUDIT_RETENTION_NS_DEFAULT;
  const numReplicas = options.numReplicas ?? 1;
  const onPublishError =
    options.onPublishError ??
    ((err, entry) => {
      console.error(
        `[sovereignty] audit emit failed for envelope ${entry.envelope_id}: ${err.message}`,
      );
    });

  await ensureAuditStream(options.jsm, {
    stream,
    subjectFilter,
    retentionNs,
    numReplicas,
  });

  const encoder = new TextEncoder();
  const pending = new Set<Promise<unknown>>();
  let closed = false;

  return {
    emit(entry: AuditEntry): void {
      if (closed) return;
      const subject = auditSubject(subjectPrefix, entry.decision, entry.direction);
      const payload = encoder.encode(JSON.stringify(entry));
      const p = options.js
        .publish(subject, payload)
        .then(() => undefined)
        .catch((err) => {
          onPublishError(err instanceof Error ? err : new Error(String(err)), entry);
        });
      pending.add(p);
      void p.finally(() => pending.delete(p));
    },
    async close(): Promise<void> {
      closed = true;
      if (pending.size === 0) return;
      await Promise.allSettled([...pending]);
    },
  };
}

interface EnsureAuditStreamOptions {
  stream: string;
  subjectFilter: string;
  retentionNs: number;
  numReplicas: number;
}

async function ensureAuditStream(
  jsm: JetStreamManager,
  opts: EnsureAuditStreamOptions,
): Promise<void> {
  try {
    await jsm.streams.info(opts.stream);
    return;
  } catch (err) {
    // Expected case: stream not yet provisioned — fall through to add().
    // Anything else (network timeout, auth error, transient broker fault)
    // is also recoverable via add(), but log the original cause so it
    // isn't silently shadowed by the secondary add() error.
    const message = err instanceof Error ? err.message : String(err);
    if (!/not.found|does.not.exist/i.test(message)) {
      console.warn(
        `[sovereignty] jsm.streams.info('${opts.stream}') failed (${message}); attempting add()`,
      );
    }
  }
  await jsm.streams.add({
    name: opts.stream,
    subjects: [opts.subjectFilter],
    retention: "limits" as never,
    max_age: opts.retentionNs,
    storage: "file" as never,
    discard: "old" as never,
    num_replicas: opts.numReplicas,
  });
}
