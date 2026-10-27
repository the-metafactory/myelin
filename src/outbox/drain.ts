import { promises as fs, type Dirent } from "node:fs";
import { basename, dirname, join, resolve as resolvePath } from "node:path";
import type { OutboxOptions } from "./outbox";
import { appendRecord, putRecord, SPOOL_VERSION, type SpoolPut } from "./spool";

export interface DrainReport {
  sent: number;
  failed: number;
}

// Distinct claim names even for outboxes created in the same millisecond.
let lastClaimEpoch = 0;

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

function nextClaim(path: string): string {
  lastClaimEpoch = Math.max(Date.now(), lastClaimEpoch + 1);
  return `${path}.draining-${process.pid}-${lastClaimEpoch}`;
}

// Claims this process's outboxes are replaying right now.
const activeClaims = new Set<string>();

function isOwnedByLiveProcess(pid: number, claim: string): boolean {
  if (pid === process.pid) return activeClaims.has(claim);
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Internal startup seam: publishes wait for claiming, never for replay. */
export function startDrain({ path: spoolPath, inner, log = console.error }: OutboxOptions): {
  claimed: Promise<void>;
  drained: Promise<DrainReport>;
} {
  // One normalized spelling, so claim names compare equal across outboxes.
  const path = resolvePath(spoolPath);
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

    // Adopt leftover claims of dead processes, oldest first, by renaming each
    // to a claim of our own: a sibling racing for the same leftover loses the
    // rename, and a live process's claim stays with it.
    const prefix = `${basename(path)}.draining-`;
    const leftovers = entries.filter((entry) => entry.isFile() && entry.name.startsWith(prefix))
      .map((entry) => {
        const [pid = Number.NaN, epoch = 0] = entry.name.slice(prefix.length).split("-").map(Number);
        return { name: entry.name, pid, epoch };
      })
      .sort((a, b) => a.epoch - b.epoch || a.name.localeCompare(b.name));
    const files: string[] = [];
    // Register the claim before renaming so a sibling outbox never sees it unowned.
    async function take(source: string): Promise<boolean> {
      const target = nextClaim(path);
      activeClaims.add(target);
      try {
        await fs.rename(source, target);
        files.push(target);
        return true;
      } catch (error) {
        activeClaims.delete(target);
        if (isMissing(error)) return false;
        throw error;
      }
    }

    for (const leftover of leftovers) {
      const source = join(directory, leftover.name);
      if (Number.isInteger(leftover.pid) && isOwnedByLiveProcess(leftover.pid, source)) continue;
      try {
        await take(source);
      } catch (error) {
        await warn(`adopt ${leftover.name} failed`, error);
      }
    }

    const spool = entries.find((entry) => entry.name === basename(path));
    if (spool && !spool.isFile()) {
      await warn(`claim ${path} failed`, new Error("spool is not a regular file"));
    } else if (spool) {
      try {
        await take(path);
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

    const pending = new Map<string, SpoolPut>();
    const lines = contents.split("\n");
    for (const [index, line] of lines.entries()) {
      if (index === lines.length - 1 && line === "") continue;
      try {
        const parsed: unknown = JSON.parse(line);
        if (typeof parsed !== "object" || parsed === null) throw new Error("expected a JSON object");
        const record = parsed as Partial<Omit<SpoolPut, "op" | "v">> & { op?: string; v?: unknown };
        // Spools written before versioning carry no `v`; they are version 1.
        if (record.v !== undefined && record.v !== SPOOL_VERSION) {
          throw new Error("unsupported spool record version");
        }
        if (typeof record.id !== "string" || !record.id ||
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
          pending.set(record.id, record as SpoolPut);
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
          await appendRecord(path, putRecord(entry.subject, entry.envelope));
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
      for (const file of files) {
        try {
          await replay(file);
        } finally {
          activeClaims.delete(file);
        }
      }
    } catch (error) {
      await warn("failed", error);
    }
    return report;
  })();

  return { claimed, drained };
}
