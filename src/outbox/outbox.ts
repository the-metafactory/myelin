import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import type { TransportPublisher } from "../transport/types";
import { startDrain, type DrainReport } from "./drain";

export interface OutboxOptions {
  /** Producer-owned spool file, shared by that producer's processes. */
  path: string;
  inner: TransportPublisher;
  /** Producer-owned log; defaults to console.error. */
  log?: (message: string) => void | Promise<void>;
}

export interface Outbox extends TransportPublisher {
  /** Startup replay result; resolves even when replay fails. */
  drained: Promise<DrainReport>;
}

/**
 * Node-only, fail-open publish decorator. Each signed envelope is appended
 * before sending, then acknowledged on successful send. Startup replay runs
 * in the background; short-lived producers can await `drained` before exit.
 * Request/reply and close retain the inner publisher's semantics.
 */
export function createOutbox({ path, inner, log = console.error }: OutboxOptions): Outbox {
  const { claimed, drained } = startDrain({ path, inner, log });
  async function report(stage: string, subject: string, id: string, error: unknown): Promise<void> {
    try {
      await log(`[myelin-outbox] ${stage} failed on ${subject} (${id}): ${error instanceof Error ? error.message : String(error)}`);
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
        await fs.mkdir(dirname(path), { recursive: true });
        await fs.appendFile(path, `${JSON.stringify({ op: "put", id: envelope.id, subject, envelope })}\n`, "utf8");
      } catch (error) {
        await report("spool put", subject, envelope.id, error);
      }

      try {
        await inner.publish(subject, envelope);
      } catch (error) {
        await report("publish", subject, envelope.id, error);
        return;
      }

      try {
        await fs.appendFile(path, `${JSON.stringify({ op: "ack", id: envelope.id })}\n`, "utf8");
      } catch (error) {
        await report("spool ack", subject, envelope.id, error);
      }
    },
    request: (subject, envelope, options) => inner.request(subject, envelope, options),
    close: () => inner.close(),
  };
}
