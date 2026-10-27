import type { TransportPublisher } from "../transport/types";
import { startDrain, type DrainReport } from "./drain";
import { ackRecord, appendRecord, putRecord } from "./spool";

export interface OutboxOptions {
  // glossary-ignore: path
  // the filesystem location of the spool file, not a Subject.
  /** Producer-owned spool file, shared by that producer's processes. */
  path: string;
  inner: TransportPublisher;
  /** Producer-owned log; defaults to console.error. */
  log?: (line: string) => void | Promise<void>;
}

export interface Outbox extends TransportPublisher {
  /** Startup replay result; resolves even when replay fails. */
  drained: Promise<DrainReport>;
}

// glossary-ignore: fail
// "fail-open" names the delivery stance, not a Nak.
/**
 * Node-only, fail-open publish decorator. Each signed envelope is appended
 * before sending, then acknowledged on successful send. Startup replay runs
 * in the background; short-lived producers can await `drained` before exit.
 * Request/reply and close retain the inner publisher's semantics.
 */
export function createOutbox({ path, inner, log = console.error }: OutboxOptions): Outbox {
  const { claimed, drained } = startDrain({ path, inner, log });
  async function report(stage: string, subject: string, id: string, cause: unknown): Promise<void> {
    try {
      await log(`[myelin-outbox] ${stage} failed on ${subject} (${id}): ${cause instanceof Error ? cause.message : String(cause)}`);
    } catch {
      // Logging must not turn a best-effort publish into a producer failure.
    }
  }

  return {
    drained,
    async publish(subject, envelope) {
      // Claim the old spool before appending; replay itself does not block us.
      await claimed;
      try {
        await appendRecord(path, putRecord(subject, envelope));
      } catch (cause) {
        await report("spool put", subject, envelope.id, cause);
      }

      try {
        await inner.publish(subject, envelope);
      } catch (cause) {
        await report("publish", subject, envelope.id, cause);
        return;
      }

      try {
        await appendRecord(path, ackRecord(envelope.id));
      } catch (cause) {
        await report("spool ack", subject, envelope.id, cause);
      }
    },
    request: (subject, envelope, options) => inner.request(subject, envelope, options),
    close: () => inner.close(),
  };
}
