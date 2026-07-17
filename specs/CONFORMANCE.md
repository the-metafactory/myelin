# Conformance

## What conformance means

An implementation conforms to a `Ratified` RFC **if and only if it passes every vector** under the
path named in that RFC's `vectors` front-matter field.

Reading the specification is not conformance. Passing the vectors is.

## Who must conform

Every repository that constructs or parses a myelin wire representation — a subject, an envelope
field, a stack identifier, or a DID.

| Repository | Layer | Role |
|---|---|---|
| **myelin** | M3 | Specification owner; reference implementation |
| **cortex** | M7 | Consumer |
| **pilot** | M7 | Consumer |
| **signal** | M7 | Consumer |

A repository that renders or parses these representations and does **not** run the vectors is, by
construction, a fourth independent implementation of an unspecified grammar. That is the condition
this directory exists to end.

## How to claim conformance

Add exactly one test. It loads the vectors, runs **your own** parser, and asserts. It does not
import the reference implementation — otherwise you are testing myelin, not yourself.

```ts
import valid   from "@the-metafactory/myelin/vectors/identifiers/valid.json"   with { type: "json" };
import invalid from "@the-metafactory/myelin/vectors/identifiers/invalid.json" with { type: "json" };
import { parseStackId } from "../src/wherever/your/parser/lives";

for (const v of valid) {
  test(`RFC-${v.rfc} ${v.id} — ${v.why}`, () => {
    const r = parseStackId(v.input);
    expect(r.ok).toBe(true);
    expect(r.value).toEqual(v.expect.value);
  });
}

for (const v of invalid) {
  test(`RFC-${v.rfc} ${v.id} — ${v.why}`, () => {
    const r = parseStackId(v.input);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(v.expect.reason);   // reasons are stable machine tokens
  });
}
```

The `why` is deliberately in the test name. When it fails at 2am, the failure explains itself.

## Precedence

The chain is one-directional. Everything downstream is **generated or checked**, never authored:

```
  ABNF  (normative, specs/grammar/*.abnf)
    │
    ├─ generates ─▶  regexes · JSON Schema `pattern`s · parsers   (listed in `generated`)
    │
    └─ constrains ─▶ vectors  (specs/vectors/**)
                        │
                        └─ decide ─▶ conformance of each implementation
```

Where a generated artifact disagrees with the ABNF, **the ABNF governs and the artifact is a
defect.** Where a vector disagrees with the ABNF, the vector is a defect. Where an implementation
disagrees with the vectors, the implementation is a defect.

Hand-maintaining any downstream artifact reintroduces exactly the drift this replaces. At time of
writing the DID grammar existed as **three hand-written copies** — a runtime regex, a JSON Schema
pattern, and a vendored copy of that schema in another repository, which had already diverged.

## CI requirements

Each consumer repository MUST:

1. Pin a version of `@the-metafactory/myelin` and run its vectors in CI.
2. Fail the build on any vector failure. Vectors are not advisory.
3. Fail the build if a vendored copy of a myelin artifact diverges from the pinned version — or,
   preferably, vendor nothing and import it.

myelin MUST:

1. Validate every `specs/grammar/*.abnf` parses as ABNF [RFC5234].
2. Regenerate the artifacts listed in each RFC's `generated` field and fail if the committed output
   differs — **era-parameterized across the flag-day-R cut (D6).** An unconditional regenerate-and-diff
   is red forever pre-R, because `schemas/envelope.schema.json` legitimately carries the pre-R DID
   pattern until the cut (RFC-0001 front-matter: "regenerated at the flag-day cutover (§9)"). The gate
   is therefore applied **per era**:
   - **Pre-R (today):** committed artifacts are generated from the pre-R grammar and diffed against
     that **pre-R generation**. A mismatch fails the build. This is the live gate.
   - **Post-R artifacts** are generated to a **staged path (`generated/r/`)** and the gate diff-checks
     them THERE, against **post-R generation** — they do NOT overwrite the live pre-R artifacts, and the
     live pre-R diff does NOT compare against post-R output.
   - **The cut event is R** — the RFC-0001 §9 coordinated hard cut, a two-party `[principal-hands]`
     event — which atomically swaps the staged `generated/r/` artifacts into place. At R the gate
     re-parameterizes to diff against post-R generation. This is what keeps the gate green through the
     pre-R window instead of red-forever against an artifact that is correctly still pre-R.
3. Fail if any vector lacks a `why`.

## Changing the wire

An encoding change is never a silent edit. Under **single-principal ratification (v1)** —
[`docs/adr/0001-single-principal-ratification.md`](../docs/adr/0001-single-principal-ratification.md)
— a `Ratified` RFC is a **living spec**, not a stone tablet: `Ratified` means the current best
contract the implementation tracks. While myelin is the only implementation and no federated peer
is live, an encoding change is handled by **revise-and-reimplement**: change the RFC, regenerate
the derived artifacts, and prove the change with the **conformance vectors** — the load-bearing
artifact under this model. A **dual-accept window is NOT required in v1.**

The heavier discipline below is the **reinstate-target**: it is not deleted, and it reinstates in
full the moment a **second independent implementation** exists **or** a **live federated peer
principal** joins a network (the ADR-0001 reversal trigger). Once reinstated, an encoding change
requires, in order:

1. A new RFC (`Updates:` or `Obsoletes:` the prior one) — a `Ratified` RFC is then immutable and
   never edited in place.
2. Both signatures: the principal and the hub custodian.
3. A new schema version (`$id: .../envelope/vN`), with the prior version kept published for pinned
   consumers.
4. A **dual-accept window**: receivers accept both the old and new forms for at least one release,
   logging use of the old form.
5. A named retirement release. A migration window without an end date is a migration that never
   ends — see the `default`-derivation rule in [`namespace.md`](namespace.md), whose window has
   been open since it was written.

The full procedure is specified in compass `sops/federation-wire-protocol.md`.
