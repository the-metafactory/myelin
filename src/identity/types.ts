export const DID_RE = /^did:mf:[a-z](?:[a-z0-9._]|-(?!-))+$/;
export const BASE64_RE = /^[A-Za-z0-9+/]+=*$/;

// R3 + R5 (vocabulary migration 2026-05) — `PrincipalType` → `IdentityType`
// and the type-literal value `"operator"` → `"hub"` (R5 ships in PR-3).
export type IdentityType = "agent" | "service" | "hub";

// R1 (vocabulary migration 2026-05) — `Principal` → `Identity` (landed PR-1).
// R4 (vocabulary migration 2026-05) — the `operator` object field renamed
// to `network` (landed PR-5, agent-identity cluster). `network` is the
// resolved owning-network slug; it is NOT signed canonical content
// (see SIGNABLE_FIELDS in canonicalize.ts — `Identity` objects live in
// the registry, not the signed envelope), so this is a safe rename.
export interface Identity {
  id: string;
  display_name?: string;
  network: string;
  public_key: string;
  type: IdentityType;
  created_at: string;
  is_hub?: boolean;
}

/** @deprecated Renamed to `Identity` (vocabulary migration 2026-05). Removed in the next major. */
export type Principal = Identity;
/** @deprecated Renamed to `IdentityType` (vocabulary migration 2026-05). Removed in the next major. */
export type PrincipalType = IdentityType;

export type SigningMethod = "ed25519" | "hub-stamp";

/**
 * StampRole — semantic position of a stamp inside a chain (myelin#31).
 *
 * Roles describe what the stamp ATTESTS, not what the identity IS.
 * The same identity may appear at different positions with different
 * roles in different envelopes (e.g. an agent stamps its own origin in
 * one envelope, then transit-stamps a forwarded one).
 *
 * | role | meaning |
 * |---|---|
 * | `origin` | first author — the identity that minted the envelope body. |
 * | `transit` | a relay/hub adding a hop attestation without changing semantics. |
 * | `accountability` | claims responsibility for downstream effects (audit/compliance handle). |
 * | `sovereignty` | asserts that the envelope was checked against a sovereignty policy. |
 * | `notary` | third-party witness — neither origin nor transit, just observing. |
 *
 * `role` is optional for back-compat — pre-#31 stamps and the hub-stamp
 * shim do not carry a role. Consumers that need role-aware predicates
 * MUST handle the undefined case.
 */
export type StampRole =
  | "origin"
  | "transit"
  | "accountability"
  | "sovereignty"
  | "notary";

/**
 * R2 transition stamp-DID shape (vocabulary migration 2026-05, PR-6).
 *
 * The stamp's DID field was renamed `principal` → `identity`. This is the
 * *transition* release: a stamp on the wire carries EITHER the canonical
 * `identity` key OR the deprecated `principal` key — never both (a stamp
 * with both is rejected with a typed `dual_field_conflict` by
 * `validateEnvelope`). The discriminated union expresses "exactly one of"
 * at the type level: `principal?: never` on the `identity` arm and vice
 * versa, so TS rejects a both-keys literal at compile time too.
 *
 * `signed_by` is a SIGNABLE field — the canonical bytes are whatever key
 * the stamp actually carries on the wire. The reader NEVER re-keys before
 * canonicalizing (see `pickSignableFields` in `canonicalize.ts`), so a new
 * myelin (emitting `identity`) and a pre-migration / JetStream-replayed
 * envelope (carrying `principal`) each verify against their own bytes.
 */
type StampDidKey =
  | {
      /** R2 canonical stamp DID key. */
      identity: string;
      principal?: never;
    }
  | {
      /**
       * @deprecated Renamed to `identity` (vocabulary migration 2026-05,
       * R2). Pre-migration / JetStream-replayed envelopes carry this key;
       * the transition validator accepts it and verification canonicalizes
       * it as received. Removed in the breaking major.
       */
      principal: string;
      identity?: never;
    };

interface SignedByEd25519Base {
  method: "ed25519";
  signature: string;
  at: string;
  /** Optional semantic role of this stamp in the chain. See {@link StampRole}. */
  role?: StampRole;
}

export type SignedByEd25519 = SignedByEd25519Base & StampDidKey;

interface SignedByHubStampBase {
  method: "hub-stamp";
  stamped_by: string;
  signature: string;
  at: string;
  /** Optional semantic role of this stamp in the chain. See {@link StampRole}. */
  role?: StampRole;
}

export type SignedByHubStamp = SignedByHubStampBase & StampDidKey;

export type SignedBy = SignedByEd25519 | SignedByHubStamp;

/**
 * R2 transition accessor (vocabulary migration 2026-05, PR-6).
 *
 * Resolves a stamp's DID regardless of which wire key it carries —
 * the new `identity` key or the deprecated `principal` key. Used by every
 * consumer that needs the stamp DID (verify, chain helpers) so they read
 * one accessor instead of repeating the `?? ` fallback.
 *
 * NB: this is a READ accessor only — it never re-keys the stamp. Signing
 * input is canonicalized from the stamp's bytes as received (see
 * `canonicalizeForSigning`). A stamp with BOTH keys is a `dual_field_conflict`
 * and is rejected by `validateEnvelope` before this accessor is reached on
 * any validated path; on unvalidated paths the accessor prefers `identity`.
 */
export function stampIdentityDid(stamp: SignedBy): string | undefined {
  const s = stamp as { identity?: unknown; principal?: unknown };
  if (typeof s.identity === "string") return s.identity;
  if (typeof s.principal === "string") return s.principal;
  return undefined;
}

/**
 * Per-stamp verification verdict (myelin#31). Each entry corresponds
 * positionally to a stamp in `signed_by`. A chain is considered verified
 * iff every per-stamp `valid` is true.
 */
export interface StampVerdict {
  index: number;
  valid: boolean;
  /** Resolved identity when known — only populated when registry lookup succeeded. */
  principal?: Identity;
  /** Resolved method (mirrors `signed_by[index].method`). */
  method?: SigningMethod;
  /** Failure reason when `valid` is false. */
  reason?: string;
}

export type VerificationResult =
  | {
      status: "verified";
      /** Last stamp's resolved identity — convenience for single-stamp callers. */
      principal: Identity;
      /** Last stamp's signing method. */
      method: SigningMethod;
      /** Per-stamp verdicts in chain order (myelin#31). */
      chain: StampVerdict[];
    }
  | { status: "unverified"; reason: string }
  | {
      status: "rejected";
      reason: string;
      /**
       * Per-stamp verdicts when failure was deep enough to walk the chain.
       * Absent for early failures (missing signed_by, unparseable shape).
       */
      chain?: StampVerdict[];
    };

export interface SigningIdentity {
  did: string;
  privateKey: string;
}
