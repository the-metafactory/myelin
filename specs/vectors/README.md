# Test vectors

**Prose explains. Vectors bind.**

Vectors are the normative conformance artifact. They are plain JSON, deliberately: an
implementation in any language, in any repository, can consume them without importing TypeScript.
A shared class binds only the callers who can import it. Vectors bind everyone.

## Layout

The canonical per-RFC layout is:

```
specs/vectors/
  <rfc-short-name>/
    valid.json        # inputs that MUST parse, with their expected parse result
    invalid.json      # inputs that MUST be rejected, with the expected reason
    render.json       # tuples that MUST render to an exact string
```

Not every directory splits this way — several ship a single self-describing array (`vectors.json`)
or an operation-split set. Every element carries the full `id`/`rfc`/`kind`/`input`/`expect`/`why`
schema regardless (§Vector schema), so a mixed file partitions cleanly on `expect.ok`. The **actual**
file set per directory:

| Directory | Files | Shape |
|---|---|---|
| `identifiers/` | `valid.json`, `invalid.json` | canonical split |
| `subject-namespace/` | `vectors.json` | single mixed array |
| `envelope/` | `valid.json`, `invalid.json` (+ `generate.ts`) | canonical split, generated |
| `envelope-signing/` | `canonicalize.json`, `sign-verify.json`, `reject.json` (+ `generate.ts`, `README.md`) | operation-split |
| `sovereignty/` | `crossing.json` | single mixed array |
| `admission/` | `valid.json`, `invalid.json` | canonical split (rejections moved out of `valid.json`, myelin#236) |
| `transport/` | `valid.json`, `invalid.json`, `render.json` | canonical split + render |
| `capability-discovery/` | `vectors.json` | single mixed array |
| `economics/` | `valid.json` | **valid-only** — see note |
| `rate-limit/` | `valid.json`, `invalid.json` | canonical split |

**economics exception.** `economics/` ships only `valid.json` — no `invalid.json` companion is
present in the tree. RFC-0009 is Informational (the `economics` block is OPTIONAL and never
normalized), and this directory is the one recorded deviation from Rule 4's adversarial-case
mandate. Recorded here as a noted exception (myelin#236 item 25), not corrected. Every other
grammared RFC carries its rejection vectors.

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
| `era` | OPTIONAL. `"pre-R"` or `"post-R"`; **absent = era-independent** (binds on both sides of the cut). |

**`era` — flag-day-R relativity.** A few vectors are only meaningful on one side of the flag-day-R
migration. `era: "pre-R"` marks a vector that pins **retired pre-cut byte-behaviour** — it is not a
conformance target for post-R emitters (RFC-0002 §13). `era: "post-R"` is reserved for a vector only
valid **after** the cut. Absent means era-independent. A CONFORMANCE.md runner **MUST skip
`era: "pre-R"` vectors when running in post-R mode** (and, once any exist, skip `era: "post-R"`
vectors in pre-R mode); with no `era` set, or no mode selected, every vector runs.

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
