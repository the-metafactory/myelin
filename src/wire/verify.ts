/**
 * ./wire — envelope identity verifier (RFC-0004 §5-§7, the TRUST ROOT).
 *
 * Chain-aware Ed25519 verification with the PINNED equation (grammar §9, D8):
 * PureEdDSA [RFC8032], COFACTORLESS; REJECT a small-order point on both the
 * public key A and the signature component R; REJECT a non-canonical point
 * encoding (y >= p) on A and R; REJECT a non-canonical scalar S >= L. Library
 * DEFAULTS are deliberately NOT used — the small-order / non-canonical / S>=L
 * checks are performed explicitly so each failure yields its own §11.3 token.
 *
 * D0 two-anchor model: the AUTHORITY question (originator attribution, §7.1)
 * keys on s[0] (truncation-safe, RFC-0004 D12); the returned `principal` is the
 * LINK anchor s[n-1] (who delivered this into the boundary). Freshness is split:
 * `admission` mode enforces the `at` window; `reverify` mode does not (a stored,
 * already-admitted envelope re-verifies regardless of age).
 *
 * Signing bytes come from the byte-exact ./wire canonicalizer; the pinned
 * equation is exercised against real Ed25519 vectors (envelope-signing/
 * sign-verify.json + reject.json).
 */

import { Point, verifyAsync } from "@noble/ed25519";
import { bytesToSign } from "./canonicalize";
import { parseDid, resolvePlane, checkAgentPrefixBinding, type ParsedDid } from "./identity";
import { AT_RE } from "./generated/r/envelope-signing";

export type VerifyResult =
  | { ok: true; value: { status: "verified"; chainLength: number; principal: string } }
  | { ok: false; reason: string };

type Obj = Record<string, unknown>;

/** The Ed25519 group order L (grammar §9 non-canonical-scalar bound). */
const L = BigInt("0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3ed");
const MAX_CHAIN = 16;

interface RegistryIdentity {
  id: string;
  public_key: string;
  type?: string;
  is_hub?: boolean;
}

interface VerifyInput {
  freshness?: { mode?: string; now?: string; windowMs?: number };
  registry?: { identities?: RegistryIdentity[]; trusted_hubs?: string[] };
  envelope?: Obj;
}

function b64(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "base64"));
}

function bytesToNumberLE(bytes: Uint8Array): bigint {
  let n = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(bytes[i] ?? 0);
  return n;
}

