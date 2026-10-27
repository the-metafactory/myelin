import { describe, expect, it } from "bun:test";
import { createEnvelope, validateEnvelope } from "../envelope";
import { isValidUUID } from "../uuid";
import { EnvelopeTransport } from "../transport/envelope";
import { InMemoryTransport } from "../transport/in-memory";
import { executionRunFinishedPattern } from "../subjects";
import {
  EXECUTION_RUN_FINISHED_TYPE,
  RUN_KINDS,
  RUN_OUTCOMES,
  type ExecutionRunEventType,
  type RunKind,
  type RunOutcome,
} from "../subject-vocabulary";
import type { MyelinEnvelope, Sovereignty } from "../types";
import {
  createExecutionRunFinished,
  validateExecutionRunFinished,
} from "./run-finished";
import type { ExecutionRunFinishedPayloadInput } from "./types";
import * as packageEntry from "../index";
import * as edge from "../edge";

const sovereignty: Sovereignty = {
  classification: "local",
  data_residency: "CH",
  max_hop: 0,
  frontier_ok: false,
  model_class: "any",
};
const correlationId = "550e8400-e29b-41d4-a716-446655440000";

function payload(): ExecutionRunFinishedPayloadInput {
  return {
    run_id: "run-322",
    producer: "pulse",
    ran: { kind: "flow", ref: "morning-flow" },
    outcome: "succeeded",
    started_at: "2026-10-12T10:00:00.000Z",
    ended_at: "2026-10-12T10:00:05.000Z",
    serves: { goal: "M0", node: "the-metafactory/myelin#322" },
    state: { subject: "sensor-health", value: "healthy" },
    correlation_id: correlationId,
    detail_ref: "file:///runs/run-322.jsonl",
  };
}

function build(value: ExecutionRunFinishedPayloadInput = payload()) {
  return createExecutionRunFinished({
    source: "jc.default.pulse",
    // glossary-ignore: principal — the Subject segment names the Principal, not any Identity.
    principal: "jc",
    stack: "default",
    sovereignty,
    payload: value,
  });
}

function envelope(): MyelinEnvelope {
  return createEnvelope({ ...build().input, sovereignty });
}

function changedPayload(field: string, value: unknown, omit = false): Record<string, unknown> {
  const result = structuredClone(payload()) as unknown as Record<string, unknown>;
  const parts = field.split(".");
  const key = parts.pop()!;
  let target = result;
  for (const part of parts) target = target[part] as Record<string, unknown>;
  if (omit) Reflect.deleteProperty(target, key);
  else target[key] = value;
  return result;
}

