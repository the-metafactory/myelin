import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { utils } from "@noble/ed25519";
import { createEnvelope } from "../envelope";
import { signEnvelope } from "../identity/sign";
import { InMemoryTransport } from "../transport/in-memory";
import type { MyelinEnvelope } from "../types";
import { createOutbox, type DrainReport, type Outbox } from "./index";

const subject = (id: string) => `local.grove.default.execution.${id}.finished`;
const envelope = (id: string): MyelinEnvelope => ({
  ...createEnvelope({
    source: "grove.default.bot", type: "execution.run.finished", payload: { run_id: id },
    sovereignty: { classification: "local", data_residency: "CH", max_hop: 0, frontier_ok: true, model_class: "any" },
  }),
  id,
  timestamp: "2026-10-13T00:00:00.000Z",
});
const put = (id: string) => ({ op: "put", id, subject: subject(id), envelope: envelope(id) });
const ack = (id: string) => ({ op: "ack", id });
const lines = (...records: unknown[]) => records.map((record) => JSON.stringify(record) + "\n").join("");
// The pid of a child that has already exited, so no live process owns its claims.
const deadPid = () => Bun.spawnSync(["true"]).pid;

describe("startup outbox drain", () => {
  let directory: string;
  let path: string;
  let inner: InMemoryTransport;
  let log: ReturnType<typeof mock<(message: string) => void | Promise<void>>>;
  let outboxes: Outbox[];

  beforeEach(async () => {
    directory = await fs.mkdtemp(join(tmpdir(), "myelin-drain-"));
    path = join(directory, "outbox.jsonl");
    inner = new InMemoryTransport();
    log = mock(() => {});
    outboxes = [];
  });

  afterEach(async () => {
    await Promise.all(outboxes.map((outbox) => outbox.drained));
    mock.restore();
    await inner.close();
    await fs.rm(directory, { recursive: true, force: true });
  });

  const start = () => {
    const outbox = createOutbox({ path, inner, log });
    outboxes.push(outbox);
    return outbox;
  };
  const claims = async () => (await fs.readdir(directory)).filter((name) => name.startsWith("outbox.jsonl.draining-"));

  test("replays only unacknowledged puts, in order, on original subjects with unchanged envelopes", async () => {
    const a = put("a");
    const b = put("b");
    const c = put("c");
    await fs.writeFile(path, lines(a, b, c, ack("b")));
    const received: { subject: string; envelope: MyelinEnvelope }[] = [];
    for (const entry of [a, b, c]) {
      await inner.subscribe(entry.subject, async (env) => { received.push({ subject: entry.subject, envelope: env }); });
    }
    const result: DrainReport = await start().drained;
    expect(result).toEqual({ sent: 2, failed: 0 });
    expect(received).toEqual([
      { subject: a.subject, envelope: a.envelope }, { subject: c.subject, envelope: c.envelope },
    ]);
    expect(await claims()).toEqual([]);
    expect(await fs.stat(path).catch(() => null)).toBeNull();
    expect(log).not.toHaveBeenCalled();
  });

  test("returns immediately, renames before replay, and publishes to a fresh spool during replay", async () => {
    await fs.writeFile(path, lines(put("a"), put("c")));
    const rename = spyOn(fs, "rename");
    const replayStarted = Promise.withResolvers<undefined>();
    const resume = Promise.withResolvers<undefined>();
    const received: string[] = [];
    await inner.subscribe("local.grove.default.execution.>", async (env) => {
      received.push(env.id);
      if (env.id === "a") {
        replayStarted.resolve(undefined);
        await resume.promise;
      }
    });
    const before = Date.now();
    const outbox = start();
    expect(outbox.drained).toBeInstanceOf(Promise);
    let finished = false;
    void outbox.drained.then(() => { finished = true; });
    await replayStarted.promise;
    try {
      expect(finished).toBe(false);
      const files = await claims();
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(new RegExp(`^outbox\\.jsonl\\.draining-${process.pid}-\\d+$`));
      expect(Number(files[0]!.split("-").at(-1))).toBeGreaterThanOrEqual(before);
      expect(rename).toHaveBeenCalledWith(path, join(directory, files[0]!));
      expect(await fs.stat(path).catch(() => null)).toBeNull();
      await outbox.publish(subject("new"), envelope("new"));
      expect(await fs.readFile(path, "utf8")).toBe(lines(put("new"), ack("new")));
    } finally {
      resume.resolve(undefined);
    }
    expect(await outbox.drained).toEqual({ sent: 2, failed: 0 });
    expect(received).toEqual(["a", "new", "c"]);
    expect(await claims()).toEqual([]);
  });

  test("preserves the signed envelope bytes and stable id", async () => {
    const signed = await signEnvelope(envelope("signed"), Buffer.from(utils.randomSecretKey()).toString("base64"), "did:mf:drain-test");
    await fs.writeFile(path, lines({ op: "put", id: signed.id, subject: subject(signed.id), envelope: signed }));
    const received: MyelinEnvelope[] = [];
    await inner.subscribe(subject(signed.id), async (env) => { received.push(env); });
    expect(await start().drained).toEqual({ sent: 1, failed: 0 });
    expect(received).toEqual([signed]);
    expect(JSON.stringify(received[0])).toBe(JSON.stringify(signed));
  });

  test("an immediate publish cannot enter the startup claim", async () => {
    await fs.writeFile(path, lines(put("old")));
    const received: string[] = [];
    await inner.subscribe("local.grove.default.execution.>", async (env) => { received.push(env.id); });
    const outbox = start();
    await outbox.publish(subject("new"), envelope("new"));
    expect(await outbox.drained).toEqual({ sent: 1, failed: 0 });
    expect(received.filter((id) => id === "new")).toEqual(["new"]);
    expect(await fs.readFile(path, "utf8")).toBe(lines(put("new"), ack("new")));
  });

  test("recovers leftover claims as well as the current spool", async () => {
    const dead = deadPid();
    await fs.writeFile(`${path}.draining-${dead}-1`, lines(put("a"), put("b"), ack("b")));
    await fs.writeFile(`${path}.draining-${dead}-2`, lines(put("c")));
    await fs.writeFile(path, lines(put("d")));
    await fs.writeFile(join(directory, `other.jsonl.draining-${dead}-1`), lines(put("other")));
    const received: string[] = [];
    await inner.subscribe("local.grove.default.execution.>", async (env) => { received.push(env.id); });
    expect(await start().drained).toEqual({ sent: 3, failed: 0 });
    expect(received).toEqual(["a", "c", "d"]);
    expect(await claims()).toEqual([]);
    expect(await fs.readdir(directory)).toEqual([`other.jsonl.draining-${dead}-1`]);
  });

  test("replays leftover claims in claim-time order, not pid order", async () => {
    const [higher, lower] = [deadPid(), deadPid()].sort((a, b) => b - a);
    await fs.writeFile(`${path}.draining-${higher}-1`, lines(put("first")));
    await fs.writeFile(`${path}.draining-${lower}-2`, lines(put("second")));
    const received: string[] = [];
    await inner.subscribe("local.grove.default.execution.>", async (env) => { received.push(env.id); });
    expect(await start().drained).toEqual({ sent: 2, failed: 0 });
    expect(received).toEqual(["first", "second"]);
  });

  test("two outboxes starting together on one spool deliver each entry once", async () => {
    await fs.writeFile(`${path}.draining-${deadPid()}-1`, lines(put("a")));
    await fs.writeFile(path, lines(put("b")));
    const received: string[] = [];
    await inner.subscribe("local.grove.default.execution.>", async (env) => { received.push(env.id); });
    const [first, second] = await Promise.all([start().drained, start().drained]);
    expect(first.sent + second.sent).toBe(2);
    expect(received.sort()).toEqual(["a", "b"]);
    expect(await claims()).toEqual([]);
    expect(log).not.toHaveBeenCalled();
  });

  test("leaves a live process's claim to that process", async () => {
    const live = `${path}.draining-${process.ppid}-1`;
    await fs.writeFile(live, lines(put("theirs")));
    await fs.writeFile(path, lines(put("ours")));
    const received: string[] = [];
    await inner.subscribe("local.grove.default.execution.>", async (env) => { received.push(env.id); });
    expect(await start().drained).toEqual({ sent: 1, failed: 0 });
    expect(received).toEqual(["ours"]);
    expect(await fs.readFile(live, "utf8")).toBe(lines(put("theirs")));
  });

  test("continues after a rejected send and re-spools the failure once for next start", async () => {
    await fs.writeFile(path, lines(put("a"), put("b"), put("c"), ack("b")));
    const publish = spyOn(inner, "publish");
    publish.mockRejectedValueOnce(new Error("bus offline"));
    const received: string[] = [];
    await inner.subscribe("local.grove.default.execution.>", async (env) => { received.push(env.id); });
    expect(await start().drained).toEqual({ sent: 1, failed: 1 });
    expect(received).toEqual(["c"]);
    expect(publish.mock.calls.map(([, env]) => env.id)).toEqual(["a", "c"]);
    expect(await fs.readFile(path, "utf8")).toBe(lines(put("a")));
    expect(await claims()).toEqual([]);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).toContain("(a)");
    expect(log.mock.calls[0]![0]).toContain("bus offline");
    expect(await start().drained).toEqual({ sent: 1, failed: 0 });
    expect(received).toEqual(["c", "a"]);
  });

  test("skips and logs malformed records while continuing replay", async () => {
    const invalid = ["not JSON", "null", "{}", '{"op":"put"}', '{"id":"a"}',
      '{"op":"other","id":"a"}', '{"op":"put","id":"a"}',
      JSON.stringify({ ...put("a"), envelope: envelope("mismatch") })];
    await fs.writeFile(path, lines(put("a")) + invalid.join("\n") + "\n" + lines(put("c")));
    const received: string[] = [];
    await inner.subscribe("local.grove.default.execution.>", async (env) => { received.push(env.id); });
    expect(await start().drained).toEqual({ sent: 2, failed: 0 });
    expect(received).toEqual(["a", "c"]);
    expect(log).toHaveBeenCalledTimes(invalid.length);
    expect(log.mock.calls.every(([message]) => message.includes("skip") && message.includes("line"))).toBe(true);
    expect(await claims()).toEqual([]);
  });

  test.each([false, true])("missing spool is silent (missing directory: %s)", async (missingDirectory) => {
    if (missingDirectory) path = join(directory, "missing", "outbox.jsonl");
    expect(await start().drained).toEqual({ sent: 0, failed: 0 });
    expect(log).not.toHaveBeenCalled();
  });

  test.each(["readdir", "rename"] as const)("contains %s failure and leaves publish working", async (operation) => {
    await fs.writeFile(path, lines(put("a")));
    spyOn(fs, operation).mockRejectedValueOnce(new Error(`${operation} denied`));
    const outbox = start();
    await expect(outbox.drained).resolves.toEqual({ sent: 0, failed: 0 });
    expect(log.mock.calls[0]![0]).toContain(`${operation} denied`);
    const received: string[] = [];
    await inner.subscribe(subject("new"), async (env) => { received.push(env.id); });
    await expect(outbox.publish(subject("new"), envelope("new"))).resolves.toBeUndefined();
    expect(received).toEqual(["new"]);
    expect(await fs.readFile(path, "utf8")).toBe(lines(put("a"), put("new"), ack("new")));
  });

  test.each(["throw", "reject"])("contains a logger that fails by %s", async (failure) => {
    await fs.writeFile(path, "invalid JSON\n" + lines(put("a")));
    log.mockImplementation(() => {
      if (failure === "throw") throw new Error("log unavailable");
      return Promise.reject(new Error("log unavailable"));
    });
    expect(await start().drained).toEqual({ sent: 1, failed: 0 });
    expect(await claims()).toEqual([]);
  });

  test("retains a claim when a failed send cannot be re-spooled", async () => {
    await fs.writeFile(path, lines(put("a"), put("c")));
    spyOn(inner, "publish").mockRejectedValueOnce(new Error("bus offline"));
    spyOn(fs, "appendFile").mockRejectedValueOnce(new Error("disk full"));
    expect(await start().drained).toEqual({ sent: 1, failed: 1 });
    expect(await claims()).toHaveLength(1);
    expect(log.mock.calls.some(([message]) => message.includes("(a)") && message.includes("disk full"))).toBe(true);
  });

  test("read and remove failures resolve with logs and preserve claims", async () => {
    await fs.writeFile(path, lines(put("a")));
    const read = spyOn(fs, "readFile").mockRejectedValueOnce(new Error("read denied"));
    expect(await start().drained).toEqual({ sent: 0, failed: 0 });
    expect(await claims()).toHaveLength(1);
    read.mockRestore();
    spyOn(fs, "unlink").mockRejectedValueOnce(new Error("remove denied"));
    expect(await start().drained).toEqual({ sent: 1, failed: 0 });
    expect(await claims()).toHaveLength(1);
    expect(log.mock.calls.some(([message]) => message.includes("read denied"))).toBe(true);
    expect(log.mock.calls.some(([message]) => message.includes("remove denied"))).toBe(true);
  });
});
