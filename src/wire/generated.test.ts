import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DID_RE, SEGMENT_MAX_LEN, CLASS_TAG_VALUES } from "./generated/r/identifiers";
import { NAK_REASON_VALUES } from "./generated/r/transport";
import { ADMISSION_STATUS_VALUES } from "./generated/r/admission";

/**
 * Acceptance for tools/abnf-gen (#237): the COMMITTED generated DID artifact
 * equals the ratified RFC-0001 semantics, proven against the identifier
 * vectors. A conforming `parseDid` composes the generated pattern with the
 * generated length bound (the octet ceiling ABNF cannot carry inline), exactly
 * as this proof does — so the check exercises the real artifact set, not a
 * hand-copied regex.
 */

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

interface DidVector {
  id: string;
  kind: string;
  input: unknown;
  expect: { ok: boolean };
}

function loadVectors(file: string): DidVector[] {
  const raw = JSON.parse(readFileSync(join(REPO_ROOT, "specs", "vectors", "identifiers", file), "utf8")) as
    | DidVector[]
    | { vectors: DidVector[] };
  return Array.isArray(raw) ? raw : raw.vectors;
}

/** parseDid = generated pattern + generated bounds (segment ≤ max, msi ≤ 255). */
function parseDid(did: string): boolean {
  if (!DID_RE.test(did)) return false;
  const msi = did.slice("did:mf:".length);
  if (msi.length > 255) return false;
  return msi.split(".").every((seg) => seg.length <= SEGMENT_MAX_LEN);
}

describe("generated DID artifact vs RFC-0001 vectors (#237)", () => {
  const vectors = [...loadVectors("valid.json"), ...loadVectors("invalid.json")].filter((v) => v.kind === "parseDid");

  it("has parseDid vectors to check", () => {
    expect(vectors.length).toBeGreaterThan(20);
  });

  for (const v of vectors) {
    it(`${v.id} → ${v.expect.ok ? "accept" : "reject"}`, () => {
      expect(parseDid(v.input as string)).toBe(v.expect.ok);
    });
  }

  it("closed-set enums carry the ratified members", () => {
    expect(CLASS_TAG_VALUES).toEqual(["principal", "stack", "agent", "hub", "surface", "system"]);
    expect(NAK_REASON_VALUES).toEqual(["cant_do", "wont_do", "not_now", "compliance_block"]);
    expect(ADMISSION_STATUS_VALUES).toEqual(["PENDING", "ADMITTED", "REJECTED", "REVOKED", "DEPARTED"]);
  });
});