const invalidPayloads: { field: string; label: string; value: unknown }[] = [];
for (const field of ["run_id", "producer", "ran", "ran.ref", "outcome", "started_at", "ended_at"]) {
  invalidPayloads.push({ field, label: `${field} missing`, value: changedPayload(field, undefined, true) });
  for (const value of ["", null, 42]) {
    invalidPayloads.push({ field, label: `${field} = ${JSON.stringify(value)}`, value: changedPayload(field, value) });
  }
}
for (const field of ["ran.kind", "serves.goal", "serves.node", "state.subject", "state.value", "correlation_id", "detail_ref", "result_ref"]) {
  for (const value of ["", null, 42, undefined]) {
    invalidPayloads.push({ field, label: `${field} = ${String(value)}`, value: changedPayload(field, value) });
  }
}
for (const field of ["ran.kind", "state.subject", "state.value"]) {
  invalidPayloads.push({ field, label: `${field} missing`, value: changedPayload(field, undefined, true) });
}
// glossary-ignore: message — an intentionally forbidden free-text key in the closed Payload.
for (const field of ["summary", "message", "ran.message", "serves.summary", "state.message"]) {
  invalidPayloads.push({ field, label: `unknown ${field}`, value: changedPayload(field, "private text") });
}
for (const field of ["ran", "serves", "state"]) {
  for (const value of [null, [], "invalid", 1]) {
    invalidPayloads.push({ field, label: `${field} = ${JSON.stringify(value)}`, value: changedPayload(field, value) });
  }
}
for (const field of ["started_at", "ended_at"]) {
  for (const value of ["not-a-date", "2026-10-12", "2026-10-12T10:00:00", "2026-02-30T10:00:00Z", "2026-10-12T25:00:00Z"]) {
    invalidPayloads.push({ field, label: `${field} = ${value}`, value: changedPayload(field, value) });
  }
}
invalidPayloads.push(
  { field: "outcome", label: "unknown outcome", value: changedPayload("outcome", "completed") },
  { field: "ran.kind", label: "unknown kind", value: changedPayload("ran.kind", "session") },
  { field: "ended_at", label: "end before start", value: changedPayload("ended_at", "2026-10-12T09:59:59.000Z") },
  ...[null, [], "invalid"].map(value => ({ field: "payload", label: `payload = ${JSON.stringify(value)}`, value })),
);
for (const result_ref of [
  "outputs/G5-2026-W42.md", "file:outputs/G5-2026-W42.md", "SOMA:outputs/result.md",
  "soma:", "soma:/outputs/result.md", "soma://outputs/result.md",
  "soma:..", "soma:../result.md", "soma:outputs/../result.md", "soma:outputs/..",
  "soma:outputs\\result.md", "soma:\\outputs/result.md", "soma:outputs/result\0.md",
]) {
  invalidPayloads.push({
    field: "result_ref", label: `result_ref = ${JSON.stringify(result_ref)}`,
    value: changedPayload("result_ref", result_ref),
  });
}
for (const outcome of [...RUN_OUTCOMES.filter(value => value !== "succeeded"), "completed", null, 42, undefined]) {
  invalidPayloads.push({
    field: "result_ref", label: `result_ref on ${outcome}`,
    value: { ...payload(), outcome, result_ref: "soma:outputs/G5-2026-W42.md" },
  });
}
const proposalRef = "soma:proposals/errata-abc-g1.md";
for (const value of [[], null, 42, undefined, proposalRef, { 0: proposalRef }]) {
  invalidPayloads.push({
    field: "proposal_refs", label: `proposal_refs = ${value === undefined ? "undefined" : JSON.stringify(value)}`,
    value: changedPayload("proposal_refs", value),
  });
}
for (const ref of [
  "proposals/errata-def-g2.md", "SOMA:proposals/errata-def-g2.md", "soma:", "soma:/proposals/errata-def-g2.md",
  "soma:../errata.md", "soma:proposals/..", "soma:proposals\\errata.md", "soma:proposals/errata\0.md", "", null, 42,
]) {
  invalidPayloads.push({
    field: "proposal_refs[1]", label: `proposal_refs entry ${JSON.stringify(ref)}`,
    value: changedPayload("proposal_refs", [proposalRef, ref]),
  });
}
invalidPayloads.push({
  field: "proposal_refs[1]", label: "sparse proposal_refs hole",
  value: changedPayload("proposal_refs", Object.assign(new Array(2), { 0: proposalRef })),
});
invalidPayloads.push({
  field: "proposal_refs[2]", label: "duplicate proposal_refs entry",
  value: changedPayload("proposal_refs", [proposalRef, "soma:proposals/errata-def-g2.md", proposalRef]),
});
for (const outcome of [...RUN_OUTCOMES.filter(value => value !== "succeeded"), "completed", null, 42, undefined]) {
  invalidPayloads.push({
    field: "proposal_refs", label: `proposal_refs on ${outcome}`,
    value: { ...payload(), outcome, proposal_refs: [proposalRef] },
  });
}

