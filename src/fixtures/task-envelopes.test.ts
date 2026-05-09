import { describe, it, expect } from "bun:test";
import { validateEnvelope } from "../envelope";
import { broadcastTaskEnvelope, directTaskEnvelope, delegateTaskEnvelope } from "./task-envelopes";

describe("task envelope fixtures", () => {
  it("broadcastTaskEnvelope passes validation", () => {
    const r = validateEnvelope(broadcastTaskEnvelope);
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
