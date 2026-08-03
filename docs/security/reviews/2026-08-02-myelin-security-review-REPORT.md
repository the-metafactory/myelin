# myelin — security review, private disclosure to maintainers

**From:** Rob Chuvala (NorthWoods Sentinel) · drafted by Margin (agent)
**To:** the-metafactory maintainers (Andreas Åström, Jens-Christian Fischer)
**Repo reviewed:** `myelin` — envelope + identity/crypto core (envelope.ts, identity/{verify,canonicalize,chain,sign}.ts, jcs.ts, serialization/, bidding/, subject-matching) of ~16,000 LOC (cloned fresh 2026-08-01)
**Status:** PRIVATE — maintainers first. Not posted.

---

## What this is

A cross-lineage adversarial review (Gemini, DeepSeek, GPT-via-codex), three re-feed rounds, refute-to-kill, verified against source. The protocol's thesis is *"sovereignty travels with the message,"* so I attacked whether it **binds**. Two honest notes up front: GPT found **no direct Ed25519 forgery path** — the crypto primitive usage looks correct (64-byte sig / 32-byte key length checks, same JCS helper at sign and verify). And round 3 **refuted** one direction I pushed on: bid economics *are* signed (`bidding/response.ts` canonical payload includes `load`/`cost`/`capability_match`), and subject-matching *does* escape regex metacharacters. So this is not "the crypto is broken." It's that structural validity is not authentication, and several places let the two be confused.

## What's good
The primitive usage is careful: length-checked keys and signatures, one shared canonicalization helper for sign and verify, a length-bounded chain, a documented back-compat shim for the identity/principal migration, and a parse/schema decode that fails safe to `null` (a decode failure, not an authentication result — the two are distinct here, which is part of finding 1). There is a real authorization API, `requireVerifiedIdentity`, with `minLength`/`mustIncludeRole` predicates. Bid responses bind economics into the signature and reject the deprecated `principal` key. The structure is disciplined — the gaps are at the binding/semantic layer, not the cryptographic one.

## Findings

**1 — Validation is not verification, and the API lets them be confused [HIGH — as an API-boundary footgun, if `safeDecodeEnvelope` is expected to be used at trust boundaries].**
`signed_by` is optional at `validateEnvelope` (`envelope.ts:202`, guarded by `if (e.signed_by !== undefined)`), and `safeDecodeEnvelope` (`:395`) calls only `validateEnvelope` — never anything in `identity/verify`. So an **unsigned** envelope carrying any `sovereignty` block decodes as valid. "Sovereignty travels with the message" holds only if every consumer separately chooses to call verify, and nothing structural forces that. This is the exact class as assay's advisory attestation. Severity is HIGH to the extent maintainers expect `safeDecodeEnvelope` to be the trust-boundary entry point; lower if it is understood as parse-only everywhere. Fix: make it impossible to treat a decoded-but-unverified envelope as authenticated — a sovereignty-bearing envelope on a trust boundary must require and verify a stamp, or the types must keep "decoded" and "verified" distinct and un-confusable.

**2 — Base verification proves prefix integrity, not chain completion (tail-stripping) [HIGH only where callers authorize on chain completeness/role without requiring it].**
`canonicalizeForChainStamp` (`identity/canonicalize.ts:122-124`) signs each stamp over the chain **prefix** `[0..index]` only — the code comment states it: stamp `index` signs stamps `0..index`, not what comes after. Consequence: an attacker can remove later stamps (accountability, sovereignty, delegation links) and every remaining prefix stamp still verifies, because none ever signed the tail. **The mitigation exists and should be named:** `requireVerifiedIdentity` (`identity/verify.ts:301-367`) is the authorization boundary and supports `minLength` (`:338`) and `mustIncludeRole` (`:344`). So the accurate finding is not "there is no defense" — it is that base `verifyEnvelopeIdentity` passing means prefix integrity, **not** chain completeness, and nothing forces auth boundaries to use the stricter `requireVerifiedIdentity` predicates. Fix: require a terminus/role/`minLength` at every auth boundary (or bind a signed chain length into each stamp) and document that base verification is insufficient for authorization.

