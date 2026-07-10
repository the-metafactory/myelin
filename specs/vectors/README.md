# Test vectors

**Prose explains. Vectors bind.**

Vectors are the normative conformance artifact. They are plain JSON, deliberately: an
implementation in any language, in any repository, can consume them without importing TypeScript.
A shared class binds only the callers who can import it. Vectors bind everyone.

## Layout

```
specs/vectors/
  <rfc-short-name>/
    valid.json        # inputs that MUST parse, with their expected parse result
    invalid.json      # inputs that MUST be rejected, with the expected reason
    render.json       # tuples that MUST render to an exact string
```

Vectors are exported from the package so consumers can load them directly:

```ts
import valid from "@the-metafactory/myelin/vectors/identifiers/valid.json" with { type: "json" };
```

## Vector schema

Each file is a JSON array. Every element:

```jsonc
{
  "id": "stack-id/non-default-slug",   // stable, unique, referenced by bug reports
  "rfc": 1,                            // the RFC this vector enforces
  "kind": "parseStackId",              // the operation under test
  "input": "andreas/meta-factory",
  "expect": {
    "ok": true,
    "value": { "principal": "andreas", "stack": "meta-factory" }
  },
  "why": "A stack whose slug is not `default` must round-trip. Guards cortex#1812."
}
```

For a rejection:

```jsonc
{
  "id": "stack-id/no-separator",
  "rfc": 1,
  "kind": "parseStackId",
  "input": "andreas",
  "expect": { "ok": false, "reason": "missing-separator" },
  "why": "A missing stack segment is a FAULT, never a `default`. Root cause of cortex#1812."
}
```

### Field rules

| Field | Rule |
|---|---|
| `id` | REQUIRED. Stable forever — vectors may be added, never renamed. |
| `rfc` | REQUIRED. The RFC number whose requirement this vector enforces. |
| `kind` | REQUIRED. Names the operation, not the implementation's function name. |
| `input` | REQUIRED. |
| `expect.ok` | REQUIRED. `true` ⇒ `value` REQUIRED. `false` ⇒ `reason` REQUIRED. |
| `expect.reason` | A stable machine token (`missing-separator`), not a human sentence. |
| `why` | **REQUIRED.** Names the invariant or the bug this vector guards. A vector that cannot explain itself is a vector nobody will dare delete. |

## Rules

1. **Every vector carries a `why`.** This is enforced in CI. It is the difference between a
   regression suite and a pile of assertions no one understands in a year.
2. **Vectors are additive.** Never renamed, never repurposed. A wrong vector is *deleted* with a
   note in the RFC's change log, never quietly edited.
3. **Vectors MUST be consistent with the ABNF.** The ABNF is normative for syntax. Where a vector
   and the grammar disagree, the grammar governs and the vector is a defect.
4. **Adversarial cases are mandatory.** Every syntactic RFC MUST include vectors for:
   - the **masking case** — an input where the buggy behaviour coincidentally produces the right
     answer. (A stack literally named `default` masked cortex#1812 for two days, because the
     fabricated value happened to be correct for one party.)
   - **every collision pair** the identifier space permits
   - inputs that are legal in one rendering and illegal in another
5. **A vector that no implementation can fail is not pulling its weight.** Prefer inputs derived
   from real defects; cite them in `why`.

## Consuming them

Each implementation adds exactly **one** conformance test: load the vectors, run its own parser,
assert. See [`../CONFORMANCE.md`](../CONFORMANCE.md).
