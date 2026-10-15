import { describe, expect, it } from "bun:test";
import { createEnvelope, validateEnvelope } from "../envelope";
import { EnvelopeTransport } from "../transport/envelope";
import { InMemoryTransport } from "../transport/in-memory";
import { vigilAttentionResolvedPattern } from "../subjects";
import {
  ATTENTION_RESOLUTIONS,
  VIGIL_ATTENTION_RESOLVED_TYPE,
  type AttentionResolution,
  type VigilAttentionEventType,
} from "../subject-vocabulary";
import type { MyelinEnvelope, Sovereignty } from "../types";
import { createVigilAttentionResolved, validateVigilAttentionResolved } from "./attention-resolved";
import type { VigilAttentionResolvedPayload } from "./types";
import * as root from "../index";
import * as edge from "../edge";

const sovereignty: Sovereignty = {
  classification: "local",
  data_residency: "CH",
  max_hop: 0,
  frontier_ok: false,
  model_class: "any",
};

function payload(): VigilAttentionResolvedPayload {
  return {
    key: "soma:proposals/errata-abc-g1.md",
    kind: "proposal",
    resolution: "approved",
    ran_ref: "errata-triage",
    resolved_at: "2026-10-15T08:00:00.000Z",
    filed: "the-metafactory/soma#910",
  };
}

function build(value: unknown = payload()) {
  return createVigilAttentionResolved({
    source: "jc.default.vigil",
    principal: "jc",
    stack: "default",
    sovereignty,
    payload: value as VigilAttentionResolvedPayload,
  });
}

function envelope(): MyelinEnvelope {
  return createEnvelope({ ...build().input, sovereignty });
}

function received(value: unknown): MyelinEnvelope {
  return { ...envelope(), payload: value as Record<string, unknown> };
}

function changedPayload(field: string, value: unknown, omit = false): Record<string, unknown> {
  const result = payload() as unknown as Record<string, unknown>;
  if (omit) Reflect.deleteProperty(result, field);
  else result[field] = value;
  return result;
}

const invalidPayloads: { field: string; label: string; value: unknown }[] = [];
for (const field of ["key", "kind", "resolution", "ran_ref", "resolved_at"]) {
  invalidPayloads.push({ field, label: `${field} missing`, value: changedPayload(field, undefined, true) });
  for (const value of ["", null, 42]) {
    invalidPayloads.push({ field, label: `${field} = ${JSON.stringify(value)}`, value: changedPayload(field, value) });
  }
}
for (const value of ["accepted", "resolved", "open", "Approved"]) {
  invalidPayloads.push({ field: "resolution", label: `unknown resolution ${value}`, value: changedPayload("resolution", value) });
}
for (const value of ["not-a-date", "2026-10-15", "2026-10-15T08:00:00", "2026-02-30T08:00:00Z", "2026-10-15T25:00:00Z"]) {
  invalidPayloads.push({ field: "resolved_at", label: `resolved_at = ${value}`, value: changedPayload("resolved_at", value) });
}
for (const value of [
  "", null, 42, undefined, "soma#910", "the-metafactory/soma", "the-metafactory/soma#", "the-metafactory/soma#0",
  "the-metafactory/soma#01", "the-metafactory/soma#-1", "the-metafactory/soma#9a", "/soma#910", "the-metafactory/#910",
  "-owner/soma#910", "owner-/soma#910", "the-metafactory/./#910", "the-metafactory/..#910", "the-metafactory/.#910",
  "the-metafactory/so ma#910", "the-metafactory/soma/x#910", "https://github.com/the-metafactory/soma/issues/910",
  " the-metafactory/soma#910", "the-metafactory/soma#910\n",
]) {
  invalidPayloads.push({
    field: "filed", label: `filed = ${value === undefined ? "undefined" : JSON.stringify(value)}`,
    value: changedPayload("filed", value),
  });
}
for (const resolution of ATTENTION_RESOLUTIONS.filter(value => value !== "approved")) {
  invalidPayloads.push({ field: "filed", label: `filed on ${resolution}`, value: { ...payload(), resolution } });
}
for (const field of ["summary", "message", "text", "proposal_refs"]) {
  invalidPayloads.push({ field, label: `unknown ${field}`, value: changedPayload(field, "private text") });
}
invalidPayloads.push(...[null, [], "invalid", 1].map(value => ({
  field: "payload", label: `payload = ${JSON.stringify(value)}`, value,
})));