function isCalendarValidAt(at: string): boolean {
  if (!AT_RE.test(at)) return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(at);
  if (!m) return false;
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const s = Number(m[6]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return false;
  const dt = new Date(Date.UTC(Number(m[1]), mo - 1, d));
  return dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/**
 * The pinned Ed25519 verification (grammar §9). Returns a §11.3 reason token on
 * any rejection, or `null` on success. `pubkey`/`sigB64` are base64; `msg` is the
 * domain-separated bytes-to-sign.
 */
async function verifyPinned(
  pubkey: string,
  sigB64: string,
  msg: Uint8Array,
): Promise<string | null> {
  const sig = b64(sigB64);
  if (sig.length !== 64) return "stamp-signature-invalid";
  const A = b64(pubkey);
  if (A.length !== 32) return "stamp-signature-invalid";

  // Public key A: reject non-canonical encoding + small order.
  let Apoint: Point;
  try {
    Apoint = Point.fromBytes(A);
  } catch {
    return "non-canonical-point";
  }
  if (Apoint.isSmallOrder()) return "small-order-key";

  // Signature component R (first 32 bytes): reject non-canonical + small order.
  try {
    const R = Point.fromBytes(sig.slice(0, 32));
    if (R.isSmallOrder()) return "small-order-point";
  } catch {
    return "non-canonical-point";
  }

  // Scalar S (last 32 bytes): reject S >= L (non-canonical).
  if (bytesToNumberLE(sig.slice(32, 64)) >= L) return "non-canonical-scalar";

  // Cofactorless PureEdDSA equation (NOT the library default zip215 mode).
  let valid: boolean;
  try {
    valid = await verifyAsync(sig, msg, A, { zip215: false });
  } catch {
    return "stamp-signature-invalid";
  }
  return valid ? null : "stamp-signature-invalid";
}

const fail = (reason: string): VerifyResult => ({ ok: false, reason });

/** The principal an identity DID is attributed to, or `null` (hub/self-asserted). */
function principalOf(parsed: ParsedDid): string | null {
  switch (parsed.cls) {
    case "principal":
    case "stack":
    case "agent":
      return parsed.segments[0] ?? null;
    default:
      return null; // hub / surface / system carry no principal
  }
}

/**
 * Verify an envelope's signature chain and reconcile its attribution. Returns
 * the link-anchor principal (s[n-1]) on success.
 */
export async function verifyEnvelopeIdentity(input: VerifyInput): Promise<VerifyResult> {
  const envelope = input.envelope ?? {};
  const chainRaw = envelope.signed_by;
  const chain = Array.isArray(chainRaw) ? (chainRaw as Obj[]) : [];
  if (chain.length === 0) return fail("chain-empty");
  if (chain.length > MAX_CHAIN) return fail("chain-too-long");

  const registry = new Map<string, RegistryIdentity>();
  for (const r of input.registry?.identities ?? []) registry.set(r.id, r);
  const trustedHubs = new Set(input.registry?.trusted_hubs ?? []);

  const mode = input.freshness?.mode;
  const nowStr = input.freshness?.now;
  const windowMs = input.freshness?.windowMs ?? 0;
  const normalizedEnvelope: Obj = { ...envelope, signed_by: chain };

  // ── Pass 1: structural per-stamp checks (freshness + key resolution). Crypto
  // is deferred so a fail-closed ATTRIBUTION gate (e.g. an agent originator with
  // no signing stack in the chain) is reported as such, not masked by a bad sig.
  const resolved: { stamp: Obj; key: string }[] = [];
  for (const stamp of chain) {
    const at = stamp.at;
    // `at` must be a calendar-valid ISO8601 instant (verify is NOT calendar-blind).
    if (typeof at !== "string" || !isCalendarValidAt(at)) return fail("at-not-iso8601");
    // Freshness split: `admission` enforces the window; `reverify` does not.
    if (mode === "admission" && typeof nowStr === "string") {
      const skew = Math.abs(new Date(nowStr).getTime() - new Date(at).getTime());
      if (skew > windowMs) return fail("at-outside-freshness");
    }
    if (stamp.method === "hub-stamp") {
      const stampedBy = stamp.stamped_by as string | undefined;
      if (stampedBy === undefined || !trustedHubs.has(stampedBy)) return fail("untrusted-hub");
      const hub = registry.get(stampedBy);
      if (!hub) return fail("unknown-principal");
      resolved.push({ stamp, key: hub.public_key });
    } else {
      const identity = stamp.identity as string | undefined;
      if (identity === undefined) return fail("unknown-principal");
      const rec = registry.get(identity);
      if (!rec) return fail("unknown-principal");
      resolved.push({ stamp, key: rec.public_key });
    }
  }

  // ── Attribution reconciliation (§7.1, D0 authority anchor = s[0]) ──────────
  const originator = envelope.originator;
  const originatorId =
    typeof originator === "string"
      ? originator
      : ((originator as Obj | undefined)?.identity as string | undefined);

  if (originatorId !== undefined) {
    const o = parseDid(originatorId);
    if (o.ok && resolvePlane(o.value.cls) !== "self-asserted") {
      if (o.value.cls === "agent") {
        // Agent originator binds to an innermost signing STACK in the chain.
        const stackStamp = chain.find((s) => {
          const p = parseDid(s.identity as string);
          return p.ok && p.value.cls === "stack";
        });
        if (!stackStamp) return fail("chain-stack-binding-unresolved");
        const bind = checkAgentPrefixBinding(originatorId, stackStamp.identity as string);
        if (!bind.ok) return fail("originator-principal-binding-violation");
      } else {
        // principal / stack originator: reconcile its principal against s[0].
        const [s0] = chain;
        const anchor = parseDid((s0?.identity as string | undefined) ?? "");
        const anchorPrincipal = anchor.ok ? principalOf(anchor.value) : null;
        if (anchorPrincipal === null || anchorPrincipal !== principalOf(o.value)) {
          return fail("originator-principal-binding-violation");
        }
      }
    }
  }

  // ── Pass 2: pinned Ed25519 verification of every stamp's signature.
  for (const [i, { stamp, key }] of resolved.entries()) {
    const err = await verifyPinned(key, stamp.signature as string, bytesToSign(normalizedEnvelope, i));
    if (err) return fail(err);
  }

  const last = chain.at(-1);
  const principal = (last?.identity as string | undefined) ?? "";
  return { ok: true, value: { status: "verified", chainLength: chain.length, principal } };
}
