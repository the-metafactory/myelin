# Myelin Remediation Plan — July 2026

Source: full-stack review 2026-07-01 (v0.4.0, HEAD `1185ac8`). This plan is written
for an executing agent with limited context. Follow it literally. When a step says
STOP, stop and ask a human.

---

## Global rules (read before every task)

1. **One task = one branch = one PR.** Branch name: `remediation/<task-id>`, e.g.
   `remediation/d3-identity-doc`. Never combine tasks in one PR.
2. **Before starting any task**, run from repo root (`~/work/mf/myelin`):
   ```bash
   git checkout main && git pull && bun install && bun test && bunx tsc --noEmit
   ```
   All must pass BEFORE you change anything. If they fail on clean main, STOP.
3. **After finishing any task**, run:
   ```bash
   bun test && bunx tsc --noEmit && bun run lint
   ```
   All three must pass. Paste their tails into the PR description.
4. **Line numbers in this plan may have drifted.** Always locate code with
   `grep -rn "<quoted string>"` rather than trusting a line number.
5. **NEVER touch these unless the task explicitly says so:**
   - `src/identity/canonicalize.ts` (`SIGNABLE_FIELDS` — signature-breaking)
   - `schemas/envelope.schema.json` required-fields or `additionalProperties`
   - any file under `src/` in a docs-only task
6. **Commit messages**: conventional commits (`docs:`, `feat:`, `fix:`, `chore:`),
   reference the task ID and, where given, the GitHub issue.
7. **Do not renumber, reorder, or "clean up" anything not named in the task.**
8. Tasks marked ⚠️ SENIOR REVIEW: open the PR as draft, request human review,
   do not merge yourself.

Task order matters inside a phase only where `depends:` says so. Phases are
sequential: finish Phase 1 before Phase 2, etc. (Phase 1 tasks are independent
of each other and may be done in any order.)

---

## Phase 1 — Documentation truth (no code changes, zero risk)

### D1 — architecture.md tells the truth about L5/L6/L4
- **Why:** `docs/architecture.md` says L5 Discovery "Code: None yet" and L6
  Composition "Code: None canonical" — but `src/discovery/` (10 files) and
  `src/composition/` (13 files) are implemented, tested, exported. It also says
  chain-of-stamps is "proposed" in #31 — it shipped via PR #92.
- **First check:** `gh pr view 34 -R the-metafactory/myelin`. PR #34 converts
  architecture.md to a static reference. If it is still open and mergeable:
  review its diff; if the diff removes stale status claims, merge it and then
  do only the residual edits below that #34 does not cover. If #34 conflicts
  badly, close it with a comment linking your new PR.
