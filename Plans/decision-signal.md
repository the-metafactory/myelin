# Decision memo — signal becomes a myelin consumer (H2)

**Status:** DECISION NEEDED (human). Draft per remediation task H2. Nothing changed.

## The problem

`signal` consumes myelin's published language — subjects and envelopes — but does
**not** depend on `@the-metafactory/myelin`. Its `package.json` has no myelin dep;
it shadow-parses the wire format with raw `nats` + `zod` in
`signal/src/cli/envelope-tap.ts`, `relay-run.ts`, and siblings.

This is the review's **highest silent-drift risk**: signal re-implements the
subject grammar and envelope shape from its own reading of the spec. When myelin
changes the grammar (e.g. the `{org}`→`{principal}` cut, the stack segment, the
`signed_by[].identity` rename), signal does not fail to compile — it keeps parsing
against a stale mental model and silently mis-routes or drops envelopes.

## Options

### A. Status quo — signal keeps its own parser
- **+** No change; signal stays dependency-light.
- **−** Every myelin grammar change is a latent signal bug with no compile-time
  signal. The drift is invisible until production mis-routing.

### B. signal adopts `@the-metafactory/myelin/subjects` (recommended)
The `./subjects` subpath is **pure** — no NATS client, no Zod, no Ajv, no envelope
schema (verified: its only imports are relative pure siblings + a type-only
`identity/types`). Importing it is cheap and edge-safe. signal would replace its
hand-rolled subject derivation/matching with `deriveSubject` / `subjectFor` /
`subjectMatchesPattern` / `detectSubjectForm`, and (optionally) `./envelope`'s
`validateEnvelope` for shape checks.
- **+** One source of truth for the grammar; a myelin grammar change becomes a
  compile error or a caught test failure in signal, not a silent drift.
- **−** signal takes a myelin dep (small, pure subpath); one adoption PR.

## Proposed rule

Adopt the review's proposal into `CONTRIBUTING.md` / architecture conventions:

> **Consumers of the published language MUST consume the reference parser.**
> Any repo that parses myelin subjects or envelopes imports
> `@the-metafactory/myelin/subjects` (and `/envelope` where it validates
> envelopes) rather than re-implementing the grammar.

## Recommendation

**B**, plus adopt the rule. The `./subjects` subpath was built precisely to make
this cheap (that is remediation E1's rationale). signal is the clearest case.

## What this memo does NOT do

Modify signal, add the dep, or write the rule into a governance doc. Human ratifies
the rule and schedules signal's adoption PR (which, per B2's precondition gate,
also determines whether signal is a "verifier" that must be considered before any
`spec_version`-emit cut).
