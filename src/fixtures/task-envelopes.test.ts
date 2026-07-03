import { describe, it, expect } from "bun:test";
import { validateEnvelope } from "../envelope";
import { offerTaskEnvelope, directTaskEnvelope, delegateTaskEnvelope } from "./task-envelopes";

describe("task envelope fixtures", () => {
  it("offerTaskEnvelope passes validation", () => {
    const r = validateEnvelope(offerTaskEnvelope);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("directTaskEnvelope passes validation", () => {
    const r = validateEnvelope(directTaskEnvelope);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("delegateTaskEnvelope passes validation", () => {
    const r = validateEnvelope(delegateTaskEnvelope);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });
});
