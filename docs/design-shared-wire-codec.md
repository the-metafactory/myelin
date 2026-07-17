> **Superseded-by:** [`docs/design-rfc-alignment.md`](design-rfc-alignment.md) (2026-07-17).
> This plan-of-record is superseded (D7, myelin#257): its WP-4 keystone was resolved by RFC-0001
> ratification (2026-07-13), its §4.2 dual-accept change-control premise was suspended by ADR-0001,
> and RFC-0010's surface postdates it. The body below is retained UNEDITED as history.

---

I have everything I need, grounded in file:line. Here is the design doc.

---

# Design: the shared wire codec — one grammar, generated everywhere

**Status:** Proposal — for the principal to react to, not a mandate.
**Owner layer:** myelin (M3). **Consumers:** cortex, pilot, signal (all M7).
**Relates to:** RFC-0001…0009 + RFC-BCP-0001 (myelin `spec/rfc-scaffold`); cortex WP-2 (`feat/wp2-wire-identity-codec`), WP-4 (cortex#1880), WP-5.

---

## 1. The problem, grounded

Four repositories each render an identity into a wire string in one place and parse it back in another, and the two disagree silently. This is not hypothetical — the duplication is on disk today:

- **The DID grammar exists as three-plus hand-written copies.** The authoritative runtime regex is myelin `src/identity/types.ts:1` (`DID_RE = /^did:mf:[a-z](?:[a-z0-9._]|-(?!-))+$/`). It is re-inlined as a JSON-Schema `pattern` five times inside a **vendored** copy at cortex `src/bus/myelin/vendor/envelope.schema.json:109,173,186,191,223` — a copy that can drift from the myelin schema it was lifted from, with no gate catching it.
- **The segment alphabet exists as at least six variants.** `STACK_SLUG_RE` at cortex `src/cli/cortex/commands/network.ts:2684` (and re-inlined at `:516`, `:1199`), `SLUG_RE` at `stack.ts:72`, `STACK_ID_RE` at `provision-stack.ts:83`, the stack-id regex at `common/types/stack.ts:230`, and a *different* alphabet `SEGMENT_RE = /^[A-Za-z0-9][\w.-]*$/` at `review-consumer.ts:1474`. The capability-id alphabet is triplicated verbatim: `common/types/capability.ts:172`, `common/types/offering.ts:76`, `cli/cortex/commands/offer.ts:125`.
- **The first-hyphen DID decoder was invented in cortex.** `src/bus/review-consumer.ts:1454` does `body.indexOf("-")` to split a `did:mf:{principal}-{stack}` back into its two halves — the exact split WP-2's codec refuses to make because `PRINCIPAL_ID_RE` permits `-`, so the split is ambiguous. Its siblings each guess differently: `cortex.ts:1024` collapses `-+` runs (lossy — two stacks → one DID), `probe-responder.ts:433` does not collapse at all, and `federation-reconciler.ts:459` fabricates a `"default"` stack on a malformed id.
- **The NAK vocabulary is cortex-local and mirrored three ways.** `DispatchTaskFailedReason` is defined at `src/bus/dispatch-events.ts:462` and the identical reason→ack/nak/term mapping is re-implemented in `review-consumer.ts`, `release-consumer.ts:878`, and `dev-consumer.ts` (`docs/architecture.md` §7.3 calls it "the canonical nak vocabulary" — but it lives in a consumer, not on the wire).
- **cortex runs a parallel capability wire.** `common/types/capability.ts` (`CapabilitySchema`, `CAPABILITY_ID_REGEX`) sits beside myelin's already-published `@the-metafactory/myelin/discovery` (`canonicalizeAdvertisement`, `verifyCapabilityRegistration`) and `./bidding`.

WP-2 already built the fix — branded types + fail-loud parse/render — but it built it in **cortex** (`feat/wp2-wire-identity-codec:src/common/wire/identity.ts`), a *consumer*. That is the right shape in the wrong repo. This document moves it to myelin, generalizes it, and wires it to the ABNF so it is generated, not maintained.

The scaffold already states the governing rule (`specs/CONFORMANCE.md`, `specs/grammar/README.md`): **ABNF is the source; regexes, schema patterns and parsers are generated; vectors bind.** This design is the machinery that makes that literally true.

---

## 2. The mechanism at a glance

```
                         AUTHORED (normative, human-signed)
                    ┌──────────────────────────────────────────┐
                    │  specs/grammar/*.abnf                     │   RFC-0001 identifiers.abnf
                    │    principal-id / stack-slug / did / …    │   RFC-0002 subject-namespace.abnf
                    │  specs/vectors/**/*.json  (adversarial)   │   RFC-0003 envelope.abnf …
                    └───────────────┬──────────────────────────┘
                                    │
                        tools/abnf-gen  (the generator — lives in myelin)
                        `bun run gen`   /   `bun run gen --check` (CI)
                                    │
              ┌─────────────────────┼──────────────────────────┬───────────────────────┐
              ▼ generates           ▼ generates                ▼ generates              ▼ constrains
   src/wire/generated/       schemas/generated/         (regex atoms feed the      specs/vectors/**  is
   patterns.ts               patterns.defs.json         hand-written codec         CHECKED: every valid
   (regex + class table,     ($defs.did.pattern, …      orchestration below)       vector MUST match the
    branded-type names)       $ref'd by every schema)                              generated regex; every
              │                       │                                            invalid MUST NOT.
              │                       │
              ▼ imported by           ▼ $ref'd by
   src/wire/{identity,subject,envelope,canonicalize}.ts   schemas/envelope.schema.json  ($id .../envelope/v3)
   = WP-2's identity.ts, GENERALIZED, AUTHORED ONCE       schemas/identifiers.schema.json
              │
              ▼ published from myelin package.json "exports"
   ┌──────────────────────────────────────────────────────────────────────────────┐
   │  @the-metafactory/myelin/wire      the codec (parse/render/canonicalize)       │
   │  @the-metafactory/myelin/vectors/* the conformance JSON (language-agnostic)    │
   │  @the-metafactory/myelin/schemas/* the generated JSON-Schemas                  │
   └───────────────┬───────────────────────────────┬──────────────────────────────┘
                   │ import the class (TS)          │ import ONLY the vectors (any language)
                   ▼                                ▼
        cortex · pilot · signal          any non-TS / own-parser impl
        (delete local regex+decoder)     (1 conformance test, own parser)
```

The chain is one-directional (`specs/CONFORMANCE.md` "Precedence"): where a generated artifact disagrees with the ABNF the ABNF governs and the artifact is a defect; where a vector disagrees with the ABNF the vector is the defect; where an implementation disagrees with the vectors the implementation is the defect.

---

## 3. The source-of-truth pipeline

### 3.1 What is authored vs generated

| Artifact | Path | Authored / Generated | Notes |
|---|---|---|---|
| Grammar | `specs/grammar/*.abnf` | **Authored** (normative) | One file per syntactic RFC; terminal alphabets defined once and referenced (`grammar/README.md` rule 5). |
| Vectors | `specs/vectors/**/*.json` | **Authored, CI-checked** | Adversarial cases can't be generated — they're derived from real defects (`vectors/README.md` rule 4/5). CI asserts they are *consistent with* the grammar. |
| Regex atoms + class table | `src/wire/generated/patterns.ts` | **Generated** | One exported `RegExp` per grammar rule + the branded-type/class manifest (`principal`/`stack`/`agent`/`subject`). Committed. |
| JSON-Schema patterns | `schemas/generated/patterns.defs.json` | **Generated** | A `$defs` fragment (`did`, `principal-id`, `stack-slug`, …) that every schema `$ref`s. Committed. |
| Schema skeletons | `schemas/*.schema.json` | **Authored shape, generated patterns** | Properties/required are authored; every `pattern` is a `$ref` into the generated `$defs`. No literal regex ever typed into a schema again. |
| The codec orchestration | `src/wire/{identity,subject,envelope,canonicalize}.ts` | **Authored once, in myelin** | WP-2's `identity.ts`, generalized. The split-on-slash in `parseStackId`, the class arbitration in `parseDid`, the canonical preimage builder — control flow a context-free grammar can't express — is hand-written **once**, over the *generated* atoms. |

The honest boundary: **the alphabets and shapes are generated from ABNF; the parse/render/canonicalize logic is authored exactly once, in myelin, on top of the generated atoms.** You cannot generate `parseDid`'s disambiguation from a CFG (that's a semantic choice — WP-4/cortex#1880), but you *can* guarantee it never invents a second copy of the alphabet.

### 3.2 The generator

- **Lives in myelin** at `tools/abnf-gen/` — myelin is the spec owner, so the generator ships with the spec. Invoked `bun run gen` (write) and `bun run gen --check` (CI, no-write).
- **Input:** every `specs/grammar/*.abnf`. It validates each parses as ABNF [RFC5234] first (a grammar that doesn't parse is not a grammar — `grammar/README.md` rule 2), then emits the `generated:` manifest declared in each RFC's front-matter (`rfc/template.md` `generated:` field). The RFC's manifest is the list CI iterates.
- **Output targets** are declared per-RFC, not discovered — so a new generated artifact is a reviewable front-matter edit.

### 3.3 CI drift gates (regenerate-and-diff)

myelin CI (per `specs/CONFORMANCE.md` "myelin MUST"):

1. **ABNF parses.** Each `specs/grammar/*.abnf` validates as RFC5234.
2. **No generated drift.** `bun run gen --check` regenerates every RFC's `generated:` manifest into a temp dir and `diff`s against the committed files. Any diff fails the build. This is the gate that would have caught the vendored-schema drift.
3. **Vectors ⊂ grammar.** For every `valid.json` vector, the generated regex for its `kind` MUST match `input`; for every `invalid.json`, it MUST NOT. A vector that contradicts the ABNF fails CI (the vector is the defect).
4. **Every vector has a `why`** (`vectors/README.md` rule 1).

Consumer CI (per `specs/CONFORMANCE.md` "Each consumer MUST"):

5. **Pin + run vectors.** Pin a `@the-metafactory/myelin` version and run its vectors against the consumer's own parser; fail on any miss.
6. **Vendor nothing, or gate the vendor.** Prefer importing `./schemas`; if a copy is unavoidable, a check fails when it diverges from the pinned version. The end-state deletes the vendored copy entirely (§8).

---

## 4. The published artifact(s)

myelin `package.json` today (`origin/main`) exports `.`, `./subjects`, `./envelope`, `./identity`, `./sovereignty`, `./transport`, `./discovery`, `./composition`, `./bidding`, `./edge` — but **no `./wire`, no `./vectors`, no `./schemas`.** Add them:

```jsonc
// @the-metafactory/myelin  package.json  (proposed additions)
"exports": {
  // … existing …
  "./wire":            "./src/wire/index.ts",        // the codec — the generalized WP-2 identity.ts
  "./wire/identity":   "./src/wire/identity.ts",     // principal/stack/agent DID, stackId, slug
  "./wire/subject":    "./src/wire/subject.ts",      // federated.{p}.{s}.{…} construct/parse
  "./wire/envelope":   "./src/wire/envelope.ts",     // shape-validate + canonicalize (RFC-0003/0004)
  "./vectors/*":       "./specs/vectors/*",          // resolves the CONFORMANCE.md import verbatim
  "./schemas/*":       "./schemas/*"                 // generated JSON-Schemas, incl. envelope.schema.json
}
```

`./vectors/*` is chosen so the import in `specs/CONFORMANCE.md` resolves unchanged:

```ts
import valid from "@the-metafactory/myelin/vectors/identifiers/valid.json" with { type: "json" };
```

### 4.1 Package layout (myelin)

```
myelin/
├─ specs/
│  ├─ grammar/*.abnf                  AUTHORED (normative)
│  ├─ vectors/<rfc>/{valid,invalid,render}.json   AUTHORED, CI-checked
│  └─ rfc/rfc-000N-*.md               front-matter names grammar/vectors/generated
├─ tools/abnf-gen/                    the generator
├─ src/
│  └─ wire/
│     ├─ generated/patterns.ts        GENERATED (regex atoms + class table)
│     ├─ identity.ts                  AUTHORED ONCE  ← WP-2 identity.ts, generalized
│     ├─ subject.ts                   AUTHORED ONCE
│     ├─ envelope.ts / canonicalize.ts
│     └─ index.ts                     public surface of ./wire
└─ schemas/
   ├─ generated/patterns.defs.json    GENERATED $defs ($ref'd by every schema)
   ├─ identifiers.schema.json         AUTHORED shape, GENERATED patterns
   └─ envelope.schema.json            $id: https://schemas.meta-factory.ai/envelope/v3
```

### 4.2 Versioning — two clocks, kept distinct

- **The package clock** (`@the-metafactory/myelin` semver, currently `0.6.0`): tracks the *code shape* of `./wire` — a new export, a new branded type, a bug fix. Consumers pin it. (Note: pilot today pins myelin by a raw git commit — `package.json` → `"@the-metafactory/myelin": "…git#f5ec8658…"`. Move that to a tag/version so the pin is legible and BCP-governed.)
- **The contract clock** (`$id: …/envelope/vN`, and the RFC number): tracks the *wire grammar*. It may only move through **RFC-BCP-0001 (Wire Change Control)** — a new RFC that `Updates:`/`Obsoletes:` the prior one, **two signatures** (principal + hub custodian), a new schema `$id`, and a **dual-accept window** with a named retirement release (`specs/CONFORMANCE.md` "Changing the wire").

A consumer pins the package **and** asserts the contract in its conformance test: `expect(envelopeSchema.$id).toMatch(/\/envelope\/v3$/)`. A package bump that silently changed the grammar would trip that assertion — the two clocks cross-check each other.

---

## 5. Scope boundary — the library is the grammar, not the policy

| In `@the-metafactory/myelin/wire` (pure, deterministic, RFC-bound) | Stays per-repo (policy, trust, wiring) |
|---|---|
| Parse/render/decode each identity class: principal/stack/agent DID, `stackId`, slug, subject (RFC-0001/0002) | **Admission decisions** — *who* may join/act (RFC-0006 fixes the message shape; the yes/no is cortex's) |
| Envelope shape-validation + **canonicalization** — the byte-exact signing preimage (RFC-0003/0004) | **Trust** — does this signature come from a *key I trust*? key/PSK resolution, sovereignty **enforcement** (RFC-0005 shape ≠ the crossing decision) |
| **Signature-shape** verify — is this a well-formed `SignedBy`, does the canonical preimage recompute? | **Transport wiring** — NATS connect, JetStream consumer config, redelivery/retry policy |
| Capability-advertisement canonicalization + id shape (RFC-0008) | **The ack/nak/term mapping** — which reason retries vs terminates (`release-consumer.ts:878` logic stays; only the *tokens* are shared) |
| The NAK **reason vocabulary** as a closed enum (RFC-0007) — the tokens, not the routing | **Surface rendering** — Discord/MC presentation, worklog |
| The class **arbitration** once WP-4 decides the encoding (a predicate edit, one place) | **The encoding *choice*** itself — that's an RFC decision, not a code decision |

One-sentence test: **the library tells you whether a string is a well-formed X and turns it into or out of its parts; it never tells you whether to trust it, admit it, route it, or act on it.**

---

## 6. The one-way dependency

**The rule:** myelin is M3. `src/wire/**` imports only myelin wire primitives and the standard library — never a symbol, type, or concept from M4–M7. Every input and output of the codec is a wire primitive (a string, a branded string, or a plain record that mirrors an ABNF rule). If a proposed addition to `./wire` needs to import a cortex type, name a cortex concept, or encode a cortex policy, **it does not belong in `./wire`.**

Three enforcement layers, weakest to strongest:

1. **Static (mechanical):** a dependency-cruiser/lint rule in myelin CI forbids `src/wire/**` from importing outside `src/wire` + the identity primitives. A consumer's convenience type cannot even be referenced.
2. **Process (RFC gate):** anything on the wire needs an RFC, and an RFC binds **two signatures** (`specs/README.md` rule 3). A single consumer cannot unilaterally widen the grammar to suit itself.
3. **Contribution shape:** grammar changes are PRs against `specs/grammar/*.abnf` + a vector, reviewed in myelin — never a codec patch in a consumer that "temporarily" forks the alphabet. The generator then re-emits the codec, so there is no hand-edited codec to fork.

This is what stops the WP-2→cortex mistake from recurring: the codec's home is the layer it belongs to, and the dependency arrow physically cannot point back up.

---

## 7. The non-TS / conformance story

The conformance contract is **the vectors, not the class** (`specs/CONFORMANCE.md`): each implementation adds *one* test that loads the vectors and runs **its own** parser — "otherwise you are testing myelin, not yourself." Importing the class is a convenience for TS callers; passing the vectors is the actual obligation.

Today all four repos are TypeScript (`cortex`, `pilot`, `signal`, `signal-collector` each ship a `package.json`; pilot already depends on myelin). So:

| Repo | Language (verified) | Imports the class? | Runs the vectors? |
|---|---|---|---|
| **myelin** | TS | is the class | authors + validates the vectors |
| **cortex** | TS | **Yes** — `@the-metafactory/myelin/wire` | Yes — 1 conformance test |
| **pilot** | TS | **Yes** | Yes — 1 conformance test |
| **signal** | TS | **Yes** | Yes — 1 conformance test |
| *any future non-TS / own-parser impl* | — | **No** (cannot) | **Yes** — vectors are the *only* contract |

The rule: **import the class if you're TS and want to; but the build passes or fails on the vectors regardless.** The moment any consumer grows a second parser — a Rust signal rewrite, a hot-path hand-parser, a schema-only validator — it is bound by the vectors and owes nothing to the class. That is why `./vectors` is a first-class published export, not an afterthought.

---

## 8. Migration

The crux: **do not merge WP-2's `identity.ts` into cortex.** It is the right code in the wrong repo. Re-home it to myelin `src/wire/`, then have cortex consume it. Concretely, in landing order:

**WP-3 (new, myelin-only — lands first).**
- Stand up `tools/abnf-gen`; author `specs/grammar/identifiers.abnf` + `subject-namespace.abnf`; generate `src/wire/generated/patterns.ts` + `schemas/generated/patterns.defs.json`.
- Move WP-2's `feat/wp2-wire-identity-codec:src/common/wire/identity.ts` into myelin `src/wire/identity.ts`, generalized so its `PRINCIPAL_ID_RE`/`STACK_SLUG_RE`/`AGENT_ID_RE`/`WIRE_DID_RE` come from `generated/patterns.ts` instead of being transcribed inline.
- Port WP-2's inline test cases into `specs/vectors/identifiers/{valid,invalid}.json` (each with a `why` citing its source defect — cortex#1812 for the fabricated-`default` case, jc-fold for the class mismatch).
- Publish `./wire`, `./vectors`, `./schemas`. Draft RFC-0001 + RFC-0002.
- **No consumer is touched in WP-3.**

**cortex adoption (WP-3.1).**
- Delete `src/bus/myelin/vendor/envelope.schema.json` (the drifting vendored copy, DID pattern inlined ×5). Import `@the-metafactory/myelin/schemas/envelope.schema.json`.
- Turn cortex's local `src/common/wire/identity.ts` into a thin re-export of `@the-metafactory/myelin/wire` — so WP-5's call sites, once migrated, never have to move again.
- Add the one conformance test (`import "@the-metafactory/myelin/vectors/identifiers/valid.json"`, run cortex's parser).

**WP-4 (cortex#1880 — the DID encoding decision).**
- Lands as an RFC-0001 amendment + a predicate edit in myelin's `parseDid` (its `ok:true` branch, unreachable today, becomes reachable) + new collision-pair vectors. **One place changes**, and every consumer inherits it by version bump.

**WP-5 (the ~15 splice sites — cortex).** Each hand-rolled site is replaced by a `./wire` call and its local grammar deleted:
- First-hyphen decoder `review-consumer.ts:1454` → `parseDid` / `parseStackId`; delete `SEGMENT_RE` at `:1474`.
- `cortex.ts:1024` (`-+` collapse), `probe-responder.ts:433/369`, `federation-reconciler.ts:459` (`default` fabrication), `roster-read.ts:263`, `stack-id.ts` (`stackSlugFromStackId`) → `parseStackId` / `stackDid`.
- Minters `dispatch-source-publisher.ts:203`, `reflex-activation-listener.ts:268`, `network-ping-signer.ts` → `agentDid` / `stackDid` / `federatedSubject`.
- Inline slug/stack-id regexes `network.ts:516/1199/2684`, `stack.ts:72`, `provision-stack.ts:83`, `common/types/stack.ts:230` → import the branded parsers.

**RFC-0007 (NAK vocabulary).** Promote the `DispatchTaskFailedReason` **tokens** (`dispatch-events.ts:462`) into `./wire` as a closed enum; cortex keeps the reason→ack/nak/term **mapping** (`release-consumer.ts:878`, etc.) — that's policy.

**RFC-0008 (capability wire).** cortex re-exports myelin `./discovery` (`canonicalizeAdvertisement`, `verifyCapabilityRegistration`); delete the parallel `CAPABILITY_ID_REGEX` triplet (`capability.ts:172`, `offering.ts:76`, `offer.ts:125`).

**What each consumer ultimately deletes:**
- **cortex:** the vendored schema + its 5 inline DID patterns; `SEGMENT_RE`; the first-hyphen decoder + its 3 divergent mirrors; the 6 slug/stack-id regex copies; the capability-id triplet; eventually the local `common/wire/identity.ts` shim.
- **pilot:** its `encodeRequesterDid` minter (`did:mf:${principal}-${stack}`, the thing `review-consumer.ts:1454` inverts) → `stackDid`; and its raw git-hash myelin pin → a version.
- **signal:** its own subject/identity regexes → `./wire` (TS) or, if it ever forks a parser, the vectors.

---

## 9. Phased rollout

| Phase | Scope | Gate to advance |
|---|---|---|
| **P0** | RFC-0001/0002 Draft; `identifiers.abnf` + `subject-namespace.abnf` authored; `tools/abnf-gen` emits `patterns.ts` + `patterns.defs.json`; `bun run gen --check` green | ABNF parses; generated diff clean |
| **P1** | WP-2 codec re-homed to myelin `src/wire/`; WP-2 tests ported to `specs/vectors/identifiers/`; publish `./wire` `./vectors` `./schemas` | Vectors ⊂ grammar; every vector has a `why` |
| **P2** | cortex adoption: delete vendored schema, import `./schemas`, add conformance test, local `identity.ts` → re-export | cortex CI runs myelin vectors green |
| **P3** | WP-4 encoding decision → RFC-0001 amendment + `parseDid` predicate + collision vectors | Two signatures; collision-pair vectors pass |
| **P4** | WP-5 splice migration (~15 sites) behind review | Each deleted site covered by a vector |
| **P5** | RFC-0007 NAK tokens + RFC-0008 capability wire folded in | pilot + signal each add their conformance test; pilot re-pins by version |

Nothing after P1 touches a consumer until its predecessor's gate is green; P2–P5 are per-consumer and independently revertible.

---

## 10. Open decisions (for the principal)

1. **The DID encoding (WP-4 / cortex#1880) is the keystone.** Until it's decided, `parseDid` stays `ambiguous` and the first-hyphen decoders can't be deleted — only routed through a codec that also refuses to guess. Options on the table (class prefix / reserved separator / hyphen-ban in one class) each imply a different `identifiers.abnf`. **Which encoding?** This is the one decision blocking P3–P4.
2. **Does canonicalization (RFC-0004) ship in `./wire` or stay in `./envelope`?** myelin already exports `./envelope`; the signing preimage is arguably the same module. Proposal: `./wire/envelope` re-exports it so consumers have one import surface, but the code stays put. Confirm.
3. **NAK vocabulary — wire contract or cortex-local?** It's `docs/architecture.md` §7.3 "canonical" but lives in a consumer (`dispatch-events.ts:462`). Promoting the *tokens* to RFC-0007 makes them a two-signature contract. Is the reliability vocabulary actually cross-repo, or is it cortex's alone? (If cortex-only, it stays out of `./wire`.)
4. **Vector authorship home.** Vectors are authored, not generated. When cortex retires a defect (e.g. cortex#1812's `default` fabrication), the regression vector should be *added to myelin's `specs/vectors/`*, not to a cortex test. Confirm that cortex bug-fix PRs are expected to open a companion myelin vector PR.
5. **pilot's myelin pin.** Move from a raw git commit to a semver/tag before P5, so the BCP dual-accept window has a legible pin to reason about. Agree?
6. **`patterns.ts` — committed or built?** Proposal: **committed** (so `git diff` shows wire changes as reviewable diffs and the drift gate is a plain `diff`), with `bun run gen --check` enforcing it. The alternative (build-time only) hides the wire change from review. Confirm the committed-artifact stance.