describe("vigil.attention.resolved", () => {
  it("registers one type and the settled resolution vocabulary", () => {
    const type: VigilAttentionEventType = VIGIL_ATTENTION_RESOLVED_TYPE;
    const resolutions: readonly AttentionResolution[] = ATTENTION_RESOLUTIONS;
    expect(type).toBe("vigil.attention.resolved");
    expect(resolutions).toEqual(["approved", "dismissed", "expired", "superseded", "read", "archived"]);
  });

  it("builds a publishable subject and input from a complete payload", () => {
    const original = payload();
    const event = build(original);
    expect(event.subject).toBe("local.jc.default.vigil.attention.resolved");
    expect(event.input).toEqual({
      source: "jc.default.vigil",
      type: "vigil.attention.resolved",
      sovereignty,
      payload: { ...original },
    });
    expect(event.input.payload).not.toBe(original);
    expect(validateEnvelope(envelope())).toEqual({ valid: true, errors: [] });
    expect(validateVigilAttentionResolved(envelope())).toEqual({ valid: true, errors: [] });
  });

  it("accepts every resolution without filed and approved with or without it", () => {
    for (const resolution of ATTENTION_RESOLUTIONS) {
      const { filed: _filed, ...rest } = payload();
      const value = { ...rest, resolution, kind: resolution === "read" ? "result" : "proposal" };
      expect(validateVigilAttentionResolved(createEnvelope({ ...build(value).input, sovereignty })))
        .toEqual({ valid: true, errors: [] });
    }
  });

  it("accepts node refs in owner/repo#N form", () => {
    for (const filed of ["the-metafactory/soma#910", "a/b#1", "jc-fischer/my.repo_2#12345", "x/.github#7"]) {
      const value = { ...payload(), filed };
      expect(validateVigilAttentionResolved(received(value))).toEqual({ valid: true, errors: [] });
      expect(build(value).input.payload.filed).toBe(filed);
    }
  });

  it("accepts ISO 8601 offsets on resolved_at", () => {
    for (const resolved_at of ["2026-10-15T10:00:00+02:00", "2026-10-15T08:00:00Z", "2024-02-29T23:59:59.999-05:30"]) {
      expect(validateVigilAttentionResolved(received({ ...payload(), resolved_at }))).toEqual({ valid: true, errors: [] });
    }
  });

  for (const { field, label, value } of invalidPayloads) {
    it(`rejects ${label} in builder and validator`, () => {
      const name = field === "payload" ? "payload" : `payload.${field}`;
      expect(() => build(value)).toThrow(name);
      const result = validateVigilAttentionResolved(received(value));
      expect(result.valid).toBe(false);
      expect(result.errors.map(error => error.field)).toContain(name);
    });
  }

  it("names filed when it rides on a non-approved resolution", () => {
    const result = validateVigilAttentionResolved(received({ ...payload(), resolution: "dismissed" }));
    expect(result.errors).toEqual([{ field: "payload.filed", message: "is only allowed when resolution is approved" }]);
  });

  it("collects one error per independent problem without throwing", () => {
    const value = envelope();
    value.type = "system.attention.resolved";
    value.payload.key = "";
    value.payload.resolution = "accepted";
    value.payload.summary = "private text";
    const result = validateVigilAttentionResolved(value);
    expect(result.valid).toBe(false);
    expect(result.errors.map(error => error.field).sort()).toEqual([
      "type", "payload.key", "payload.resolution", "payload.filed", "payload.summary",
    ].sort());
  });

  it("rejects a non-object envelope", () => {
    expect(validateVigilAttentionResolved(null as unknown as MyelinEnvelope)).toEqual({
      valid: false, errors: [{ field: "envelope", message: "must be an object" }],
    });
  });

  it("exports the contract from root and edge", () => {
    for (const surface of [root, edge]) {
      expect(surface.createVigilAttentionResolved).toBe(createVigilAttentionResolved);
      expect(surface.validateVigilAttentionResolved).toBe(validateVigilAttentionResolved);
      expect(surface.VIGIL_ATTENTION_RESOLVED_TYPE).toBe(VIGIL_ATTENTION_RESOLVED_TYPE);
      expect(surface.ATTENTION_RESOLUTIONS).toEqual(ATTENTION_RESOLUTIONS);
      expect(surface.vigilAttentionResolvedSubject("jc", "default")).toBe(build().subject);
      expect(surface.vigilAttentionResolvedPattern("jc")).toBe(vigilAttentionResolvedPattern("jc"));
    }
  });

  it("reaches a producer subscribed across stacks over EnvelopeTransport/InMemoryTransport", async () => {
    const memory = new InMemoryTransport();
    const transport = new EnvelopeTransport({ publisher: memory, subscriber: memory, networkSovereignty: sovereignty, stack: "default" });
    const answers: MyelinEnvelope[] = [];
    try {
      await transport.subscribe(vigilAttentionResolvedPattern("jc"), async value => { answers.push(value); });
      const { filed: _filed, ...expired } = { ...payload(), resolution: "expired" as const };
      for (const value of [payload(), expired]) {
        const event = build(value);
        await transport.publish(event.input, event.subject);
      }
      expect(answers).toHaveLength(2);
      for (const value of answers) {
        expect(validateEnvelope(value)).toEqual({ valid: true, errors: [] });
        expect(validateVigilAttentionResolved(value)).toEqual({ valid: true, errors: [] });
      }
      expect(answers.map(value => value.payload.resolution)).toEqual(["approved", "expired"]);
      expect(answers[0]!.payload.filed).toBe("the-metafactory/soma#910");
    } finally {
      await transport.close();
    }
  });
});