- **Edits (in `docs/architecture.md`):**
  1. §3 table row L5: status `spec pending` → `implemented (signed
     self-advertisements; NATS capability store deferred)`; Code column →
     `src/discovery/`.
  2. §3 table row L6: status `spec pending` → `partially implemented
     (orchestrator, workflow schemas in src/composition/; bidding/negotiation
     in src/bidding/; spec #10 still open)`.
  3. §3 + §4 L4: replace every "chain proposed in #31" with "chain-of-stamps
     shipped (#31, PR #92)".
  4. §4 L5/L6 "Code. None" paragraphs: replace with the actual module lists.
  5. Add the unmapped modules to the code mapping: `src/subjects.ts` +
     `subject-matching.ts` + `subject-vocabulary.ts` + `segment-validators.ts` +
     `patterns.ts` + `classifications.ts` (L2/L3 namespace grammar),
     `src/dispatch/`, `src/lifecycle/` (L3/L6), `src/agent-identity/` (L4),
     `src/bidding/` (L6), `src/observability/`, `src/serialization/` (L3),
     `src/edge.ts` (packaging surface), `src/dual-field.ts` (L3 compat).
  6. §8 snapshot: retitle to current month, add edge subpath (#191) to the
     rows, fix L4/L5/L6 rows to match items 1–3.
  7. §4 L4 says the chain design "will be reachable in-tree once #32 merges"
     (appears twice) — but D2 closes #32 as superseded. Replace both with a
     pointer to the shipped location (`git log --all --oneline -- '*chain*'`
     to find where the design/impl landed; likely PR #92's files).
- **Acceptance:** `grep -n "None yet\|None canonical\|chain proposed\|proposed in #31\|once #32 merges\|#32 merges" docs/architecture.md`
  returns nothing. `grep -c "src/bidding" docs/architecture.md` ≥ 1.

### D2 — close superseded PR #32
- **Why:** PR #32 is a design memo for chain-of-stamps; the feature shipped via
  PR #92. Leaving it open misleads.
- **Steps:** `gh pr close 32 -R the-metafactory/myelin -c "Superseded: chain-of-stamps shipped via #92. Design content preserved in git history and docs/identity.md."`
- **Acceptance:** `gh pr view 32` shows state CLOSED.

### D3 — identity.md code blocks migrated to current vocabulary
- **Why:** Worst doc offender. Prose was updated but TypeScript blocks still
  show the pre-migration API, contradicting the shipped wire format and
  CONTEXT.md.
- **Steps:** In `docs/identity.md`, inside code blocks and field tables only:
  - `interface Principal` → `interface Identity`; `PrincipalType` → `IdentityType`
  - `signed_by[].principal` / `signed_by.principal` → `signed_by[].identity`
  - `PrincipalRegistry` → `IdentityRegistry`
  - `type: "operator"` → `type: "hub"`; field `operator` → `network`
  - `mustIncludePrincipalType` → `mustIncludeIdentityType`;
    `mustIncludePrincipal` → `mustIncludeIdentity`
  - **Cross-check every rename against the real source of truth** —
    `src/identity/types.ts` and `src/identity/verify.ts` — the code is right,
    the doc is wrong. If doc and code disagree in a way this list doesn't
    cover, match the code.
- **Acceptance:** `grep -n "PrincipalRegistry\|signed_by.principal\|\"operator\"\|mustIncludePrincipal" docs/identity.md` → empty.
  Do NOT change occurrences of the bare word "principal" where it correctly
  means the human (read the sentence; CONTEXT.md defines the distinction).

### D4 — sovereignty.md + nak-reasons.md residual vocab
- **Steps:**
  1. `docs/sovereignty.md`: ingress-flow references `signed_by.principal` →
     `signed_by[].identity`; policy example key `"org"` → check the real field
     name in `src/sovereignty/schema.ts` first and use THAT (the code may
     genuinely still use `org` — if so, leave the doc, note it in the PR, and
     file an issue instead).
  2. `docs/nak-reasons.md`: code examples pass `org: "metafactory"` — check
     `src/transport/nak.ts` for the real `NakContext` field name (CHANGELOG
     PR-7 renamed it to `principal`); update examples to match code.
- **Acceptance:** every field name in both docs' code examples exists verbatim
  in the corresponding `src/` type definition (verify with grep per name).

### D5 — README repair
- **Why:** Quick-start says `pip install jsonschema` in a Bun/TypeScript repo;
  file tree omits half the docs; roadmap lists shipped work as pending.
- **Steps in `README.md`:**
  1. Replace the Python quick-start with:
     ```ts
     // validate.ts
     import { validateEnvelope } from '@the-metafactory/myelin/envelope';
     import envelope from './examples/valid-envelope.json';
     console.log(validateEnvelope(envelope));
     ```
     and the run line `bun validate.ts`. Check `src/envelope.ts` for
     `validateEnvelope`'s actual signature/return shape first and make the
     example match reality (run it yourself with `bun` before committing).
  2. "What's here" tree: add `docs/identity.md`, `docs/sovereignty.md`,
     `docs/sovereignty-operator.md`, `docs/discovery.md`, `docs/envelope.md`,
     `docs/migrations/`, `src/` one-liner, `examples/*.ts` runnable examples.
  3. Roadmap section: chain-of-stamps → shipped (#31/PR #92); L5 discovery →
     shipped core (advertisements), NATS store deferred; keep L6 spec (#10)
     and sovereignty protocol (#11) as open.
- **Acceptance:** `grep -n "pip install" README.md` → empty; the quick-start
  snippet actually runs (`bun validate.ts` prints a result).

### D6 — purge stale tracking artifacts
- **Why:** Repo-root `ISA.md` (frozen 2026-05-06, claims 30/30 done for a
  2-artifact scope), `blueprint.yaml` (uses dead `{org}` grammar, everything
  "planned"), `.specflow/pipeline.json` (all features "in_progress" though
  merged), `.triage/pr-93-cycle-1.md` (leftover) all assert a project state
  ~4 releases old.
- **Steps:**
  1. `mkdir -p docs/history && git mv ISA.md blueprint.yaml docs/history/`
  2. Add a 3-line `docs/history/README.md`: "Frozen iteration-1 planning
     artifacts, kept for provenance. Not current state — see
     docs/architecture.md."
  3. `git rm -r .specflow .triage` (they are committed? check `git ls-files
     .specflow .triage` first — if untracked, just note in PR that they are
     local-only and add both to `.gitignore` instead).
- **Acceptance:** repo root contains no ISA.md / blueprint.yaml;
  `git ls-files | grep -c specflow` → 0.

### D7 — mark migration-from-legacy-nats.md as historical
- **Why:** Uses pre-stack 5-segment `{operator}` grammar throughout; predates
  the vocab migration. Updating it fully is not worth it; mislabeling it is
  harmful.
- **Steps:** Add a banner at the top:
  > **Status: HISTORICAL (May 2026).** Written before the stack-segment
  > extension (#113) and the vocabulary migration
  > (docs/migrations/0001-vocabulary-grilled-2026-05.md). Subject grammar
  > shown here is the pre-stack 5-segment form. For current grammar see
  > specs/namespace.md.
- **Acceptance:** first 10 lines of the file contain "HISTORICAL".

### D8 — CI doc-drift guard
- **Why:** The drift D1 fixes will recur without teeth. architecture.md's own
  "maintenance obligation" failed exactly as its author feared.
- **Steps:**
  1. Create `scripts/check-architecture-coverage.ts`: list top-level entries of
     `src/` (dirs + `.ts` files, excluding `*.test.ts` and `fixtures/`); for
     each, assert the name appears somewhere in `docs/architecture.md`; exit 1
     listing misses.
  2. Wire into `.github/workflows/lint.yml` as a step:
     `bun scripts/check-architecture-coverage.ts`.
  3. Run it; it must pass on your post-D1 main (D1 added the missing modules).
     `depends: D1`.
- **Acceptance:** CI job green; deleting a random module mention from
  architecture.md locally makes the script exit 1.

---

## Phase 2 — Governance (no code changes)

### F1 — SECURITY.md
- **Why:** Crypto trust library (Ed25519 signing, key rotation, replay
  windows) with no vulnerability-reporting channel.
- **Steps:** Create `SECURITY.md`: supported versions (current minor only,
  pre-1.0), report channel (GitHub private vulnerability reporting — enable it
  via repo settings if you have permission, else STOP and ask), response
  expectation (best effort, pre-1.0), scope notes (signature verification,
  canonicalization, sovereignty enforcement are security surfaces; JetStream
  replay-window guidance from CHANGELOG 0.4.0 belongs here too — copy it in).
- **Acceptance:** file exists; mentions replay windows and reporting channel.

### F2 — CONTRIBUTING.md
- **Steps:** Short file: dev setup (`bun install`, `bun test`, docker compose
  for integration tests — `docker compose -f docker-compose.test.yml up -d`
  then `NATS_URL=nats://localhost:4222 bun test tests/integration`), PR rules
  (conventional commits, doc-update obligation for layer-contract changes per
  architecture.md §6, CODEOWNERS review), vocabulary rules (CONTEXT.md is the
  glossary; new terms need a CONTEXT.md entry).
- **Acceptance:** file exists; integration-test invocation is copy-pasteable
  and works.

### F3 — CHANGELOG anchors + release SOP + tags
- **Why:** Only `## [0.4.0]` and `## [0.3.0]` anchors exist; the 0.2.x
  transition block and chain-of-stamps entries dangle unanchored. Last git tag
  is `v0.2.0` although package.json says 0.4.0.
- **Steps:**
  1. In `CHANGELOG.md`: wrap the dangling transition sections under a new
     `## [0.2.0] — 2026-05` anchor (read the sections; if some content is
     clearly post-0.2.0 but pre-0.3.0, use `## [0.2.1]`). Fix the stray
     `- **F-018 MY-400**:` line by attaching it to its proper section.
  2. Create `RELEASING.md`: (a) bump `package.json` version; (b) add CHANGELOG
     anchor with date; (c) `git tag v<X.Y.Z> && git push --tags`; (d) announce
     pin-bump to consumers (list: cortex, pilot, sage, grove, cedar, reflex);
     (e) rule: **pre-1.0, minor = breaking; consumers must never be more than
     one breaking minor behind.**
  3. Tag current release: `git tag v0.4.0 <sha-of-0.4.0-cut>` — find the sha
     with `git log --oneline | grep -i "R13\|0.4.0"` (expected: `f5ec865` or
     the merge right after; confirm by checking package.json version at that
     commit: `git show <sha>:package.json | grep version`). Also tag HEAD's
     state if a 0.4.x anchor covers it. Push tags.
- **Acceptance:** `git tag` lists v0.4.0; every `###` section in CHANGELOG
  sits under a `## [x.y.z]` anchor.

---

## Phase 3 — Packaging & API surface (code, low risk, additive only)

### E1 — subpath exports for the demanded surfaces
- **Why:** Consumers route around the 477-line root barrel (cortex imports
  only `/subjects` + `/identity` because root "pulls myelin's full source
  tree"). Missing subpaths force root imports.
- **Steps:**
  1. In `package.json` `exports`, add:
     ```json
     "./sovereignty": "./src/sovereignty/index.ts",
     "./transport": "./src/transport/index.ts",
     "./discovery": "./src/discovery/index.ts",
     "./composition": "./src/composition/index.ts",
     "./bidding": "./src/bidding/index.ts"
     ```
     First verify each `index.ts` exists (`ls src/<dir>/index.ts`); if one is
     missing, create it exporting that module's public pieces (copy the list
     from what root `src/index.ts` re-exports for that subsystem).
  2. Add a smoke test `src/subpath-exports.test.ts`: for each subpath, dynamic
     `import()` and assert one known symbol is defined.
  3. Update README's subpath table (extend the existing `./subjects` /
     `./envelope` table).
- **Guardrail:** do NOT remove anything from root `src/index.ts` — additive
  only. Root-barrel slimming is a 1.0 decision, not this task.
- **Acceptance:** `bun test src/subpath-exports.test.ts` green; README table
  lists 11 entry points.

### E2 — edge surface gets subject *builders*
- **Why:** reflex (the only edge consumer) hand-builds every outbound subject
  (`` `local.${cfg.principal}.${cfg.stack}.reflex.cmd.${command}` `` in
  `reflex/src/cmd/protocol.ts`) because `./edge` exposes only
  `subjectMatchesPattern`, not the derivation helpers. Hand-built strings
  silently diverge when grammar changes.
- **Steps:**
  1. `src/subjects.ts` is dependency-pure (imports only sibling pure modules —
     verify: `grep "^import" src/subjects.ts` shows only relative
     `./segment-validators`, `./patterns`, `./subject-vocabulary`,
     `./classifications`). Therefore safe for edge.
  2. In `src/edge.ts`, add `export { deriveSubject, subjectPrefixAligns, detectSubjectForm } from './subjects';`
     (match the export style of the existing lines; include the types
     `SubjectClassification`, `SubjectForm` as `export type`).
  3. Run the bundle probe: `bun test src/edge-surface.test.ts` — it asserts no
     node-only deps leak into the edge bundle. It MUST stay green; if it goes
     red, you imported something impure — revert and STOP.
- **Acceptance:** edge-surface test green; `grep -n "deriveSubject" src/edge.ts` ≥ 1.
- **Follow-up (separate PR in reflex repo, after myelin pin-bump):** replace
  reflex's five hand-built subject template-literals (`src/cmd/protocol.ts`,
  `src/bus/stream.ts`, `src/sources/bus.ts`, `src/sources/run-outcome.ts`,
  `src/bus/envelopes.ts`) with `deriveSubject('local', cfg.principal, '<domain.entity.action>', cfg.stack)`.
  Assert output equality with the old literals in a test before deleting them.

### E3 — ergonomic subject API (additive, deprecating the footguns)
- **Why:** `deriveSubject('public', 'unused', type)` needs a dummy arg;
  trailing-optional `stack?` on `offerTaskSubject`/`directTaskSubject`/
  `taskSubject` silently switches legacy-5-segment vs stack-aware-6-segment
  output — a semantic change hidden in an optional param.
- **Steps:**
  1. In `src/subjects.ts`, add ONE new function (do not modify existing ones):
     ```ts
     export interface SubjectSpec {
       classification: SubjectClassification;
       type: string;              // domain.entity.action
       principal?: string;        // required unless classification === 'public'
       stack?: string;            // omit ONLY with legacy: true
       legacy?: boolean;          // explicit opt-in to 5-segment form
     }
     export function subjectFor(spec: SubjectSpec): string
     ```
     Semantics: `public` → ignore principal/stack; non-public without
     `principal` → throw; non-public without `stack` and without
     `legacy: true` → throw with message "stack required; pass legacy:true
     for the 5-segment migration form". Implement by delegating to the
     existing `deriveSubject` (do not duplicate grammar logic).
  2. Tests: one per branch above, plus equality checks
     `subjectFor({...}) === deriveSubject(...)` for the 4 forms.
  3. JSDoc-deprecate nothing yet — old API stays; add a line to
     `specs/namespace.md`'s helper section pointing new code at `subjectFor`.
- **Acceptance:** new tests green; `grep -c "subjectFor" src/subjects.ts` ≥ 2;
  zero diffs to existing function bodies (`git diff` shows only additions).

### E4 — ⚠️ SENIOR REVIEW — split `src/composition/orchestrator.ts` (1632 lines)
- **Why:** 3.3× the next-largest non-barrel file; recovery sweeps, lifecycle,
  and execution logic interleaved; its test file is 2265 lines.
- **Steps:** Mechanical extraction only, no behavior change:
  1. Read the file top to bottom once. Identify the three clusters: recovery
     sweep (search `[F-16]` comments), workflow execution, state/lifecycle
     bookkeeping.
  2. Extract each cluster to `orchestrator/recovery.ts`, `orchestrator/execute.ts`,
     `orchestrator/state.ts`; `orchestrator.ts` becomes composition + re-export
     so `src/composition/index.ts` and all imports stay unchanged.
  3. Move NO test code; `orchestrator.test.ts` must pass UNMODIFIED — that is
     the whole safety argument. If a test needs any edit, your extraction
     changed behavior: revert and try again.
- **Acceptance:** `bun test src/composition` green with zero test-file diffs;
  `wc -l src/composition/orchestrator.ts` < 400. Draft PR, human merges.

---

## Phase 4 — Wire version field ⚠️ SENIOR REVIEW (signature-adjacent)

### B1 — add `spec_version` to the envelope
- **Why:** The envelope has no version field; consumer skew (grove/sage two
  breaking cuts behind) is invisible until validation hard-fails. A version on
  the wire converts silent skew into a measurable, negotiable signal.
- **Design (fixed — do not improvise):** optional integer field
  `spec_version`, value `3` for the current grammar. Absent ⇒ legacy (pre-
  field) envelope. It goes INSIDE the signed fields eventually, but rollout
  must be two-phase because old verifiers drop unknown fields from the
  signing payload and would fail signatures on new envelopes. The repo's own
  migration doctrine applies: **verifiers before emitters** (see
  docs/migrations/0001-vocabulary-grilled-2026-05.md for the pattern).
- **Phase 4a (this task) — accept, never emit:**
  1. `schemas/envelope.schema.json`: add optional property
     `"spec_version": { "type": "integer", "minimum": 1 }` at envelope top
     level (top-level has `additionalProperties: false` — without the schema
     entry, envelopes carrying the field get rejected).
  2. `src/types.ts`: add `spec_version?: number` to `MyelinEnvelope`.
  3. `src/envelope.ts` `validateEnvelope`: accept the field; if present and
     `> 3`, produce a warning-level result (find how existing deprecation
     warnings are surfaced — grep `deprecated` in `src/envelope.ts` — and use
     the same channel).
  4. `src/identity/canonicalize.ts`: add `'spec_version'` to `SIGNABLE_FIELDS`.
     Read the set-filtering logic first (line ~27/50): confirm absent fields
     are simply not included in the canonical payload — meaning old envelopes
     without the field verify exactly as before. Write a test proving both:
     (a) an envelope WITHOUT `spec_version` signed pre-change verifies
     post-change (use a fixture from `src/fixtures/`), (b) an envelope WITH
     `spec_version` signs and verifies round-trip.
  5. `createEnvelope` does NOT set the field yet. Grep for any
     `additionalProperties`-style strictness in the hand-rolled validator and
     make sure the new key passes.
  6. CHANGELOG entry under a new anchor; note the two-phase plan.
- **Acceptance (4a):** both new signature tests green; full suite green;
  `examples/valid-envelope.json` still validates; an envelope JSON with
  `"spec_version": 3` added by hand also validates.

### B2 — ⚠️ SENIOR REVIEW — emit `spec_version` (Phase 4b)
- **Why:** This is the ONLY step in the spec_version rollout that puts new
  signed bytes on the wire — an un-updated verifier computes different
  canonical bytes and rejects every new envelope. B1 is safe by construction;
  the risk lives here. Do not start this task in the same release, branch, or
  week as B1.
- **Precondition probes (ALL must pass before you write any code — paste the
  outputs into the PR description):**
  1. For EACH of cortex, pilot, sage, grove, cedar, reflex: the myelin pin in
     `<consumer>/package.json` resolves to a commit ≥ the B1 release tag.
     Check: `git -C ~/work/mf/myelin merge-base --is-ancestor <B1-tag-sha> <pinned-sha> && echo OK` — six OK lines required.
  2. **signal:** establish whether signal verifies envelope signatures at all.
     Probe: `rg -l "ed25519|verifyEnvelope|signed_by" ~/work/mf/signal/src/`.
     - Empty ⇒ signal does no signature verification; record "signal:
       routing-only, not a verifier" in the PR description and proceed.
     - Non-empty ⇒ signal IS a verifier outside the pin-bump train. STOP.
       Signal must first adopt the myelin parser (decision memo H2) or add
       `spec_version` to its own field set. Do not proceed until one of those
       has merged.
  3. If ANY probe fails: STOP. Do the missing G1 bump (or the signal fix)
     first.
- **Steps:**
  1. `src/envelope.ts` `createEnvelope`: set `spec_version: 3` on every new
     envelope.
  2. Update fixtures/examples that assert exact envelope shape; the B1
     back-compat signature test (envelope WITHOUT the field) must remain and
     must still pass — old envelopes stay verifiable forever.
  3. CHANGELOG entry; release per RELEASING.md.
- **Acceptance:** full suite green; `createEnvelope({...})` output contains
  `"spec_version": 3` (assert in a test); B1's no-field back-compat signature
  test still green; the six precondition OK lines + the signal verdict are in
  the PR description.

---

## Phase 5 — Transition-window closure & consumer bumps

### C1 — close R2 window (`originator.principal` → `identity`)
- **Why:** Open dual-key windows are the review's "fixes-that-fail tail risk";
  runtime deprecation warnings already fire in tests.
- **Steps:** Follow the exact pattern of the shipped R13 cut (read the diff:
  `git log --oneline --all | grep -i "R13\|target_principal"` then
  `git show <sha>`). Mechanics: `src/dual-field.ts` header lists which fields
  still ride the window; remove `originator.principal` (and
  `payload.principal` if the header couples them) from the transition set;
  schema drops acceptance of the deprecated key; tests in
  `src/envelope-transition.test.ts` flip from accept-with-warning to reject.
  **Sequencing — emitters-before-verifiers:** this is a window CLOSURE, the
  REVERSE of B1's rule. Every producer must emit the canonical key before
  myelin starts rejecting the legacy one — flip the verifier first while a
  consumer still emits `originator.principal` and you drop that consumer's
  traffic. Concretely: confirm all six consumers are on pins ≥ the release
  where the `identity` key became canonical BEFORE merging (check each
  `<consumer>/package.json` myelin SHA date ≥ 2026-05-31). If any is older:
  do their pin-bump (G1) first. `depends: G1`.
  (Do NOT reuse B1's "verifiers-before-emitters" here — that slogan is for
  ADDING a signed field; closing a window is the opposite operation.)
- **Acceptance:** suite green; grep `originator.*principal` in `src/` returns
  only historical comments; CHANGELOG breaking entry written.

### C2 — close R11 window (`distribution_mode: broadcast` → `offer`), issue #180
- **Steps:** same pattern as C1; kill the `broadcastTaskSubject` deprecated
  alias in `src/subjects.ts` and the root re-export in `src/index.ts` in the
  same cut. Close #180 via PR description (`closes #180`). `depends: G1`.
- **Acceptance:** `grep -rn "broadcast" src/ --include="*.ts" | grep -v test`
  → only comments; suite green.

### G1 — consumer pin-bumps (one PR per consumer repo)
- **Order:** cedar → grove → sage (oldest first), then cortex → pilot →
  reflex after Phase 4a ships.
- **Per consumer:**
  1. Edit `package.json` myelin dep to the new tag/SHA; `bun install`.
  2. `bunx tsc --noEmit && bun test` — fix compile errors mechanically:
     `{org}` param names → `principal` (sage `src/config.ts`,
     `src/util/stack.ts`, `src/bus/dispatcher.ts:170 org: ev.principal`;
     pilot `src/cli.ts` — keep the `--org` CLI flag as an alias, rename at the
     module boundary as sage's comment already describes), `.principal` →
     `.identity` on signed_by shapes (grove
     `src/bot/lib/identity-verification.ts`), `target_principal` →
     `target_assistant` where present.
  3. **cortex extra step:** re-vendor the schema — copy
     `myelin/schemas/envelope.schema.json` over
     `cortex/src/bus/myelin/vendor/envelope.schema.json` and update
     `SCHEMA_SOURCE_COMMIT` in `src/bus/myelin/envelope-validator.ts`; the
     drift-guard test (`envelope-validator.test.ts`, "Sage R2 drift guard")
     enforces this and will tell you if you missed it.
  4. **sage extra step:** check whether myelin#150 landed
     (`gh issue view 150 -R the-metafactory/myelin`); if yes, remove the shim
     flagged `TODO: remove this \`kind\` once myelin#150 lands` in
     `src/tasks/emissions.ts:38`.
- **Acceptance per repo:** typecheck + tests green on the new pin; grep for
  `{org}` in src/ shows only the sanctioned CLI-alias boundary.

---

## Phase 6 — Ecosystem decisions (write-up only — humans decide)

### H1 — decision memo: registry publishing
Draft 1 page: npm public vs GitHub Packages vs status-quo tags. Include: six
consumers currently hand-edit 40-char SHAs; pilot's myelin version is
transitively coupled to cortex's; recommendation = GitHub Packages under
`@the-metafactory` + tagged fallback. Deliver as
`Plans/decision-registry.md`. STOP after writing — do not publish anything.

### H2 — decision memo: signal becomes a consumer
Signal shadow-parses subjects/envelopes with raw `nats` + zod — the review's
highest silent-drift risk. Memo: cost of adopting
`@the-metafactory/myelin/subjects` (pure, no NATS/Zod/Ajv deps — cheap) vs
status quo. Include the review's rule proposal: "consumers of the published
language MUST consume the reference parser." `Plans/decision-signal.md`.

### H3 — decision memo: grove-v2 dropped myelin
grove-v2's four package.json files have no myelin dep while grove-v1 is the
heaviest transport consumer. Either grove-v2 re-adopts (list the v1 usage it
must replace: `createTransport`, `EnvelopeTransport`, `createSignedEnvelope`,
identity verification) or the drop is ratified and documented. Surface, don't
decide. `Plans/decision-grove-v2.md`.

### H4 — decision memo: 1.0 signature/vocabulary strategy
The deep issue: field names are the signed bytes (JCS over literal keys), so
every rename is crypto-breaking forever. Memo the two options for 1.0:
(a) vocabulary freeze — renames become additive-only after 1.0;
(b) canonicalization over stable field IDs (protobuf-tag style; the msgpack
serialization layer in `src/serialization/` shows binary encoding is already
in-tree). Include blast-radius comparison. `Plans/decision-1.0-canonicalization.md`.

---

## Execution matrix

| Task | Repo | Risk | Senior review | Depends |
|---|---|---|---|---|
| D1–D8 | myelin | none (docs/CI) | no | D8→D1 |
| F1–F3 | myelin | none | no | — |
| E1 | myelin | low (additive) | no | — |
| E2 | myelin | low (probe-guarded) | no | — |
| E3 | myelin | low (additive) | no | — |
| E4 | myelin | medium | ⚠️ yes | — |
| B1 (4a) | myelin | high (signature) | ⚠️ yes | F3 (needs release) |
| B2 (4b) | myelin | highest (wire cut) | ⚠️ yes | B1 released + all G1 bumps + signal verdict |
| C1, C2 | myelin | breaking cut | ⚠️ yes | G1 |
| G1 | 6 consumer repos | medium | per-repo tests | F3 (tags); cortex/pilot/reflex additionally B1 (4a) released |
| H1–H4 | Plans/ | none | human decides | — |

Done = every acceptance line in this file passes (B2's precondition probes
included), every ⚠️ PR merged by a human, all six consumers green on a tagged
release, and the signal verifier-or-not verdict recorded.