**3 — Hub-stamp identity substitution [HIGH under multi-hub / hub-compromise].**
`verifyHubStamp` (`identity/verify.ts:214-257`) verifies the hub's own signature, then returns `principal` bound to the stamp's **claimed** `identity`, with no check that the hub is authorized to speak for that DID (no `identity === stamped_by`, no per-DID hub authorization). Any trusted hub can stamp an arbitrary victim DID and the verifier reports the victim as the verified principal. Trust in a hub is therefore unbounded impersonation. Fix: bind hub authority to a scope (which DIDs/roles a hub may vouch for), or treat a hub stamp as a delegation claim that still requires the subject's own stamp.

**4 — No proof the originator participated, and it outranks the signed stamp [MED, composes with #1].**
Correction from an earlier draft: `originator` **is** in the signing payload (`canonicalize.ts:44`, "signer commits to it") — it is not unsigned. But the signer signs their *own claim* of who the originator is; nothing requires `stamp[0].identity == originator.identity`, so a signer can assert a victim as originator and sign it. And `getActorPrincipal` (`envelope.ts:604`) returns `originator.identity ?? originator.principal` **before** looking at `signed_by`. A policy engine using it as an auth principal reads the asserted originator, not the actual signer — and on the unsigned-decode path of #1, reads it with no signature at all. I did not find a consumer that uses `getActorPrincipal` as an authorization principal, so this is a latent footgun pending that evidence. Fix: derive the actor only from a verified stamp, or require an originator participation proof.

**5 — Supporting [MED / conditional]:** no replay defense — `verify.ts:130` checks only `signed_by.at` clock-skew, no nonce/id cache, so an exact signed envelope replays inside the window (this one is solid). `verifyBidResponse` does not re-validate the economic ranges that `signBidResponse` enforces, so a registered bidder can hand-sign `cost:-1`/`capability_match:2` and selection trusts it (solid; `bidding/response.ts` signer range-check vs verifier omission → `bidding/selection.ts` trust path — exact lines to be pinned in the fix PR). The rest are conditional, not proven: signed-field exclusion (`correlation_id`/`economics`/`extensions` outside the signature, `canonicalize.ts:24`) is a vuln only if a consumer trusts those pre-verification; `JSON.parse` duplicate-key collapse (`serialization/json.ts`) matters only if the protocol requires rejecting duplicates or a heterogeneous parser disagrees; the JCS `Object.keys` vs validator normal-access prototype differential does **not** apply to normal JSON/msgpack-decoded objects — only if a caller passes a crafted live JS object; `dual-field`/`segment-validators` `in`/`RegExp.test` coercion is a runtime-JS-misuse edge unless an untyped boundary is exposed.

## The through-line to name
The crypto is sound; the binding is optional. Sovereignty validates without being verified (1), a chain verifies without its tail (2), a hub vouches without authorization (3), an actor is read from an unsigned field (4). Same class as assay (attestation matches without identity-critical fields) and content-filter (structural validity accepted as security) — three tools, one pattern.

## Coverage and honest residual
Three rounds; envelope + full identity/crypto core + serialization + bidding + subject-matching. Round 3 converged (Gemini: "no new classes," and refuted a leading direction). Named residual: the MED semantic-validation items (bid-range re-check, subject grammar, own-property lookups) are representative; a longer sweep of `bidding/` and `lifecycle/` would find more instances, not new classes.

## The one line worth keeping
The signatures are real. What isn't enforced is that a valid signature over a chain, an originator, or a hub stamp actually *means* the identity it appears to assert — verification is present but not required, and not always bound to the right subject.

*— Margin (agent), for Rob Chuvala*
