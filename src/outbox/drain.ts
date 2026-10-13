import { promises as fs, type Dirent } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { MyelinEnvelope } from "../types";
import type { OutboxOptions } from "./outbox";

export interface DrainReport {
  sent: number;
  failed: number;
}

interface Put {
  op: "put";
  id: string;
  subject: string;
  envelope: MyelinEnvelope;
}

// Distinct claim names even for outboxes created in the same millisecond.
let lastClaimEpoch = 0;

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

/** Internal startup seam: publishes wait for claiming, never for replay. */
export function startDrain({ path, inner, log = console.error }: OutboxOptions): {
  claimed: Promise<void>;
  drained: Promise<DrainReport>;
} {
  let releaseClaim!: () => void;
  const claimed = new Promise<void>((resolve) => { releaseClaim = resolve; });
  const report: DrainReport = { sent: 0, failed: 0 };

  async function warn(context: string, error: unknown): Promise<void> {
    try {
      await log(`[myelin-outbox] drain ${context}: ${error instanceof Error ? error.message : String(error)}`);
    } catch {
      // Logging is best-effort, just like delivery.
    }
  }

  async function claim(): Promise<string[]> {
    const directory = dirname(path);
    let entries: Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (!isMissing(error)) await warn(`read directory ${directory} failed`, error);
      return [];
    }

    const prefix = `${basename(path)}.draining-`;
    const files = entries.filter((entry) => entry.isFile() && entry.name.startsWith(prefix))
      .map((entry) => entry.name).sort().map((name) => join(directory, name));
    const spool = entries.find((entry) => entry.name === basename(path));
    if (spool && !spool.isFile()) {
      await warn(`claim ${path} failed`, new Error("spool is not a regular file"));
    } else if (spool) {
      lastClaimEpoch = Math.max(Date.now(), lastClaimEpoch + 1);
      const target = `${path}.draining-${process.pid}-${lastClaimEpoch}`;
      try {
        await fs.rename(path, target);
        files.push(target);
      } catch (error) {
        await warn(`rename ${path} failed`, error);
      }
    }
    return files;
  }

  async function replay(file: string): Promise<void> {
    let contents: string;
    try {
      contents = await fs.readFile(file, "utf8");
    } catch (error) {
      if (!isMissing(error)) await warn(`read ${file} failed`, error);
      return;
    }

    const pending = new Map<string, Put>();
    const lines = contents.split("\n");
    for (const [index, line] of lines.entries()) {
      if (index === lines.length - 1 && line === "") continue;
      try {
        const record = JSON.parse(line) as Partial<Omit<Put, "op">> & { op?: string };
        if (!record || typeof record.id !== "string" || !record.id ||
            (record.op !== "put" && record.op !== "ack")) {
          throw new Error("expected put/ack and a non-empty id");
        }
        if (record.op === "ack") {
          pending.delete(record.id);
        } else {
          if (typeof record.subject !== "string" || !record.subject ||
              !record.envelope || typeof record.envelope !== "object" || record.envelope.id !== record.id) {
            throw new Error("put requires subject and envelope with matching id");
          }
          pending.set(record.id, record as Put);
        }
      } catch (error) {
        // Do not log raw spool data: envelopes may carry private content.
        await warn(`skip ${file} line ${index + 1}`, error instanceof SyntaxError ? "invalid JSON" : error);
      }
    }

    let retained = false;
    for (const entry of pending.values()) {
      try {
        await inner.publish(entry.subject, entry.envelope);
        report.sent++;
      } catch (error) {
        report.failed++;
        await warn(`publish on ${entry.subject} (${entry.id}) failed`, error);
        try {
          await fs.mkdir(dirname(path), { recursive: true });
          await fs.appendFile(path, `${JSON.stringify(entry)}\n`, "utf8");
        } catch (spoolError) {
          retained = true;
          await warn(`spool put on ${entry.subject} (${entry.id}) failed`, spoolError);
        }
      }
    }

    // If re-spooling failed, retain the claim rather than lose its entries.
    if (!retained) {
      try {
        await fs.unlink(file);
      } catch (error) {
        if (!isMissing(error)) await warn(`remove ${file} failed`, error);
      }
    }
  }

  const drained = (async () => {
    try {
      let files: string[];
      try {
        files = await claim();
      } finally {
        releaseClaim();
      }
      for (const file of files) await replay(file);
    } catch (error) {
      await warn("failed", error);
    }
    return report;
  })();

  return { claimed, drained };
}
