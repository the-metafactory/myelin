import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import type { MyelinEnvelope } from "../types";

/** On-disk record format; bump when a record's shape changes. */
export const SPOOL_VERSION = 1;

export interface SpoolPut {
  v: typeof SPOOL_VERSION;
  op: "put";
  id: string;
  subject: string;
  envelope: MyelinEnvelope;
}

export interface SpoolAck {
  v: typeof SPOOL_VERSION;
  op: "ack";
  id: string;
}

export const putRecord = (subject: string, envelope: MyelinEnvelope): SpoolPut =>
  ({ v: SPOOL_VERSION, op: "put", id: envelope.id, subject, envelope });

export const ackRecord = (id: string): SpoolAck => ({ v: SPOOL_VERSION, op: "ack", id });

// glossary-ignore: path, error
// the filesystem location of the spool file, not a Subject; `error` is the thrown exception, not a Nak.
/**
 * One awaited append of one JSONL line, without fsync. The parent directory is
 * created only when the first append finds it missing, so the hot path is a
 * single syscall.
 */
export async function appendRecord(spoolPath: string, record: SpoolPut | SpoolAck): Promise<void> {
  const text = `${JSON.stringify(record)}\n`;
  try {
    await fs.appendFile(spoolPath, text, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await fs.mkdir(dirname(spoolPath), { recursive: true });
    await fs.appendFile(spoolPath, text, "utf8");
  }
}