describe("execution.run.finished", () => {
  it("registers one type and the settled enum vocabulary", () => {
    const type: ExecutionRunEventType = EXECUTION_RUN_FINISHED_TYPE;
    const kinds: readonly RunKind[] = RUN_KINDS;
    const outcomes: readonly RunOutcome[] = RUN_OUTCOMES;
    expect(type).toBe("execution.run.finished");
    expect(kinds).toEqual(["flow", "node", "algorithm", "dispatch", "job"]);
    expect(outcomes).toEqual(["succeeded", "failed", "cancelled", "blocked"]);
  });

  it("builds a publishable subject and input with duration and UUID correlation", () => {
    const original = payload();
    const event = build(original);
    expect(event.subject).toBe("local.jc.default.execution.run.finished");
    expect(event.input).toEqual({
      source: "jc.default.pulse",
      type: "execution.run.finished",
      sovereignty,
      payload: { ...original, correlation_id: correlationId },
      correlation_id: correlationId,
      economics: { actual: { duration_ms: 5000 } },
    });
    expect(validateEnvelope(createEnvelope({ ...event.input, sovereignty }))).toEqual({ valid: true, errors: [] });
    expect(validateExecutionRunFinished(envelope())).toEqual({ valid: true, errors: [] });
  });

  it("generates correlation on payload and envelope without mutating the caller", () => {
    const original = payload();
    delete original.correlation_id;
    const first = build(original);
    const second = build(original);
    expect(isValidUUID(first.input.correlation_id)).toBe(true);
    expect(first.input.payload.correlation_id).toBe(first.input.correlation_id!);
    expect(second.input.correlation_id).not.toBe(first.input.correlation_id);
    expect(original).not.toHaveProperty("correlation_id");
  });

  it("preserves valid result refs in succeeded payloads through builder and validator", () => {
    for (const result_ref of ["soma:outputs/G5-2026-W42.md", "soma:reports/name..md"]) {
      const original = { ...payload(), result_ref };
      const snapshot = structuredClone(original);
      const event = build(original);
      expect(event.input.payload.result_ref).toBe(result_ref);
      const received: MyelinEnvelope = JSON.parse(JSON.stringify(createEnvelope({ ...event.input, sovereignty })));
      expect(validateEnvelope(received)).toEqual({ valid: true, errors: [] });
      expect(validateExecutionRunFinished(received)).toEqual({ valid: true, errors: [] });
      expect(received.payload.result_ref).toBe(result_ref);
      expect(received.payload.detail_ref).toBe(original.detail_ref);
      expect(original).toEqual(snapshot);
    }
  });

  it("keeps result_ref and proposal_refs absent for every outcome when the producer omits it", () => {
    for (const outcome of RUN_OUTCOMES) {
      const event = build({ ...payload(), outcome });
      expect(event.input.payload).not.toHaveProperty("result_ref");
      expect(event.input.payload).not.toHaveProperty("proposal_refs");
      const received = createEnvelope({ ...event.input, sovereignty });
      expect(validateExecutionRunFinished(received)).toEqual({ valid: true, errors: [] });
    }
  });

  it("preserves proposal refs in order through builder and validator", () => {
    const proposal_refs = ["soma:proposals/errata-abc-g1.md", "soma:proposals/errata-def-g2.md"];
    const original = { ...payload(), proposal_refs, result_ref: "soma:outputs/G5-2026-W42.md" };
    const snapshot = structuredClone(original);
    const event = build(original);
    expect(event.input.payload.proposal_refs).toEqual(proposal_refs);
    const received: MyelinEnvelope = JSON.parse(JSON.stringify(createEnvelope({ ...event.input, sovereignty })));
    expect(validateEnvelope(received)).toEqual({ valid: true, errors: [] });
    expect(validateExecutionRunFinished(received)).toEqual({ valid: true, errors: [] });
    expect(received.payload.proposal_refs).toEqual(proposal_refs);
    expect(original).toEqual(snapshot);
  });

  it("names every bad proposal_refs entry by index", () => {
    const received = { ...envelope(), payload: { ...envelope().payload, proposal_refs: ["soma:../a.md", proposalRef, "b.md"] } };
    expect(validateExecutionRunFinished(received).errors.map(diagnostic => diagnostic.field)).toEqual([
      "payload.proposal_refs[0]", "payload.proposal_refs[2]",
    ]);
  });

  it("keeps a non-UUID correlation only in the payload", () => {
    const event = build({ ...payload(), correlation_id: "fire-2026-10-12-0700" });
    expect(event.input.payload.correlation_id).toBe("fire-2026-10-12-0700");
    expect(event.input).not.toHaveProperty("correlation_id");
    const received = createEnvelope({ ...event.input, sovereignty });
    expect(received).not.toHaveProperty("correlation_id");
    expect(validateEnvelope(received)).toEqual({ valid: true, errors: [] });
    expect(validateExecutionRunFinished(received)).toEqual({ valid: true, errors: [] });
  });

  it("omits optional detail_ref, serves and state", () => {
    const original = payload();
    delete original.detail_ref;
    delete original.serves;
    delete original.state;
    const event = build(original);
    for (const field of ["detail_ref", "serves", "state"]) expect(event.input.payload).not.toHaveProperty(field);
    expect(validateExecutionRunFinished(createEnvelope({ ...event.input, sovereignty }))).toEqual({ valid: true, errors: [] });
  });

  it("accepts each kind and outcome, optional serves ids, and unbounded id strings", () => {
    for (const kind of RUN_KINDS) {
      for (const outcome of RUN_OUTCOMES) {
        expect(() => build({ ...payload(), ran: { kind, ref: "node/ref" }, outcome })).not.toThrow();
      }
    }
    for (const serves of [{}, { goal: "M0" }, { node: "node-322" }]) {
      expect(() => build({ ...payload(), serves })).not.toThrow();
    }
    expect(() => build({ ...payload(), run_id: "自由 / id!".repeat(100), correlation_id: " " })).not.toThrow();
  });

  it("allows zero duration and compares offset timestamps by instant", () => {
    expect(build({ ...payload(), ended_at: payload().started_at }).input.economics.actual.duration_ms).toBe(0);
    expect(build({ ...payload(), started_at: "2026-10-12T12:00:00+02:00", ended_at: "2026-10-12T10:00:05Z" }).input.economics.actual.duration_ms).toBe(5000);
  });

  for (const { field, label, value } of invalidPayloads) {
    it(`rejects ${label} in builder and validator`, () => {
      expect(() => build(value as ExecutionRunFinishedPayloadInput)).toThrow(field);
      const received = { ...envelope(), payload: value } as MyelinEnvelope;
      const result = validateExecutionRunFinished(received);
      expect(result.valid).toBe(false);
      expect(result.errors.map(diagnostic => diagnostic.field)).toContain(field === "payload" ? field : `payload.${field}`);
    });
  }

  it("requires received payload correlation even though the builder generates it", () => {
    const received = envelope();
    delete received.payload.correlation_id;
    expect(validateExecutionRunFinished(received).errors).toContainEqual({
      // glossary-ignore: message — ValidationError diagnostic text, not an Envelope or Payload.
      field: "payload.correlation_id", message: "must be a non-empty string",
    });
  });

  it("rejects non-UUID correlation on the envelope itself even when payload matches", () => {
    const received = envelope();
    received.correlation_id = "fire-2026-10-12-0700";
    received.payload.correlation_id = received.correlation_id;
    expect(validateExecutionRunFinished(received)).toEqual({
      valid: false,
      // glossary-ignore: message — ValidationError diagnostic text, not an Envelope or Payload.
      errors: [{ field: "correlation_id", message: "must be a valid UUID when present" }],
    });
  });

  it("collects one diagnostic per independent problem without throwing", () => {
    const received = envelope();
    received.type = "dispatch.task.completed";
    received.payload.run_id = "";
    received.payload.summary = "private text";
    received.correlation_id = "650e8400-e29b-41d4-a716-446655440000";
    delete received.economics;
    const result = validateExecutionRunFinished(received);
    expect(result.valid).toBe(false);
    expect(result.errors.map(diagnostic => diagnostic.field).sort()).toEqual([
      "type", "payload.run_id", "payload.summary", "correlation_id", "economics.actual.duration_ms",
    ].sort());
  });

  it("rejects absent or invalid duration", () => {
    for (const economics of [undefined, {}, { actual: {} }, { actual: { duration_ms: -1 } }, { actual: { duration_ms: "5000" } }]) {
      const received = { ...envelope(), economics } as MyelinEnvelope;
      expect(validateExecutionRunFinished(received).errors.map(diagnostic => diagnostic.field)).toContain("economics.actual.duration_ms");
    }
  });

  it("exports the contract from the package entry point and edge", () => {
    for (const surface of [packageEntry, edge]) {
      expect(surface.createExecutionRunFinished).toBe(createExecutionRunFinished);
      expect(surface.validateExecutionRunFinished).toBe(validateExecutionRunFinished);
      expect(surface.EXECUTION_RUN_FINISHED_TYPE).toBe(EXECUTION_RUN_FINISHED_TYPE);
      expect(surface.RUN_KINDS).toEqual(RUN_KINDS);
      expect(surface.RUN_OUTCOMES).toEqual(RUN_OUTCOMES);
      expect(surface.executionRunFinishedSubject("jc", "default")).toBe(build().subject);
      expect(surface.executionRunFinishedPattern("jc")).toBe(executionRunFinishedPattern("jc"));
    }
  });

  it("publishes over EnvelopeTransport/InMemoryTransport with duration intact", async () => {
    const memory = new InMemoryTransport();
    const transport = new EnvelopeTransport({ publisher: memory, subscriber: memory, networkSovereignty: sovereignty, stack: "default" });
    const received: MyelinEnvelope[] = [];
    try {
      await transport.subscribe(executionRunFinishedPattern("jc"), async value => { received.push(value); });
      for (const correlation_id of [correlationId, "fire-2026-10-12-0700"]) {
        const event = build({ ...payload(), correlation_id });
        await transport.publish(event.input, event.subject);
      }
      expect(received).toHaveLength(2);
      for (const value of received) {
        expect(validateEnvelope(value)).toEqual({ valid: true, errors: [] });
        expect(validateExecutionRunFinished(value)).toEqual({ valid: true, errors: [] });
        expect(value.economics?.actual?.duration_ms).toBe(5000);
      }
      expect(received[0]!.correlation_id).toBe(correlationId);
      expect(received[1]).not.toHaveProperty("correlation_id");
    } finally {
      await transport.close();
    }
  });
});
