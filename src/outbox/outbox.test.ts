import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { utils } from "@noble/ed25519";
import { createEnvelope } from "../envelope";
import { signEnvelope } from "../identity/sign";
import { EnvelopeTransport } from "../transport/envelope";
import { InMemoryTransport } from "../transport/in-memory";
import type { MyelinEnvelope, Sovereignty } from "../types";
import { createOutbox } from "./index";

const sovereignty: Sovereignty = {
  classification: "local", data_residency: "CH", max_hop: 0,
  frontier_ok: true, model_class: "any",
};
const input = {
  source: "metafactory.grove.bot-01",
  type: "execution.run.finished",
  payload: { run_id: "run-test" },
};
const subject = "local.grove.default.execution.run.finished";
const identity = {
  did: "did:mf:outbox-test",
  privateKey: Buffer.from(utils.randomSecretKey()).toString("base64"),
};

describe("createOutbox", () => {
  let directory: string;
  let path: string;
  let inner: InMemoryTransport;
  let envelope: MyelinEnvelope;
  let log: ReturnType<typeof mock<(message: string) => void>>;

  beforeEach(async () => {
    directory = await fs.mkdtemp(join(tmpdir(), "myelin-outbox-"));
    path = join(directory, "outbox.jsonl");
    inner = new InMemoryTransport();
    envelope = await signEnvelope(createEnvelope({ ...input, payload: { ...input.payload }, sovereignty }), identity.privateKey, identity.did);
    log = mock(() => {});
  });

  afterEach(async () => {
    mock.restore();
    await inner.close();
    await fs.rm(directory, { recursive: true, force: true });
  });

  const put = (env: MyelinEnvelope) => ({ op: "put", id: env.id, subject, envelope: env });
  const ack = (env: MyelinEnvelope) => ({ op: "ack", id: env.id });
  const line = (record: unknown) => `${JSON.stringify(record)}\n`;

  test("writes put before delivery and ack after delivery, one appendFile per line", async () => {
    const append = spyOn(fs, "appendFile");
    const received: MyelinEnvelope[] = [];
    await inner.subscribe(subject, async (env) => {
      expect(await fs.readFile(path, "utf8")).toBe(line(put(envelope)));
      received.push(env);
    });

    await expect(createOutbox({ path, inner, log }).publish(subject, envelope)).resolves.toBeUndefined();

    expect(received).toEqual([envelope]);
    expect(received[0]).toBe(envelope);
    expect(await fs.readFile(path, "utf8")).toBe(line(put(envelope)) + line(ack(envelope)));
    expect(append.mock.calls).toEqual([
      [path, line(put(envelope)), "utf8"], [path, line(ack(envelope)), "utf8"],
    ]);
    expect(log).not.toHaveBeenCalled();
  });

  test("logs a failed send once, leaves put unacknowledged, and never retries", async () => {
    await inner.close();
    const publish = spyOn(inner, "publish");
    await expect(createOutbox({ path, inner, log }).publish(subject, envelope)).resolves.toBeUndefined();

    const spool = line(put(envelope));
    expect(await fs.readFile(path, "utf8")).toBe(spool);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).toContain(subject);
    expect(log.mock.calls[0]![0]).toContain(envelope.id);
    expect(log.mock.calls[0]![0]).toContain("Transport closed");
    await Bun.sleep(20);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(await fs.readFile(path, "utf8")).toBe(spool);
  });

  test("sends even when the spool parent cannot be created", async () => {
    const parent = join(directory, "file-as-parent");
    await fs.writeFile(parent, "not a directory");
    const received: MyelinEnvelope[] = [];
    await inner.subscribe(subject, async (env) => { received.push(env); });

    await expect(createOutbox({ path: join(parent, "outbox.jsonl"), inner, log })
      .publish(subject, envelope)).resolves.toBeUndefined();

    expect(received).toEqual([envelope]);
    expect(log.mock.calls.some(([message]) => message.includes("spool put") && message.includes(envelope.id))).toBe(true);
    expect(log.mock.calls.every(([message]) => message.includes(subject))).toBe(true);
  });

  test("logs both spool and send failures without rejecting", async () => {
    await fs.mkdir(path);
    await inner.close();
    await expect(createOutbox({ path, inner, log }).publish(subject, envelope)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0]![0]).toContain("spool put");
    expect(log.mock.calls[1]![0]).toContain("Transport closed");
    for (const [message] of log.mock.calls) {
      expect(message).toContain(subject);
      expect(message).toContain(envelope.id);
    }
  });

  test("creates missing parent directories on first publish", async () => {
    path = join(directory, "producer", "state", "outbox.jsonl");
    await createOutbox({ path, inner, log }).publish(subject, envelope);
    expect(await fs.readFile(path, "utf8")).toBe(line(put(envelope)) + line(ack(envelope)));
    expect(log).not.toHaveBeenCalled();
  });

  test("logs ack write failure after successful delivery", async () => {
    const pending = join(directory, "pending.jsonl");
    const received: MyelinEnvelope[] = [];
    await inner.subscribe(subject, async (env) => {
      received.push(env);
      await fs.rename(path, pending);
      await fs.mkdir(path);
    });
    await expect(createOutbox({ path, inner, log }).publish(subject, envelope)).resolves.toBeUndefined();
    expect(received).toEqual([envelope]);
    expect(await fs.readFile(pending, "utf8")).toBe(line(put(envelope)));
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).toContain("spool ack");
    expect(log.mock.calls[0]![0]).toContain(envelope.id);
  });

  test("contains serialization failure while still sending the envelope", async () => {
    envelope.payload.self = envelope.payload;
    const received: MyelinEnvelope[] = [];
    await inner.subscribe(subject, async (env) => { received.push(env); });
    await expect(createOutbox({ path, inner, log }).publish(subject, envelope)).resolves.toBeUndefined();
    expect(received[0]).toBe(envelope);
    expect(log.mock.calls[0]![0]).toContain("spool put");
  });

  test.each(["throw", "reject"])("contains a logger that fails by %s", async (failure) => {
    await fs.mkdir(path);
    await inner.close();
    const failingLog = mock((message: string) => {
      log(message);
      if (failure === "throw") throw new Error("logger unavailable");
      return Promise.reject(new Error("logger unavailable"));
    });
    await expect(createOutbox({ path, inner, log: failingLog }).publish(subject, envelope)).resolves.toBeUndefined();
    expect(failingLog).toHaveBeenCalledTimes(2);
  });

  test("defaults logging to console.error", async () => {
    const error = spyOn(console, "error").mockImplementation(() => {});
    await inner.close();
    await createOutbox({ path, inner }).publish(subject, envelope);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]![0]).toContain("[myelin-outbox]");
    expect(error.mock.calls[0]![0]).toContain("Transport closed");
  });

  test("spools exactly the signed envelope delivered by EnvelopeTransport", async () => {
    const received: MyelinEnvelope[] = [];
    await inner.subscribe(subject, async (env) => { received.push(env); });
    const transport = new EnvelopeTransport({
      publisher: createOutbox({ path, inner, log }), subscriber: inner,
      networkSovereignty: sovereignty, identity, stack: "default",
    });
    await transport.publish(input, subject);
    const wireEnvelope = received[0]!;
    expect(wireEnvelope.signed_by?.[0]?.identity).toBe(identity.did);
    expect(wireEnvelope.signed_by?.[0]?.signature).toBeDefined();
    expect(await fs.readFile(path, "utf8")).toBe(line(put(wireEnvelope)) + line(ack(wireEnvelope)));
    expect(log).not.toHaveBeenCalled();
  });

  test("concurrent outbox instances share complete JSONL records", async () => {
    const other = await signEnvelope(createEnvelope({ ...input, sovereignty }), identity.privateKey, identity.did);
    await Promise.all([
      createOutbox({ path, inner, log }).publish(subject, envelope),
      createOutbox({ path, inner, log }).publish(subject, other),
    ]);
    const records: unknown[] = (await fs.readFile(path, "utf8")).trim().split("\n").map((record) => JSON.parse(record));
    expect(records).toHaveLength(4);
    for (const env of [envelope, other]) {
      expect(records).toContainEqual(put(env));
      expect(records).toContainEqual(ack(env));
      expect(records.findIndex((record) => JSON.stringify(record) === JSON.stringify(put(env))))
        .toBeLessThan(records.findIndex((record) => JSON.stringify(record) === JSON.stringify(ack(env))));
    }
  });

  test("forwards request and its rejection unchanged without spooling", async () => {
    const request = spyOn(inner, "request");
    await inner.close();
    await expect(createOutbox({ path, inner, log }).request(subject, envelope, { timeoutMs: 25 }))
      .rejects.toThrow("Transport closed");
    expect(request).toHaveBeenCalledWith(subject, envelope, { timeoutMs: 25 });
    expect(await fs.stat(path).catch(() => null)).toBeNull();
    expect(log).not.toHaveBeenCalled();
  });

  test("close closes inner and preserves the spool", async () => {
    const outbox = createOutbox({ path, inner, log });
    await outbox.publish(subject, envelope);
    const spool = await fs.readFile(path, "utf8");
    const close = spyOn(inner, "close");
    await outbox.close();
    expect(close).toHaveBeenCalledTimes(1);
    await expect(inner.publish(subject, envelope)).rejects.toThrow("Transport closed");
    expect(await fs.readFile(path, "utf8")).toBe(spool);
  });
});
