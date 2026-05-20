# Myelin — Vocabulary Migration Manifest (2026-05)

**Status:** draft for review · deterministic ground truth · **iteration 2** (re-grepped, two-review fixes applied)
**Source:** `CONTEXT.md` (myelin) + `CONTEXT-MAP.md` (compass/ecosystem) — grill-with-docs sessions, May 2026
**Method:** every entry below was produced by `grep -rn` against `main` (commit `2dc40df`, 2026-05-20). Each cited line is a real occurrence in the codebase at that commit; nothing is inferred. Where a line could not be pinned to an exact number, the entry says so and defers to a PR-time `grep` pass.

Read this as the script: each PR claims one rename or one file/cluster, performs every listed change, runs `bunx tsc --noEmit && bun test`, opens for review.

**The operator has decided the full vocabulary rename proceeds** — this is a root-cause fix across the ecosystem, not a one-line pilot patch. This manifest's job is to make that rename *correct, complete, and safe to execute*.

---

## Rename inventory (canonical)

| #   | Old | New | Tier | Scope | Source |
|-----|---|---|---|---|---|
| R1  | `Principal` (TS type/interface name) | `Identity` | 1 (but exported — see R1 note) | code | myelin-Q1 |
| R2  | `signed_by[].principal` / `originator.principal` / `advertisement.principal` (wire/object field) | `.identity` | 2 | code + schema + prose | myelin-Q1 |
| R3  | `PrincipalType` (TS type) | `IdentityType` | 1 (exported — see R1 note) | code | myelin-Q1 |
| R4  | `Identity.operator` (object field) **and** `AgentIdentity.operator` (object field) | `.network` | 2 | code + prose | myelin-Q2 |
| R5  | `Identity.type: "operator"` (string literal value) | `"hub"` | 2 | code + prose | myelin-Q2 |
| R6  | envelope `source` grammar `org.agent.instance` (3–5 segments) | `{principal}.{stack}.{assistant}` (fixed 3) | 3 (wire) | schema + validator + prose | myelin-Q3 |
| R7  | `{org}` (subject grammar token) + `org` (code parameter / variable name) | `{principal}` / `principal` | 3 (code) / 1 (comments+docs) | code + grammar + prose | cortex-Q3 (myelin owns grammar) |
| R8  | `"Reach"` column header | `"Scope"` | 1 | prose | cortex-Q10 |
| R9  | `@{principal}` (subject segment) | `@{assistant}` | 1 (comments+docs) | grammar + prose + code comments | cortex-Q5 |
| R10 | `"principal address"` prose | `"assistant address"` | 1 | prose | cortex-Q5 |
| R11 | `Broadcast` / `"broadcast"` (dispatch mode name **and** live wire enum value) | `Offer` / `"offer"` | **3 (wire enum)** | schema + code + tests + prose | cortex-Q13b |
| R12a | `operator` prose — mechanically resolvable (every line decided in this manifest) | `principal` or `network` | 1 | prose | cortex-Q2 + myelin-Q2 |
| R12b | `operator` prose — genuinely ambiguous (explicitly deferred, listed) | TBD by follow-up grill | — | prose | cortex-Q2 |
| R13 | `target_principal` (envelope wire field) | `target_assistant` | 2/3 (wire) | code + schema + tests + prose — 61 hits / 16 files | cortex-Q5 (consistency with R9) |

### Renames this manifest does NOT make

- **NSC operator account terminology** (`OP_ANDREAS`, `nsc`-CLI "operator", `${PARTNER_ACCOUNT_OPERATOR_B}`) — NATS infra terminology, *not* the cortex `operator`-the-human concept. Left unchanged. See R12b list for the precise lines.
- **Legacy `mf.net-{operator}.*` references** in `docs/migration-from-legacy-nats.md` — historical content describing the pre-myelin subject shape. Left unchanged; that doc is a record of what was migrated *from*. The lines describing the *target* shape are handled under R7/R12a (see that file's section).
- **`encodeDidSegment`** (`src/subjects.ts:83`) — a generic DID-segment encoder, not a principal-specific function. DIDs are not principal-specific; the function name stays. (The original manifest's `encodePrincipalForSubject` bullet was wrong — see R7/`src/bidding/subjects.ts`.)

### R1 note — Tier 1 is NOT purely internal

`Principal` and `PrincipalType` are **exported from the package** via `src/index.ts` (L106–107) and `src/identity/index.ts`. External importers (cortex, pilot, signal) `import type { Principal }` today. R1/R3 are therefore *not* free internal renames:

- The renaming PR **MUST** add a deprecated re-export alias in `src/index.ts` and `src/identity/index.ts`. Re-exported types do not introduce local bindings in TypeScript, so the alias declarations need an `import type` line first (a literal application of the pattern without the import fails with `Cannot find name 'Identity'`):

  In `src/identity/index.ts`:
  ```ts
  import type { Identity, IdentityType } from "./types";

  /** @deprecated Renamed to `Identity` (vocabulary migration 2026-05). Removed in the next major. */
  export type Principal = Identity;
  /** @deprecated Renamed to `IdentityType`. Removed in the next major. */
  export type PrincipalType = IdentityType;
  ```

  In `src/index.ts` (relative path adjusted):
  ```ts
  import type { Identity, IdentityType } from "./identity/types";

  /** @deprecated Renamed to `Identity` (vocabulary migration 2026-05). Removed in the next major. */
  export type Principal = Identity;
  /** @deprecated Renamed to `IdentityType`. Removed in the next major. */
  export type PrincipalType = IdentityType;
  ```
- The renaming PR **MUST** add a `CHANGELOG.md` entry under `### Changed` documenting the rename + the deprecation window.
- The alias is removed in the same major bump that lands the Tier-2/Tier-3 breaking changes (see Roll-out).

---

## Per-file changes

### `src/identity/types.ts`

The source-of-truth for the renamed interface + fields. **Land this file first** (or back-compat-aliased) — every other file depends on it. See "PR ordering" in Roll-out.

- **R1 + R3 + R4 + R5** — the interface definition:
  - L4 `export type PrincipalType = "agent" | "service" | "operator";` → `export type IdentityType = "agent" | "service" | "hub";`
  - L6 `export interface Principal {` → `export interface Identity {`
  - L9 `  operator: string;` → `  network: string;`
  - L11 `  type: PrincipalType;` → `  type: IdentityType;`
- **R2** — the **wire-shape** `signed_by[i].principal` fields. These are the `string`-typed DID fields on the two stamp variants. **(CORRECTED — the original manifest cited L75 & L86, which are wrong.)**
  - L47 `SignedByEd25519.principal: string;` → `identity: string;`
  - L56 `SignedByHubStamp.principal: string;` → `identity: string;`
- **R1 (resolved-object references — NOT R2)** — L75 and L86 hold `Principal`-typed *object* references on `StampVerdict` / `VerificationResult`. These are **type-name** renames (R1), not wire-field renames. The field key (`principal`) on these in-memory result objects also renames to `identity` for consistency with R2's verify-result accessors (see `src/identity/verify.ts`):
  - L75 `  principal?: Principal;` (on `StampVerdict`) → `  identity?: Identity;`
  - L86 `      principal: Principal;` (on `VerificationResult` `status:"verified"`) → `      identity: Identity;`
  - Comment L74 `/** Resolved principal when known … */` → `/** Resolved identity when known … */`
  - Comment L85 `/** Last stamp's resolved principal — convenience … */` → `… resolved identity …`
- **R12a** — interface JSDoc prose referencing "principal" generically:
  - L21–24 the `StampRole` doc block uses "principal" in the broad-entity sense ("what the principal IS", "The same principal may appear …", "the principal that minted the envelope body"). Under the new vocabulary these are **`identity`** (any DID entity, not specifically the human). Rewrite L21, L24, L28 prose `principal` → `identity`.

### `src/identity/registry.ts`

- **R1** (type identifier — 16 hits) — every `Principal` becomes `Identity`. The interface names `PrincipalRegistry` / `PrincipalRegistryFile` rename to `IdentityRegistry` / `IdentityRegistryFile`:
  - L4 `import type { Principal } from "./types";` → `import type { Identity } from "./types";`
  - L7 `export interface PrincipalRegistry {` → `export interface IdentityRegistry {`
  - L8 `  resolve(did: string): Principal | null;` → `Identity | null;`
  - L9 `  list(): Principal[];` → `Identity[];`
  - L10 `  trustedHubs(): Principal[];` → `Identity[];`
  - L11 `  add(principal: Principal): void;` → `add(identity: Identity): void;` (parameter name follows)
  - L14 `export interface PrincipalRegistryFile {` → `export interface IdentityRegistryFile {`
  - L16 `  principals: Principal[];` → `  identities: Identity[];` (registry-file field — see registry note below)
  - L20 `class BaseRegistry implements PrincipalRegistry {` → `implements IdentityRegistry {`
  - L21 `  protected store: Map<string, Principal>;` → `Map<string, Identity>;`
  - L24 `  constructor(principals: Principal[] = [], trustedHubDids: string[] = []) {` → `constructor(identities: Identity[] = [], …) {`
  - L29 `  resolve(did: string): Principal | null {` → `Identity | null {`
  - L33 `  list(): Principal[] {` → `Identity[] {`
  - L37 `  trustedHubs(): Principal[] {` → `Identity[] {`
  - L43 `  add(principal: Principal): void {` → `add(identity: Identity): void {`
  - L49 `  override add(_principal: Principal): never {` → `override add(_identity: Identity): never {`
  - L54 `export function createInMemoryRegistry(): PrincipalRegistry {` → `IdentityRegistry {`
  - L68 `function validatePrincipal(p: unknown, index: number): void {` → `validateIdentity(…)`
  - L102 `function validateRegistryFile(…): asserts data is PrincipalRegistryFile` → `IdentityRegistryFile`
  - L109 `(data as PrincipalRegistryFile).version !== 1` → `(data as IdentityRegistryFile)`
- **R4** — the operator-field validator:
  - L79 `  if (typeof pr.operator !== "string" || pr.operator.length === 0) {` → `pr.network !== "string" || pr.network.length === 0)`
  - L80 `    throw new Error(\`principals[${index}].operator: required non-empty string\`);` → `\`identities[${index}].network: required non-empty string\``
- **R5** — the type-value validator:
  - L65 `const VALID_TYPES = new Set<string>(["agent", "service", "operator"]);` → `new Set<string>(["agent", "service", "hub"]);`
  - L83 `throw new Error(\`principals[${index}].type: must be "agent", "service", or "operator", got "${String(pr.type)}"\`);` → `\`identities[${index}].type: must be "agent", "service", or "hub", got "${…}"\``

**Registry-file note (R1/R2):** `PrincipalRegistryFile.principals` is a **persisted config shape** (`PrincipalRegistryFile.version: 1` files on disk). Renaming the JSON key `principals` → `identities` is a **config-file-format change**, not just a type rename — `loadRegistry` reads this off disk. The renaming PR MUST: (a) accept BOTH `principals` and `identities` keys on read for one minor cycle, (b) emit only `identities` on write, (c) bump `version` to `2` and keep `version: 1` readable. Treat this exactly like the Tier-2 envelope-schema change.

### `src/identity/index.ts`

- **R1 + R3** — re-exports:
  - L4 `  Principal,` → `  Identity,`
  - L5 `  PrincipalType,` → `  IdentityType,`
  - **Add** the deprecated aliases (see R1 note): `export type Principal = Identity;` + `export type PrincipalType = IdentityType;` with `@deprecated` JSDoc.

### `src/index.ts`

- **R1 + R3** — top-level package re-exports:
  - L106 `  Principal,` → `  Identity,`
  - L107 `  PrincipalType,` → `  IdentityType,`
  - **Add** the deprecated `Principal` / `PrincipalType` aliases here too (this is the package entrypoint external consumers import from).
  - **R11** — L25 `  broadcastTaskSubject,` (re-export of the renamed function) → `offerTaskSubject,` (see `src/subjects.ts`). Keep a deprecated `export { offerTaskSubject as broadcastTaskSubject }` alias for one minor.

### `src/identity/verify.ts`

- **R1** — type uses:
  - L4 `  Principal,` (import) → `  Identity,`
  - L152, L202 `  principal: Principal,` (parameters) → `  identity: Identity,`
  - L284 `): Promise<Principal> {` → `Promise<Identity> {`
- **R3** — `PrincipalType` uses:
  - L5 `  PrincipalType,` (import) → `  IdentityType,`
  - L266 `  mustIncludePrincipalType?: PrincipalType;` → `mustIncludeIdentityType?: IdentityType;` — **NB: the option *key* renames; this is a public API change to `requireVerifiedIdentity`'s options. See verify-options note.**
  - L305 `  if (options?.mustIncludePrincipalType !== undefined) {` → `options?.mustIncludeIdentityType`
  - L306 `    const type = options.mustIncludePrincipalType;` → `options.mustIncludeIdentityType`
- **R2** — `.principal` field accesses on verdict + stamps:
  - L77 `reason: \`stamp[${i}] (${stamp.principal}): …\`` → `${stamp.identity}`
  - L92 `    principal: last.principal!,` (result-builder) → `identity: last.identity!,`
  - L107 `  const principalDid = stamp.principal;` → `const identityDid = stamp.identity;` (variable follows)
  - L307 `if (!chain.some((v) => v.principal?.type === type))` → `v.identity?.type === type`
  - L315 `if (!chain.some((v) => v.principal?.id === did))` → `v.identity?.id === did`
  - L321 `  return result.principal;` → `return result.identity;`

**verify-options note (R3):** `mustIncludePrincipalType` / `mustIncludePrincipal` are public option keys on `requireVerifiedIdentity`. cortex's identity-gate code passes these. The renaming PR MUST accept both old and new key names for one minor cycle (read both, prefer new), and the `CHANGELOG.md` entry MUST list the option rename. The `mustIncludePrincipal` key (chain-must-include-DID predicate) renames to `mustIncludeIdentity`.

### `src/identity/chain.ts`

- **R2** — L70 `  return chain.at(-1)?.principal;` → `chain.at(-1)?.identity;`

### `src/envelope.ts`

- **R2** — `signed_by[]` stamp validator + `originator` validator + accessors:
  - L342 `if (typeof sb.principal !== 'string' || !DID_RE.test(sb.principal))` → `sb.identity`
  - L343 `errors.push({ field: \`${path}.principal\`, message: '…' });` → `\`${path}.identity\`` — **error-string change; see error-string lockstep note.**
  - L459 `if (typeof value.principal !== 'string' || !DID_RE.test(value.principal))` (originator validator) → `value.identity`
  - L460 `errors.push({ field: 'originator.principal', message: '…' });` → `'originator.identity'`
  - L479 doc comment `Returns \`envelope.originator.principal\` when set…` → `.identity`
  - L488 `if (envelope.originator?.principal) return envelope.originator.principal;` → `.identity`
  - L490 `return chain[0]?.principal;` → `chain[0]?.identity`
- **R6** — `source` grammar (the regex + the error message):
  - L37 `const SOURCE_RE = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){2,4}$/;` → tighten to **fixed 3 segments**: `const SOURCE_RE = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){2}$/;` (the `{2,4}` → `{2}` is the load-bearing change — 3 fixed segments `{principal}.{stack}.{assistant}`).
  - L100 `errors.push({ field: 'source', message: 'must match org.agent.instance pattern (3-5 segments, lowercase)' });` → `'must match {principal}.{stack}.{assistant} pattern (3 fixed segments, lowercase)'`
- **R11** — `distribution_mode` enum:
  - L47 `const DISTRIBUTION_MODES = new Set(['broadcast', 'direct', 'delegate']);` → during the transition: `new Set(['broadcast', 'offer', 'direct', 'delegate']);` (accept both on read); after the major: `new Set(['offer', 'direct', 'delegate']);`. See the `distribution_mode` enum migration plan below.
  - L194 `errors.push({ field: 'distribution_mode', message: 'must be broadcast, direct, or delegate' });` → transition: `'must be offer, direct, or delegate (broadcast accepted, deprecated)'`; post-major: `'must be offer, direct, or delegate'`.
- **R13** — `target_principal` → `target_assistant`:
  - L66 `...(input.target_principal ? { target_principal: input.target_principal } : {}),` → `target_assistant`
  - L197 `if (e.target_principal !== undefined && (typeof e.target_principal !== 'string' …` → `e.target_assistant`
  - L198 `errors.push({ field: 'target_principal', message: 'must be a DID string …' });` → `'target_assistant'`
  - L209 comment `// Cross-field rule: direct/delegate require target_principal` → `target_assistant`
  - L210 `… && !e.target_principal) {` → `!e.target_assistant`
  - L211 `errors.push({ field: 'target_principal', message: 'required when distribution_mode …' });` → `'target_assistant'`
  - L216 the signable-fields / canonical-fields list literal `… 'distribution_mode', 'target_principal', …` → `'target_assistant'`
- **R7** — `{org}` comments:
  - L518 ` * segment between \`{org}\` and \`{type}\` …` → `{principal}`
  - L520 ` * default-derive that to \`{org}.default.>\` …` → `{principal}.default.>`

### `src/types.ts`

- **R11** — L13 `export type DistributionMode = 'broadcast' | 'direct' | 'delegate';` → transition: `'broadcast' | 'offer' | 'direct' | 'delegate'`; post-major: `'offer' | 'direct' | 'delegate'`.
- **R11** — L126 comment `// F-021 task routing fields (all optional; absent = broadcast / no filter)` → `absent = offer / no filter`.
- **R13** — `target_principal` field on the two envelope interfaces:
  - L131 `MyelinEnvelope.target_principal?: string;` → `target_assistant?: string;`
  - L152 `CreateEnvelopeInput.target_principal?: string;` → `target_assistant?: string;`
- **R2** — `Originator.principal` field:
  - L48 `  /** DID of the actor … */ principal: string;` → `identity: string;`
- **R12a** — `Originator` / `AttributionMode` JSDoc prose (these say "operator" meaning the org-that-runs-a-hub → **`network`**):
  - L25 `… relayed from another operator. The chain-of-stamps proves the cross-operator hop; \`originator.principal\` names the upstream actor.` → `relayed from another network … the cross-network hop; \`originator.identity\` names …`
  - L26 `… a service principal acting on behalf of an operator` → `acting on behalf of a network` (the *human* sense is `principal`; here it is the org → `network`).
  - L24 `… mapped a non-Myelin identifier to a Myelin principal` — here "principal" means the human → **keep `principal`** (R12a decision: this line is correct under the new vocabulary).

### `src/dispatch/types.ts`

- **R13** — L43 `  target_principal?: string;` (on `ReceivedPayload`) → `target_assistant?: string;`
- **R2 (dispatch-payload `principal` field — wire payload, Tier 2)** — six lifecycle payload interfaces declare `principal` as an identity-DID field on `DispatchLifecycleEnvelope.payload`. The lifecycle envelopes are **JetStream-backed wire payloads** (EVENTS stream — see the file header comment), so this is a Tier-2 change requiring a back-compat read window. Rename each `principal` field → `identity`:
  - L48 `AssignedPayload.principal: string;` → `identity: string;`
  - L53 `StartedPayload.principal: string;` → `identity: string;`
  - L57 `ProgressPayload.principal: string;` → `identity: string;`
  - L71 `CompletedPayload.principal: string;` → `identity: string;`
  - L82 `FailedPayload.principal?: string;` → `identity?: string;`
  - L91 `AbortedPayload.principal?: string;` → `identity?: string;`
  - **Tier 2 / back-compat read:** the transition release reads BOTH `principal` and `identity` off `payload` (prefer `identity`), emits only `identity` on write; the breaking major drops `principal`. cortex's dispatch-listener consumes this payload — companion PR required (this is the same Tier-2 discipline as the `signed_by[].identity` rename).
- **R7** — L10 comment `//     local.{org}.dispatch.task.{state}` → `local.{principal}.…`

### `src/dispatch/lifecycle.ts`

- **R7** (comments + code):
  - L24 ` *     local.{org}.dispatch.task.{state}` → `local.{principal}.…`
  - L27 ` *     local.{org}.{stack}.dispatch.task.{state}` → `local.{principal}.{stack}.…`
  - L44 template literal `return \`local.${org}.${stackInfix(stack)}dispatch.task.${state}\`;` — **code R7** (parameter `org` → `principal`)
  - L56 template literal — **code R7**
- **R11** — L94 comment table `*   | state      | Broadcast | Direct | Delegate |` → `| Offer | Direct | Delegate |`

### `src/dispatch/lifecycle.test.ts`

- **R7** — L192 test-name comment `it("received() emits to local.{org}.dispatch.task.received …` → `local.{principal}.…`
- **R11** — `"broadcast"` string fixtures (live enum value):
  - L156 `it("delegate-only states throw for broadcast/direct", …)` → `offer/direct`
  - L157, L159 `validateEmissionRules("started"/"aborted", "broadcast")` → `"offer"`
  - L169 `for (const mode of ["broadcast", "direct", "delegate"] as const)` → `["offer", "direct", "delegate"]`
  - L198, L251, L271, L295, L323, L324 `distribution_mode: "broadcast"` → `"offer"`
  - L247 `it("blocks delegate-only states for broadcast", …)` → `for offer`
- **R13** — L215, L343 `target_principal: "did:mf:pilot"` → `target_assistant: "did:mf:pilot"`
- **R2 (dispatch-payload `principal` key — Tier 2)** — the lifecycle-payload fixtures pass a `principal:` key (the renamed `AssignedPayload`/`StartedPayload`/… field). Rename every payload `principal:` key → `identity:`: L219, L222, L226, L231, L251, L261, L324, L344, L345, L346, L347, L348 (`principal: "did:mf:pilot"` / `principal: "did:mf:luna"` → `identity: …`). The DID *values* (`did:mf:pilot`, `did:mf:luna`) are fixture strings — leave the values, rename only the key. (Do **not** touch L215/L343 `target_principal` — that is the separate R13 rename above.)

### `src/dispatch/stream.ts`

- **R7** (comments + code):
  - L15 ` *   subjects:   local.{org}.dispatch.task.>` → `local.{principal}.…`
  - L21 ` * Stream name is org-scoped (\`EVENTS_{org}\` upper-cased). …` → `principal-scoped (\`EVENTS_{principal}\` …)` — **NB: this is a JetStream STREAM NAME shape. See JetStream replay note.**
  - L36 `subjects: [\`local.${org}.dispatch.task.>\`]` — **code R7** (param rename)

### `src/subjects.ts`

The **wire-grammar core** — heaviest comment + code rename for R7 (`{org}` token + `org` parameter) and R11 (`broadcastTaskSubject`).

- **R7** — `org` parameter / variable, every exported subject-builder:
  - Each function takes `(classification, org, type, stack)` or a variant — rename the `org` parameter to `principal` throughout. Affects every call site in the repo and every downstream consumer (see "Tier 3" + the consumer table).
  - L171 `return \`local.${org}.${stackInfix(stack)}tasks.${capability}.>\`;` → `local.${principal}.…`
  - L199 `return \`local.${org}.${stackInfix(stack)}tasks.${encodeDidSegment(did)}.>\`;` → `local.${principal}.…` (note: `encodeDidSegment` is NOT renamed — see "Renames this manifest does NOT make")
  - L257 `return \`local.${org}.${stackInfix(stack)}tasks.${capability}\`;` → `local.${principal}.…`
  - L295 `return \`local.${org}.${stackInfix(stack)}code.pr.${kind}.${status}\`;` → `local.${principal}.…`
  - L395 `return \`local.${org}.${stackInfix(stack)}code.pr.${kind}.>\`;` → `local.${principal}.…`
  - L426 `return \`${classification}.${org}.${type}\`;` → `${classification}.${principal}.${type}`
  - L435 `return \`${classification}.${org}.${stack}.${type}\`;` → `${classification}.${principal}.${stack}.${type}`
- **R7** — `{org}` in doc-comments: a PR-time `grep -n '{org}' src/subjects.ts` enumerates every hit; each `{org}` token → `{principal}`. (Original manifest listed approximate line numbers — do not trust them; grep at PR time. Known clusters around L63, L177, L205, L226, L266, L301, L409–412, L501–502, L588, L606, L636.)
- **R11** — the `broadcastTaskSubject` function and its doc:
  - L122 comment `* Subscribe-side wildcard for tasks broadcast to a capability fan-out.` → `tasks offered to a capability fan-out`
  - L155, L159 `@example broadcastTaskSubject('metafactory', 'code-review')` → `offerTaskSubject(…)`
  - L164 `export function broadcastTaskSubject(` → `export function offerTaskSubject(`
  - L208, L210, L212, L214, L227, L241–242, L246 — every prose mention of "broadcast" / `broadcastTaskSubject` in the doc-comments → `offer` / `offerTaskSubject`
  - L620 `@example deriveLegacySubjectPattern('public.broadcast.>')` — this `public.broadcast.*` is a **legacy subject example**, NOT the dispatch mode. **Leave** (R12b-adjacent — historical example).
  - **Add** a deprecated re-export alias `export { offerTaskSubject as broadcastTaskSubject }` for one minor cycle (the function is exported from `src/index.ts`).
- **R9 + R10** — comments referencing principal-addressed segments → `@{assistant}` / "assistant address" (PR-time grep; known hits around L63–64, L177).

### `src/subjects.test.ts`

- **R7** — `{org}` in comments (PR-time grep; known hits L255, L294, L415, L787) → `local.{principal}.…`
- **R9** — L172 comment `§"Principal encoding"` → `§"Assistant encoding"`
- **R11** — `broadcastTaskSubject` import + all call sites + describe blocks:
  - L9 import `  broadcastTaskSubject,` → `offerTaskSubject,` (or import via the deprecated alias during transition)
  - L241 `describe('broadcastTaskSubject', …)` → `describe('offerTaskSubject', …)`
  - L243, L246, L256, L259, L265, L268, L271, L274, L297, L310, L368, L419, L430, L440, L444, L554, L555 — every `broadcastTaskSubject(…)` call → `offerTaskSubject(…)`
  - L289 `describe('broadcastTaskSubject ↔ taskSubject pairing', …)` → `offerTaskSubject ↔ taskSubject`
  - L412 `describe('broadcastTaskSubject ↔ taskSubject stack-aware pairing (myelin#152)', …)` → `offerTaskSubject ↔ taskSubject`
  - L657 `expect(typeof mod.broadcastTaskSubject).toBe('function');` → `mod.offerTaskSubject` (or, if keeping the deprecated alias, assert BOTH)
  - L280–310, L366, L382–387 — "broadcast"/"Broadcast" in prose comments → "offer"/"Offer"
  - L286 comment `… Direct/Broadcast section …` → `Direct/Offer section`
  - L808 `deriveLegacySubjectPattern('public.broadcast.>')` — **legacy subject example, leave** (matches `src/subjects.ts:620`).

### `src/agent-identity/types.ts`

- **R1**:
  - L2 `import type { Principal } from "../identity/types";` → `Identity`
  - L14 doc ` *   - Principal via toPrincipal() — public-only fragment for registry` → `Identity via toIdentity()` (the helper renames — see `helpers.ts`)
  - L79 `export type { SigningIdentity, Principal };` → `SigningIdentity, Identity`
- **R4** — `AgentIdentity.operator` field **(MISSING in the original manifest — added)**:
  - L30 comment `/** Operator/org owning this identity. */` → `/** Network owning this identity. */`
  - L31 `  operator?: string;` → `  network?: string;`

### `src/agent-identity/generate.ts`

**(MISSING in the original manifest — added.)** `GenerateAgentIdentityInput` has a parallel `operator` field.

- **R4**:
  - L18 comment `/** Owning operator, e.g., "metafactory". */` → `/** Owning network, e.g., "metafactory". */`
  - L19 `  operator?: string;` → `  network?: string;`
  - L55 `...(input.operator ? { operator: input.operator } : {}),` → `...(input.network ? { network: input.network } : {}),`

### `src/agent-identity/helpers.ts`

- **R1**:
  - L2 `import type { Principal, SigningIdentity } from "../identity/types";` → `Identity, SigningIdentity`
  - L19 doc ` * The Principal grammar requires \`is_hub\`. …` → `The Identity grammar requires …`
  - L23 `export function toPrincipal(identity: AgentIdentity, options: { is_hub?: boolean } = {}): Principal {` → `export function toIdentity(identity: AgentIdentity, options …): Identity {` — **function rename, affects callers (`toPrincipal` is re-exported behavior). Add a deprecated `export { toIdentity as toPrincipal }` for one minor.**
- **R4** — L29 maps `AgentIdentity.operator` → `Identity.network`:
  - L29 `operator: identity.operator ?? identity.did.split(":")[2] ?? "unknown",` → `network: identity.network ?? identity.did.split(":")[2] ?? "unknown",`

### `src/agent-identity/agent-identity.test.ts`

**(operator hits MISSING in the original manifest — added.)**

- **R1** — L423 `it("returns a public-only Principal — never includes private key", …)` → `"returns a public-only Identity …"` ; describe block `describe("toPrincipal", …)` → `describe("toIdentity", …)` ; every `toPrincipal(…)` call → `toIdentity(…)`.
- **R4** — `operator` field in fixtures + assertions:
  - L59 `it("preserves operator + display_name when provided", …)` → `"preserves network + display_name …"`
  - L63 `operator: "metafactory",` (in `generateAgentIdentity` input) → `network: "metafactory"`
  - L66 `expect(id.operator).toBe("metafactory");` → `id.network`
  - L424 `…generateAgentIdentity({ …, operator: "metafactory" });` → `network: "metafactory"`
  - L429 `expect(p.operator).toBe("metafactory");` → `p.network`
  - L434 `it("infers operator from DID when not on identity", …)` → `"infers network from DID …"`
  - L437 `expect(p.operator).toBe("luna");` → `p.network`
  - L453 `operator: "metafactory",` (in `registerSelf` test input) → `network: "metafactory"`

### `src/identity/chain.test.ts`

- **R1**:
  - L15 `import type { Principal } from "./types";` → `Identity`
  - L37 `function makePrincipal(…overrides: Partial<Principal> = {}): Principal {` → `makeIdentity(… Partial<Identity> = {}): Identity {` — rename the helper, all call sites follow.
- **R2** — `signed_by[i].principal` assertions / fields:
  - L85 `expect(normalized.signed_by![0].principal).toBe("did:mf:echo");` → `.identity`
  - L148 `expect(result.errors.some((e) => e.field === "signed_by[1].principal")).toBe(true);` → `"signed_by[1].identity"` — **literal validator-error-string assertion; see error-string lockstep note.**
  - L192 `expect(signed.signed_by![0].principal).toBe("did:mf:echo");` → `.identity`
  - L204 `expect(second.signed_by![1].principal).toBe("did:mf:luna");` → `.identity`
  - L238 `expect(result.chain[0].principal!.id).toBe("did:mf:echo");` → `.identity!.id`
  - L239 `expect(result.chain[1].principal!.id).toBe("did:mf:luna");` → `.identity!.id`
  - L241 `expect(result.principal.id).toBe("did:mf:luna");` → `result.identity.id`
  - L510 `expect(chain[0].principal).toBe("did:mf:echo");` → `chain[0].identity`
- **R5** — `type: "operator"` fixtures + `mustIncludePrincipalType`:
  - L342 `makePrincipal("did:mf:hub.metafactory", k2.publicKey, { type: "operator", is_hub: true })` → `makeIdentity(…, { type: "hub", is_hub: true })`
  - L373 `it("accepts mustIncludePrincipalType when present", …)` → `mustIncludeIdentityType`
  - L376 `requireVerifiedIdentity(envelope, registry, { mustIncludePrincipalType: "operator" })` → `{ mustIncludeIdentityType: "hub" }`
  - L380 `it("rejects mustIncludePrincipalType when absent", …)` → `mustIncludeIdentityType`
  - L383 `requireVerifiedIdentity(envelope, registry, { mustIncludePrincipalType: "service" })` → `mustIncludeIdentityType`

### `src/identity/registry.test.ts`

- **R1**:
  - L4 `import type { Principal } from "./types";` → `Identity`
  - L9 `function makePrincipal(overrides: Partial<Principal> = {}): Principal {` → `makeIdentity(… Partial<Identity> = {}): Identity {`
- **R5**:
  - L47 `const hub = makePrincipal({ id: "did:mf:hub.metafactory", type: "operator", is_hub: true });` → `makeIdentity({ …, type: "hub", … })`
  - L88 `const hub = makePrincipal({ id: "did:mf:hub", type: "operator", is_hub: true });` → `makeIdentity({ …, type: "hub", … })`

### `src/identity/verify.test.ts`

- **R1**:
  - L9 `import type { Principal } from "./types";` → `Identity`
  - L31 `function makePrincipal(publicKey: string, overrides: Partial<Principal> = {}): Principal {` → `makeIdentity(… Partial<Identity> = {}): Identity {`
- **R2** — L54 `expect(result.principal.id).toBe("did:mf:echo");` → `result.identity.id`
- **R5** — L149 `type: "operator",` → `type: "hub",`

### `src/identity/types.test.ts`

- **R1**:
  - L4 block import `  Principal,` → `  Identity,`
  - L10 `it("Principal type accepts valid agent", …)` → `it("Identity type accepts valid agent", …)`
  - L11 `const p: Principal = {` → `const p: Identity = {`
  - L23 `it("Principal accepts hub flag", …)` → `it("Identity accepts hub flag", …)`
  - L24 `const p: Principal = {` → `const p: Identity = {`
- **R5** — L28 `type: "operator",` → `type: "hub",`
- **R10** — L103 comment `// The wire-format encoding for principal-addressed task subjects collapses` → `assistant-addressed`

### `src/identity/integration.test.ts`

- **R2**:
  - L55 `expect(verifyResult.principal.id).toBe("did:mf:echo");` → `verifyResult.identity.id`
  - L105 `expect(echoResult.principal.id).toBe("did:mf:echo");` → `echoResult.identity.id`
  - L113 `expect(lunaResult.principal.id).toBe("did:mf:luna");` → `lunaResult.identity.id`

### `src/identity/sign.test.ts`

- **R2**:
  - L44 `expect(signed.signed_by![0].principal).toBe("did:mf:echo");` → `.identity`
  - L78 `expect(second.signed_by![1].principal).toBe("did:mf:echo");` → `.identity`

### `src/identity/canonicalize.ts`

- **R13** — the canonical (signable) field list:
  - L30 `"target_principal",` → `"target_assistant",`
- **R6** — L19 `"source",` is the field key in the signable list. The key name does not change (the *field* is still `source`); only its *grammar* tightens (R6, in `envelope.ts` + schema). **No change to this line** — noted to prevent a wrong edit.

### `src/identity/canonicalize.test.ts`

- **R13**:
  - L163 `it("includes sovereignty_required, deadline, distribution_mode, target_principal", …)` → `target_assistant`
  - L169 `target_principal: "did:mf:forge",` → `target_assistant: "did:mf:forge"`
  - L175 `expect(decoded).toContain('"target_principal":"did:mf:forge"');` → `'"target_assistant":"did:mf:forge"'`
  - L184 `expect(decoded).not.toContain('"target_principal"');` → `'"target_assistant"'`

### `src/envelope.test.ts`

- **R2**:
  - L621 `expect(result.errors.some(e => e.field === 'signed_by.principal')).toBe(true);` → `'signed_by.identity'` — **error-string lockstep.**
  - L678 `expect(env.signed_by![0].principal).toBe('did:mf:test-bot');` → `.identity`
  - L718 `expect(result.principal.id).toBe('did:mf:test-bot');` → `result.identity.id`
  - L999, L1008 `expect(r.errors.some(e => e.field === 'originator.principal')).toBe(true);` → `'originator.identity'`
  - L1051 `it('returns originator.principal when set', …)` → `'returns originator.identity when set'`
  - L1069 `it('prefers originator.principal over signed_by[0] when both present', …)` → `originator.identity over signed_by[0].identity`
  - L969 `originator: { principal: 'did:mf:operator', attribution: 'adapter-resolved' }` → `{ identity: 'did:mf:operator', … }` (the DID *value* `did:mf:operator` is a fixture string — leave the value; rename only the key)
  - L991 `validateEnvelope({ …baseEnv, originator: 'did:mf:operator' })` (negative test — bare string) → leave; the DID value is fixture-only.
- **R6** — L75 `it('rejects invalid source pattern', …)` — this test asserts `SOURCE_RE` rejects a bad pattern. After R6 tightens `SOURCE_RE` to fixed-3, this test MUST gain a case asserting a **4- or 5-segment** source is now *rejected* (it was accepted before). Add the new assertion in the R6 PR.
- **R11** — `distribution_mode` enum tests:
  - L845 `it('accepts broadcast, direct, delegate', …)` → during transition keep `broadcast` accepted and add `offer`; post-major rename to `'accepts offer, direct, delegate'`.
  - L846 `validateEnvelope({ …baseEnv, distribution_mode: 'broadcast' })` → transition: keep + add an `'offer'` case; post-major: `'offer'`.
  - L852 `const env = { …baseEnv, distribution_mode: 'multicast' as 'broadcast' };` (negative test) → `as 'offer'`
  - L899 `it('accepts broadcast without target_principal', …)` → `'accepts offer without target_assistant'` (R11 + R13)
  - L900 `validateEnvelope({ …baseEnv, distribution_mode: 'broadcast' })` → `'offer'`
  - L903 `it('accepts broadcast with target_principal (ignored at routing layer)', …)` → `'accepts offer with target_assistant …'`
  - L904 `validateEnvelope({ …baseEnv, distribution_mode: 'broadcast', target_principal: 'did:mf:forge' })` → `distribution_mode: 'offer', target_assistant: 'did:mf:forge'`
- **R13** — `target_principal`:
  - L847, L848, L875, L876, L880, L881, L908, L912, L939, L944 — every `target_principal` in a fixture, assertion, or test value → `target_assistant`
  - L871 `describe('validateEnvelope — target_principal', …)` → `target_assistant`
  - L888 `it('rejects direct without target_principal', …)` → `target_assistant`
  - L891 `expect(r.errors.some(e => e.field === 'target_principal' && …))` → `'target_assistant'`
  - L894 `it('rejects delegate without target_principal', …)` → `target_assistant`
  - L952 `expect(env.target_principal).toBeUndefined();` → `env.target_assistant`

### `src/fixtures/task-envelopes.ts`

- **R11** — `broadcastTaskEnvelope`:
  - L11 `export const broadcastTaskEnvelope: MyelinEnvelope = {` → `export const offerTaskEnvelope` (exported fixture — keep a deprecated `export { offerTaskEnvelope as broadcastTaskEnvelope }` alias for one minor)
  - L20 `distribution_mode: "broadcast",` → `"offer"`
- **R13** — L37 `target_principal: "did:mf:forge",` , L54 `target_principal: "did:mf:pilot",` → `target_assistant`

### `src/fixtures/task-envelopes.test.ts`

- **R11** — L3 import `{ broadcastTaskEnvelope, … }` → `{ offerTaskEnvelope, … }` ; L6 `it("broadcastTaskEnvelope passes validation", …)` → `offerTaskEnvelope` ; L7 `validateEnvelope(broadcastTaskEnvelope)` → `offerTaskEnvelope`.

### `src/sovereignty/schema.ts`

**(MISSING in the original manifest — added. DECISION below.)**

`src/sovereignty/schema.ts` defines two public schema fields — `ScopeMapping.partner_org` (L69–70) and `SovereigntyPolicy.org` (L106–107). It also redefines `ORG_RE` locally (L6).

**DECISION (partner_org / policy.org):** **Rename to `partner_network` and `policy.network`.** Rationale: `CONTEXT.md` is unambiguous — "operator → network / hub … `operator` is killed in all three contexts" and "Network: a federation of principals … `metafactory` is one … _Avoid_: operator, org". `partner_org` / `policy.org` name *the network on the other side of a federation handshake* — that is exactly the `network` concept. This is **not** NSC-infra terminology (the NSC `--src-account`/`OP_*` carve-out is separate — see R12b). These are myelin's own public sovereignty-policy schema fields, so they fall inside the rename. Tier 2 (schema change — `SovereigntyPolicy` files on disk carry `org`). The renaming PR accepts both `org`/`network` and `partner_org`/`partner_network` on read for one minor cycle, emits only the new names on write.

- **R4 (extended — sovereignty schema)**:
  - L6 `const ORG_RE = …` → see `src/patterns.ts` section (this local copy is consolidated; import `PRINCIPAL_RE` from `../patterns`).
  - L69 `if (typeof mapping.partner_org !== "string" || !ORG_RE.test(mapping.partner_org))` → `mapping.partner_network … !PRINCIPAL_RE.test(mapping.partner_network)`
  - L70 `errors.push({ field: \`${path}.partner_org\`, message: "…" });` → `\`${path}.partner_network\``
  - L106 `if (typeof policy.org !== "string" || !ORG_RE.test(policy.org))` → `policy.network … !PRINCIPAL_RE.test(policy.network)`
  - L107 `errors.push({ field: "org", message: "…" });` → `field: "network"`

### `src/sovereignty/types.ts`

- **R4 (sovereignty schema)**:
  - L25 `  partner_org: string;` (on `ScopeMapping`) → `  partner_network: string;`
  - L33 `  org: string;` (on `SovereigntyPolicy`) → `  network: string;`

### `src/sovereignty/nsc.ts`

- **R4 (sovereignty schema)** — code reading `policy.org` / `mapping.partner_org`:
  - L103 `out.push(\`# myelin sovereignty exports for org: ${policy.org}\`);` → `for network: ${policy.network}`
  - L144 `const partnerAcct = partnerAccountPlaceholder(mapping.partner_org);` → `mapping.partner_network`
  - L147 `out.push(\`# myelin sovereignty imports from partner: ${mapping.partner_org}\`);` → `mapping.partner_network`
  - L163 `const name = importName(mapping.partner_org, subject);` → `mapping.partner_network`
- **R12b (NSC carve-out)** — L9 comment "idempotent on the operator side", L137 "comment for the operator", L361 "when the operator runs the script" — these refer to the **human running `nsc`**, i.e. the deployment operator at the NSC CLI. **Deferred to R12b** (NSC-adjacent operational prose). A follow-up grill decides whether "operator" here means the principal (the human) or stays as NSC-CLI role language. Listed, not silently dropped.

### `src/sovereignty/validators/ingress.ts`

- **R2** — L60 `reason: "envelope is unsigned (no signed_by.principal)",` → `"… (no signed_by.identity)"`

### `src/sovereignty/validators/chain.ts`

- **R2** — L65 `const principal = chain[i].principal;` → `const identity = chain[i].identity;` (the local variable and its uses in the function body — PR-time grep the function body, every `principal` use that follows this binding → `identity`).

### `src/sovereignty/engine.ts`

- **R12a** — L115 comment `// First-fail-wins so the operator sees the earliest invalid` → `so the principal sees the earliest invalid` (the human reading the validation error → `principal`).

### `src/sovereignty/engine.test.ts`

- **R2**:
  - L130 `expect(e.principal).toBeUndefined();` → `e.identity`
  - L165 `expect(e.principal).toBe("did:mf:echo");` → `e.identity`
  - L185 `expect(e.principal).toBe("did:mf:rogue");` → `e.identity`
- **R4 (sovereignty schema)** — L26 `partner_org: "operator-b",` → `partner_network: "operator-b"` (the *value* `operator-b` is a fixture slug — handled separately under "Fixture-slug rename" below).
- **R6** — L244 `source: "operator-b.echo.federated",` is a `source`-field fixture. After R6 (`{principal}.{stack}.{assistant}`, fixed 3), this 3-segment value still parses; rename for vocabulary clarity to `"principal-b.stack-b.echo"` only if the fixture-slug pass (below) renames `operator-b` → `principal-b`. Otherwise leave structurally valid.
- Fixture-subject strings `federated.operator-b.…` — see "Fixture-slug rename" below.

### `src/sovereignty/*` test files — fixture-slug rename

`operator-b`, `operator-c`, `operator-c-2`, `operator-x` appear as **fixture slugs** for peer networks across: `schema.test.ts`, `types.test.ts`, `engine.test.ts`, `nsc.test.ts`, `test-fixtures.ts`, `transport.test.ts`, `validators/chain.test.ts`, `validators/ingress.test.ts`, `validators/egress.test.ts`, `policy-store.test.ts`.

**DECISION:** Rename the fixture slugs `operator-b` → `principal-b` (etc.) **as part of R12a** — they are illustrative network slugs, and leaving them reads as if `operator` is still a live term. This is a mechanical, low-risk find-replace within test files only. It is **NOT** the NSC `OP_*`/`--src-account` carve-out. PR-time `grep -rn 'operator-[a-z0-9]' src/sovereignty/ tests/` enumerates every hit; rename each slug + every `federated.operator-b.*` subject string + `partner_org`/`partner_network` value + NSC import-name expectation that embeds the slug.

- `src/sovereignty/policy-store.test.ts` — L39–343: `expect(store.get().org)` accesses → `store.get().network` (R4 schema); `"other-org"` / `"burst-three"` values are policy `network` slugs, leave the values, rename only the field accessor.
- `src/sovereignty/test-fixtures.ts` — L6–7 comment + L19/L27/L29 subject + `partner_org` → rename slug + field.
- `src/sovereignty/nsc.test.ts` — L128 `"# myelin sovereignty imports from partner: operator-b"`, L223–268 header assertions embed the slug; rename in lockstep with the slug.

### `src/observability/transport.ts`

- **R7**:
  - L23 `import { ORG_RE } from "../patterns";` → `import { PRINCIPAL_RE } from "../patterns";`
  - L171 comment `* \`org\` must satisfy \`ORG_RE\` …` → `\`principal\` must satisfy \`PRINCIPAL_RE\``
  - L182 `if (!ORG_RE.test(org))` → `if (!PRINCIPAL_RE.test(principal))` (parameter `org` → `principal`)
  - L183 `throw new Error(\`metricsSubject: invalid org '${org}' — must match ${ORG_RE}\`);` → `invalid principal '${principal}' — must match ${PRINCIPAL_RE}`
  - L46 comment `subject \`local.{org}._metrics.transport.{source}\`` → `local.{principal}._metrics.…`
  - L174 comment `\`local.{org}._metrics.transport.>\`` → `local.{principal}._metrics.…`
  - L192 `return \`local.${org}._metrics.transport.${safe}\`;` — code R7 (param rename)

### `src/patterns.ts`

**(under-specified in the original manifest — fully enumerated.)**

`ORG_RE` is **defined** in `src/patterns.ts:34`, **redefined locally** in `src/composition/lifecycle.ts:12` and `src/sovereignty/schema.ts:6`, and **imported** by `src/observability/transport.ts:23` and `src/bidding/subjects.ts:1`.

- **R7** — rename the exported constant `ORG_RE` → `PRINCIPAL_RE` (the regex value `/^[a-z][a-z0-9-]{0,62}[a-z0-9]$/` is unchanged — it validates a single subject segment):
  - L34 `export const ORG_RE = /^[a-z][a-z0-9-]{0,62}[a-z0-9]$/;` → `export const PRINCIPAL_RE = …;`
  - L25 comment `* (\`local.{org}.…\`, \`federated.{org}.…\`, \`local.{org}._metrics.…\`). Must` → three `{principal}` substitutions
- **Consolidation requirement:** the two *local redefinitions* (`composition/lifecycle.ts:12`, `sovereignty/schema.ts:6`) MUST be deleted and replaced with `import { PRINCIPAL_RE } from "../patterns"`. **All five sites — the definition + two redefinitions + two imports — change in ONE PR.** Splitting them risks a name-mismatch compile break (a half-renamed `ORG_RE` import).

### `src/composition/lifecycle.ts`

- **R7**:
  - L12 `const ORG_RE = /^[a-z][a-z0-9-]{0,62}[a-z0-9]$/;` → **delete**; replace with `import { PRINCIPAL_RE } from "../patterns";`
  - L15 `if (!ORG_RE.test(org))` → `if (!PRINCIPAL_RE.test(principal))` (param `org` → `principal`)
  - L16 `throw new Error(\`workflow subject: invalid org '${org}'\`);` → `invalid principal '${principal}'`
  - L4 comment `* Subjects sit under \`local.{org}.dispatch.workflow.{event}\` …` → `local.{principal}.…`
  - L26 comment `// Subject becomes local.{org}.dispatch.{event} …` → `local.{principal}.…`
  - L28 `return \`local.${org}.dispatch.${event}\`;` — code R7 (param rename)

### `src/composition/types.ts`

- **R1** — L165 comment `/** Principal that executed the step. */` → `/** Identity that executed the step. */`

### `src/composition/orchestrator.ts`

- **R2** — `.principal` field accesses on step receipts:
  - L946 `...(failed.principal ? { agent_principal: failed.principal } : {}),` → `failed.identity`. The **payload key** `agent_principal` is an outgoing-envelope payload field naming an identity DID → rename to `agent_identity` for consistency (it is a myelin-defined payload shape, not a fixed external contract). PR-time: confirm no external consumer pins `agent_principal`; if one does, treat as Tier-2 with back-compat.
  - L972, L988 `...(completed.principal ? { agent_principal: completed.principal } : {}),` → `completed.identity` + `agent_identity:`
- **R7** (comments + code):
  - L46 `* \`local.{org}.tasks.{capability}\`. …` → `local.{principal}.…`
  - L52 `* to \`local.{org}.dispatch.task.completed\` …` → `local.{principal}.…`
  - L60 `* live under \`local.{org}.dispatch.workflow.{state}\`.` → `local.{principal}.…`
  - L380 `const subject = \`local.${org}.dispatch.task.>\`;` — code R7
  - L519 `const subject = \`local.${org}.tasks.${step.capability}\`;` — code R7

### `src/composition/integration.test.ts`

- **R7** — L111 comment `* each event on \`local.{org}.dispatch.{event}\` …` → `local.{principal}.…`

### `src/bidding/index.ts`

- **R7 + R11** (comments):
  - L7 `*   1. **Publisher** (\`createBiddingPublisher\`) broadcasts a signed bid` → `offers a signed bid` (R11 — prose)
  - L17 `* / \`bid-assigned\`) on \`local.{org}.dispatch.bid.>\`.` → `local.{principal}.…`
  - L32 `*   - \`local.{org}.tasks.bid-request.{capability}\` — broadcast request` → `local.{principal}.…` + `offer request`
  - L33 `*   - \`local.{org}.tasks.@{principal}.{capability}\` — direct-address` → `local.{principal}.tasks.@{assistant}.{capability}` (R7 + R9)
  - L35 `*   - \`local.{org}.dispatch.bid.>\` …` → `local.{principal}.…`

### `src/bidding/subjects.ts`

- **R7**:
  - L1 `import { DID_RE, CAPABILITY_TAG_RE, ORG_RE } from "../patterns";` → `… PRINCIPAL_RE …`
  - L4 `if (!ORG_RE.test(org))` → `if (!PRINCIPAL_RE.test(principal))` (param rename)
  - L5 `throw new Error(\`bidding subject: invalid org '${org}' — must match ${ORG_RE}\`);` → `invalid principal '${principal}' — must match ${PRINCIPAL_RE}`
  - L24 `return \`local.${org}.tasks.bid-request.${capability}\`;` → `local.${principal}.…`
  - L33 `return \`local.${org}.tasks.@${encodePrincipalForSubject(principal)}.${capability}\`;` → `local.${principal}.tasks.@${encodeDidSegment(did)}.${capability}` — **see local-encoder note below.**
  - L49 `return \`local.${org}.dispatch.bid.${event}\`;` → `local.${principal}.…`
  - L37–38 comments `… \`local.{org}.dispatch.bid.{event}\`, NOT \`local.{org}.dispatch.task.{event}\`.` → both `local.{principal}.…`
- **R9** — L16 comment `// Mirror tasks.@{principal} encoding from F-019: ':' → '-', '.' → '--'.` → `tasks.@{assistant}`

**local-encoder note (CORRECTED):** the original manifest claimed a function `encodePrincipalForSubject` should rename to `encodeAssistantForSubject`. Ground truth: `src/bidding/subjects.ts:15` defines a **module-local** helper `encodePrincipalForSubject(principal: string)` — it is *not* exported and it *duplicates* `encodeDidSegment` from `src/subjects.ts` (same `:`→`-`, `.`→`--` rule). The fix is **not a rename** — it is **consolidation**: delete the local `encodePrincipalForSubject` and import `encodeDidSegment` from `../subjects`. (`encodeDidSegment` itself does NOT rename — it is a generic DID encoder, not principal-specific.) The current `principal` *parameter name* of the local helper is itself the broad-entity sense; after consolidation the call passes a DID directly. File this consolidation as part of the R7 bidding-subjects PR; if the myelin owner prefers to keep the local helper, rename it to `encodeDidSegmentLocal` — but do NOT name it `encodeAssistantForSubject` (it encodes a DID, not an assistant name).

### `src/bidding/subjects.test.ts`

- **R7** — L9 test name `it("builds local.{org}.tasks.bid-request.{capability}", …)` → `local.{principal}.…`

### `src/bidding/publisher.ts`

- **R7 + R11**:
  - L28 comment `* on \`local.{org}.dispatch.task.failed\` …` → `local.{principal}.…`
  - L40–41 comment `* lifecycle envelope. Defaults to \`"broadcast"\` — bidding is itself / a broadcast pattern …` → `Defaults to \`"offer"\` — bidding is itself / an offer pattern` (R11)
  - L87 comment `* the broadcast advertisement; …` → `the offer advertisement`
  - L129 comment `*   1. Broadcast bid request on \`local.{org}.tasks.bid-request.{capability}\`.` → `Offer bid request on \`local.{principal}.…\``
  - L225 comment `// bound BEFORE the broadcast lands. …` → `before the offer lands`
  - L384 `distribution_mode: noWinnerDistributionMode ?? "broadcast",` → `?? "offer"` (**live default — R11; this emits the enum value on the wire**)
  - L399 `\`local.${org}.dispatch.task.failed\`,` — code R7 (param rename)

### `src/bidding/publisher.test.ts`

- **R11**:
  - L909 `distribution_mode: "broadcast",` → `"offer"`
  - L1029 `it("noWinnerDistributionMode overrides the default 'broadcast' tag", …)` → `default 'offer' tag`

### `src/bidding/collector.ts`

- **R11** (comments) — L34 `// emit the bid-request broadcast AFTER the inbox is bound,` → `bid-request offer`; L184 `// broadcast here so it lands only after the inbox is bound.` → `offer here`.

### `src/bidding/response.ts`

- **R2**:
  - L94 `if (bid.bidder !== bid.signed_by.principal)` → `bid.signed_by.identity`
  - L95 `return { valid: false, reason: \`bidder/principal mismatch: ${bid.bidder} vs ${bid.signed_by.principal}\` };` → `bidder/identity mismatch … ${bid.signed_by.identity}`

### `src/bidding/response.test.ts`

- **R2** — L28 `expect(bid.signed_by.principal).toBe("did:mf:luna");` → `bid.signed_by.identity`

### `src/bidding/types.ts`

- **R7** (comments) — L39–40 `* \`local.{org}.dispatch.bid.>\` … \`local.{org}.dispatch.task.>\` …` → both `local.{principal}.…`

### `src/bidding/agent.ts`

- **R7** (comment) — L78 `* On \`start()\`, subscribes to \`local.{org}.tasks.bid-request.{capability}\`` → `local.{principal}.…`

### `src/discovery/discovery.test.ts`

- **R2**:
  - L59 `expect(reg.signed_by.principal).toBe("did:mf:luna");` → `reg.signed_by.identity`
  - L117 comment `// Tamper: swap signed_by.principal` → `signed_by.identity`
  - L118 `const tampered = { …reg, signed_by: { …reg.signed_by, principal: "did:mf:fern" } };` → `identity: "did:mf:fern"`
  - L191 `expect(all.map((r) => r.advertisement.principal).sort())…` → `r.advertisement.identity`

### `src/discovery/register.ts`

- **R2** — `advertisement.principal` field (this IS an identity DID):
  - L24 comment `*   - advertisement.principal matches identity.did (no spoofing)` → `advertisement.identity`
  - L33 `if (!DID_RE.test(advertisement.principal))` → `advertisement.identity`
  - L34 `throw new Error(\`signCapabilityRegistration: invalid DID '${advertisement.principal}'\`);` → `advertisement.identity`
  - L36 `if (advertisement.principal !== identity.did)` → `advertisement.identity`
  - L38 `\`… advertisement.principal (${advertisement.principal}) must match identity.did …\`` → `advertisement.identity (${advertisement.identity})`
  - L96 `if (existing.advertisement.principal !== identity.did)` → `existing.advertisement.identity`
  - L97 `\`… cannot update registration for ${existing.advertisement.principal}\`` → `existing.advertisement.identity`

`registerSelf` in `src/agent-identity/helpers.ts:66` also builds `advertisement: { principal: identity.did, … }` → rename that key to `identity:` (added to the helpers.ts section conceptually; PR-time, the `advertisement.principal` rename in `src/discovery/types.ts` `CapabilityAdvertisement` is the type-level driver — see note below).

**CapabilityAdvertisement note:** `advertisement.principal` is a field on the `CapabilityAdvertisement` interface in `src/discovery/types.ts`. R2 renames that interface field to `identity`. PR-time `grep -rn 'advertisement.principal' src/` + `grep -rn 'principal:' src/discovery/ src/agent-identity/helpers.ts` enumerates every construction + access site. This is a **discovery-wire field** (capability registrations are signed + published) — Tier 2, back-compat read for one minor.

### `src/discovery/verify.ts`

- **R2**:
  - L11 comment `*   1. signed_by.principal matches advertisement.principal (anti-spoof)` → both `.identity`
  - L23 `if (signed_by.principal !== advertisement.principal)` → both `.identity`
  - L26 `reason: \`principal mismatch: signed_by=${signed_by.principal} advertisement=${advertisement.principal}\`,` → `identity mismatch: signed_by=${signed_by.identity} advertisement=${advertisement.identity}`
  - L30 `const principal = registry.resolve(advertisement.principal);` → `const identity = registry.resolve(advertisement.identity);`
  - L32 `return { status: "rejected", reason: \`unknown principal: ${advertisement.principal}\` };` → `unknown identity: ${advertisement.identity}`
  - L49 `reason: \`invalid public_key encoding for ${advertisement.principal}\`` → `${advertisement.identity}`
  - L70 `return { status: "verified", principal: advertisement.principal, advertisement };` → `identity: advertisement.identity`

### `src/discovery/memory-store.ts`

- **R2**:
  - L24 comment `*   - put / get / delete keyed by advertisement.principal` → `advertisement.identity`
  - L40 `const key = registration.advertisement.principal;` → `registration.advertisement.identity`

### `src/discovery/discovery.ts` + remaining discovery files

`grep -rn 'advertisement\.principal\|\.principal\b' src/discovery/` at PR time — every `advertisement.principal` / verify-result `.principal` → `.identity`. `src/discovery/types.ts` `CapabilityAdvertisement.principal` field declaration is the driver (see CapabilityAdvertisement note).

### `src/transport/envelope.ts`

- **R7** (comments):
  - L29 `* Operator stack segment slotted between \`{org}\` and \`{type}\` …` → `Principal stack segment … {principal} and {type}` (R7 + R12a — "Operator" prose → "Principal")
  - L106 `// 6-segment grammar \`local.{org}.{stack}.{type}\` post-myelin#113.` → `local.{principal}.…`

### `src/transport/envelope.test.ts`

- **R2** — L263 `expect(env.signed_by![0].principal).toBe("did:mf:test-bot");` → `.identity`
- **R6** — L94 `it("throws on invalid source pattern", …)` — like `envelope.test.ts:75`, add a case asserting 4-/5-segment sources now reject after R6.
- **R7** (comments):
  - L108 `it("derives local subject: local.{org}.{type}", …)` → `local.{principal}.{type}`
  - L179–180 `// … cannot tell \`local.{org}.review.review.completed\` apart from \`local.{org}.review.completed\` …` → both `local.{principal}.…`

### `src/transport/dead-letter.ts`

- **R7**:
  - L87 `// Expect at least: prefix.{org}.tasks.{capability}[.{subcapability}]` → `prefix.{principal}.tasks.…`
  - L91 `\`deriveDeadLetterSubject: unexpected subject shape '${originalSubject}' — expected '{prefix}.{org}.tasks.{capability}.*'\`` → `'{prefix}.{principal}.tasks.{capability}.*'`

### `src/transport/dead-letter.test.ts`

- **R7 + R9** — L61 comment `// local.{org}.tasks.@{principal}.{capability} — capability is at parts[3]` → `local.{principal}.tasks.@{assistant}.{capability}`

### `src/transport/nak.ts`

- **R7** — L17 comment `// publishes \`dispatch.task.rejected\` on \`local.{org}.dispatch.task.rejected\`` → `local.{principal}.…`

### `src/segment-validators.ts`

- **R7** (comments):
  - L79 `* that sits between \`local.{org}.\` and the domain …` → `local.{principal}.`
  - L95 `*   \`local.${org}.${stackInfix(stack)}tasks.${cap}.>\`` → `local.${principal}.…`
  - L96 `*   //  → \`local.{org}.tasks.{cap}.>\` when stack omitted` → `local.{principal}.…`
  - L97 `*   //  → \`local.{org}.{stack}.tasks.{cap}.>\` when supplied` → `local.{principal}.{stack}.…`

### `src/economics.test.ts`

- **R6** — L6 `source: "metafactory.cortex.operator",` — a `source`-field fixture. After R6 the grammar is `{principal}.{stack}.{assistant}` (fixed 3). The value parses (3 segments) but `operator` as an *assistant name* is wrong vocabulary. Replace with a real assistant name: `source: "andreas.meta-factory.echo"`.

### `schemas/envelope.schema.json`

The wire schema. **Tier 3 — bump `$id` to `v2` (see semver note).** 2-space indented JSON.

- **`$id` bump** — L3 `"$id": "https://myelin.metafactory.ai/schemas/envelope/v1",` → `"…/envelope/v2",` (the Tier-3 wire changes — R6 grammar, R11 enum, R13 field — make this a new schema version).
- **R6** — `source`:
  - L16 `"pattern": "^[a-z][a-z0-9-]*(\\.[a-z][a-z0-9-]*){2,4}$",` → `"^[a-z][a-z0-9-]*(\\.[a-z][a-z0-9-]*){2}$"` (fixed 3 segments)
  - L17 `"description": "Origin address. Minimum 3 segments (org.agent.instance), up to 5 …",` → `"Origin address. Exactly 3 segments: {principal}.{stack}.{assistant}. Format aligns with the wire subject's leading segments per specs/namespace.md."`
  - L18 `"examples": ["acme.monitor.prod-01", "metafactory.pilot.local", "acme.security.scanner.prod-01"]` → drop the 4-segment example; e.g. `["andreas.meta-factory.echo", "metafactory.cortex.pilot"]`
- **R2** — `signed_by` stamp `principal` keys: the two `signedByStamp` variants in `$defs` (L211/L214 `ed25519`, L222/L225 `hub-stamp`) — rename JSON key `"principal"` → `"identity"` in each `required` array and each `properties` block (4 sites: 2 required-array entries + 2 property definitions). `originator` (L179 `required`, L181 `properties.principal`) — rename `"principal"` → `"identity"` (2 sites). **Transition schema** (v1.x interim, see distribution_mode plan): the validator accepts both keys; this v2 schema is the *target*. Keep the v1 schema file published for pinning.
- **R11** — `distribution_mode` enum: L168 `"enum": ["broadcast", "direct", "delegate"],` → v2 target `"enum": ["offer", "direct", "delegate"]`. L169 description `"… broadcast = competing consumers; …"` → `"offer = competing consumers; …"`. L159 also mentions "broadcast" in the `sovereignty` description ("bidding (F-10) = broadcast bid-request") — that "broadcast" is a *verb* describing the bidding flow, **not the enum value**; rewrite to "offer" for vocabulary consistency but it carries no wire weight.
- **R13** — `target_principal`: L171 property `"target_principal"` → `"target_assistant"`; L174 description references; L201 `"then": { "required": ["target_principal"] }` → `["target_assistant"]`.

### `README.md`

- **R6** — L48 `| \`source\` | string | Origin: \`org.agent.instance\` (3-5 segments) |` → `| Origin: \`{principal}.{stack}.{assistant}\` (fixed 3 segments) |`
- **R7** — L63 `| \`local.{org}.{stack}.{domain}.{entity}.{action}\` | Org only | Never leaves org boundary |` → `local.{principal}.…` + `Never leaves principal boundary`
- **R7** — L64 `| \`federated.{org}.{stack}.{domain}.{entity}.{action}\` | Cross-org | Subject to envelope sovereignty |` → `federated.{principal}.…` + `Cross-principal`
- **R8** — L61 `| Prefix | Reach | Rule |` → `| Prefix | Scope | Rule |`

### `specs/namespace.md`

The grammar authority — heaviest single doc. PR-time `grep -n '{org}\|Reach\|Broadcast\|@{principal}\|target_principal\|operator' specs/namespace.md` drives the exact list; known hits:

- **R7** — `{org}` → `{principal}` everywhere (15+ hits — L28, 44, 60, 69, 88×2, 114, 155, 168, 175, 188, 235, 249–251, 266).
- **R8** — L15 `| Prefix | Reach | Sovereignty Rule |` → `| Prefix | Scope | Sovereignty Rule |`
- **R9 + R13** — L188 `local.{org}.{stack}.tasks.@{principal}.{capability}` → `local.{principal}.{stack}.tasks.@{assistant}.{capability}` ; L191 `The \`@{principal}\` segment routes to a single agent by principal id.` → `The \`@{assistant}\` segment routes to a single assistant by name.` ; L250 `federated.{org}.{stack}.tasks.@{principal}.{capability}` → `federated.{principal}.{stack}.tasks.@{assistant}.{capability}` ; L374 table `| \`tasks.@{principal}\` | \`target_principal\` | …` → `| \`tasks.@{assistant}\` | \`target_assistant\` | …`.
- **R13** — L367 prose `additional envelope field — \`target_principal\` …` → `target_assistant` ; L381–383 worked examples `target_principal=did:mf:forge|pilot|hub.metafactory` → `target_assistant=…` ; L398 `Direct/Delegate subjects still encode \`target_principal\` (the receiver)…` → `target_assistant`.
- **R10** — L130 `… to denote a principal address …` → `assistant address` ; L159 `| \`@*\` … | Direct/Delegate principal address … |` → `Direct/Delegate assistant address`.
- **R11** — L168 `… three operator-facing distribution shapes — Broadcast, Direct, Delegate …` → `three principal-facing distribution shapes — Offer, Direct, Delegate` (R11 + R12a) ; L172 `### Broadcast — competing consumers (open market)` → `### Offer — …` ; L361 `produces Broadcast task subjects directly:` → `produces Offer task subjects` ; L385 `selects between Broadcast (standard derivation, \`target_principal\` absent) …` → `between Offer (…, \`target_assistant\` absent) …` ; L398 `… and broadcast subjects still derive from \`source\`/\`type\`.` → `offer subjects`.
- **R12a** — L33 `… scopes the signal to one of an operator's stacks` → `one of a principal's stacks` ; L36 `… within acme (single-stack operator)` → `single-stack principal` ; L69 `… names a stack under the operator identified by \`{org}\`.` → `under the principal identified by \`{principal}\``.

### `docs/envelope.md`

- **R6** — L18 `| \`source\` | yes | string | Origin address (\`org.agent.instance\`, 3-5 segments) |` → `\`{principal}.{stack}.{assistant}\` (fixed 3 segments)`
- **R7** — L101 `local.{org}.{domain}.{entity}.{action}     # never leaves org boundary` → `local.{principal}.…` + `never leaves principal boundary` ; L102 `federated.{org}.{domain}.{entity}.{action} # cross-org, sovereignty-gated` → `federated.{principal}.…` + `cross-principal`.
- **R2** — L163, 170, 175, 176, 197 (PR-time verify) `originator.principal` → `originator.identity`.
- **R11 + R13** — L30 `| \`distribution_mode\` | no | enum | F-021 \`broadcast\` / \`direct\` / \`delegate\` |` → `\`offer\` / \`direct\` / \`delegate\`` ; L31 `| \`target_principal\` | no | DID | F-021 receiver DID …` → `\`target_assistant\`` ; L87 `…\`distribution_mode\`, \`target_principal\`), \`originator\` …` → `target_assistant` ; L114 `… Broadcast / Direct / Delegate / dead-letter shapes …` → `Offer / Direct / Delegate / dead-letter` ; L127 `- \`target_principal\` — required when \`distribution_mode ∈ {direct, delegate}\`` → `target_assistant`.
- **R12a** — L98 `… not replicated across operator boundaries.` → `principal boundaries` ; L164 `A federated peer relays a claim from an upstream operator. …` → `upstream network`.

### `docs/identity.md`

- **R2** — L38 `| \`signed_by.principal\` | Verified identity | Yes — cryptographically |` → `| \`signed_by.identity\` | …` ; L110 `console.log(result.principal.id); // "…" — LAST verified principal` → `result.identity.id` + `LAST verified identity`.
- **R4** — L25 `  operator: string;     // "metafactory"` → `  network: string;     // "metafactory"` ; L224 sample JSON `"operator": "metafactory"` → `"network": "metafactory"`.
- **R5** — L27 `  type: "agent" | "service" | "operator";` → `"agent" | "service" | "hub"` ; L89 `registry.add({ id: "did:mf:echo", operator: "metafactory", …, type: "agent", … });` → `network: "metafactory"` ; L90 `registry.add({ id: "did:mf:hub.metafactory", operator: "metafactory", …, type: "operator", …, is_hub: true });` → `network: "metafactory", …, type: "hub"` ; L121 prose `"Must be signed by an operator-type principal …"` → `"Must be signed by a hub-type identity …"` ; L126, L175 `mustIncludePrincipalType: "operator"` → `mustIncludeIdentityType: "hub"`.
- **R3** — L253 table `Chain-shape predicates (\`mustIncludeRole\`, \`mustIncludePrincipalType\`, \`mustIncludePrincipal\`, \`minLength\`)` → `mustIncludeIdentityType`, `mustIncludeIdentity`.
- **R12a** — L17 `did:mf:hub.metafactory — operator hub` → `did:mf:hub.metafactory — network hub` ; L76 `… faster for intra-operator trust` → `intra-network trust`.

### `docs/sovereignty.md`

- **R2** — L21 `carry a \`signed_by.principal\` mapped to a known partner …` → `signed_by.identity` ; L141 Mermaid label `start --> q1{envelope.signed_by.principal<br/>present?}` → `signed_by.identity` ; L192 table row → `signed_by.identity`.
- **R12a** — L4–5 `… The / operator guide tells you **how** to provision policy …` and L181, L202, L327–328 — these reference the doc `docs/sovereignty-operator.md` *as a title* and "the operator guide". **See the `docs/sovereignty-operator.md` file-rename decision below** — if that file is renamed to `sovereignty-network.md`, these link targets + the phrase "operator guide" → "network guide" change in lockstep.
- **R12a** — L57 Mermaid `subgraph operator [Operator-provisioned]` — "Operator-provisioned" means provisioned-by-the-human → the human is `principal`. Rewrite to `subgraph deployment [Principal-provisioned]` (or keep `[Network-provisioned]` if the intent is the org). **DECISION:** `Principal-provisioned` — sovereignty policy is provisioned by the human running the stack.

### `docs/sovereignty-operator.md` — FILE RENAME DECISION

**DECISION: rename the file to `docs/sovereignty-network.md`.** Rationale: the file is the sovereignty *provisioning/runbook* guide. `CONTEXT.md` kills `operator` in every context; the document is about provisioning a **network's** federation policy (NSC imports/exports between networks). `network` is the correct noun. The renaming PR MUST:

1. `git mv docs/sovereignty-operator.md docs/sovereignty-network.md`.
2. Fix every inbound link: `docs/sovereignty.md` L4, L327 (`[\`docs/sovereignty-operator.md\`](./sovereignty-operator.md)`), L328 prose "operator guide" → "network guide"; `docs/sovereignty.md` L202 "See operator guide §7" → "network guide §7"; any other `grep -rn 'sovereignty-operator' docs/ README.md specs/`.
3. Inside the renamed file:
   - **R2** — L90, L240, L364 `signed_by.principal` → `signed_by.identity` (PR-time verify line numbers).
   - **R12b (NSC carve-out — NOT renamed)** — L118 "the operator already provisioned", L265 "operators apply them via shell", L327 `# … imports from partner: operator-b`, L331–332 `${PARTNER_ACCOUNT_OPERATOR_B}` / `--src-account` / `federated.operator-b.tasks.>`, L345 "(or operator's signing service)". These mix two senses: the **human running `nsc`** and the **NSC account placeholder**. The `${PARTNER_ACCOUNT_OPERATOR_B}` placeholder + `nsc` account names stay (NSC infra). "operators apply them" / "the operator already provisioned" — the human → ideally `principal`, but because this paragraph is tightly coupled to NSC-CLI mechanics, **deferred to R12b** for a follow-up grill rather than risking a half-correct prose edit. The `federated.operator-b.*` subject slugs follow the fixture-slug rename decision (→ `principal-b`) **if** the runbook's examples are illustrative; if they are copy-paste runbook commands tied to a real deployed account, they stay. PR author makes the call per-line and records it.

### `docs/discovery.md`

- **R2** — L38 `| \`principal\` | DID of the advertising agent. MUST match \`signed_by.principal\` (anti-spoof). |` → `| \`identity\` | DID … MUST match \`signed_by.identity\`` ; L71 `- \`advertisement.principal\` matches \`identity.did\` …` → `advertisement.identity` ; L87 `// result.principal + result.advertisement are guaranteed; …` → `result.identity` ; L94 `1. \`signed_by.principal === advertisement.principal\` …` → both `.identity`.
- **R7** — L166 `\`local.{org}.tasks.@{principal-encoded}.{capability}\`` → `local.{principal}.tasks.@{assistant-encoded}.{capability}` (R7 + R9).
- **R12a** — L189 `- Authorization decisions … (RBAC is per-operator, M7).` → `per-network` ; L191 `- Cross-operator capability federation — each operator owns its registry; …` → `Cross-network … each network owns its registry` ; L196 `… §5.4 operator-sovereignty-over-registries invariant.` → `network-sovereignty-over-registries`.

### `docs/design-agent-task-routing.md`

The agent-task-routing design — heaviest **R11** doc. PR-time grep drives exact lines; known clusters:

- **R7** — subject examples (L389–395, 440, 457–460, 479) `local.{org}.…` → `local.{principal}.…`.
- **R9** — subject examples (L34, 439, 477) `tasks.@{principal}.{capability}` → `tasks.@{assistant}.{capability}`.
- **R11** — L33 table row `| **Broadcast** | …` → `| **Offer** | …` ; L41 `… all routing is open-market (Broadcast) …` → `(Offer)` ; L47, L53 "the Broadcast mode" → "the Offer mode" ; L147 `| L6 Composition | Two-phase protocol: broadcast → collect → assign |` → `offer → collect → assign` ; L371 `… a specific Broadcast / Direct / Delegate dispatch` → `Offer / Direct / Delegate` ; L386 `**Lifecycle envelopes (Delegate mode shown; Broadcast / Direct emit a strict subset):**` → `Offer / Direct`. L102, L105, L158 use "broadcast" as a *verb/mechanism* ("The task publisher broadcasts availability", "Step 1: Publisher → tasks.available  (broadcast, no queue group)", "if no agents are online during the broadcast window") — **R12a decision: these describe the NATS fan-out mechanism, not the named mode. Keep "broadcast" as the lowercase mechanism verb** — the *named mode* is "Offer", the *transport behaviour* is still a broadcast. This distinction is deliberate and should be stated in a one-line note in the doc's §Distribution modes.
- **R12a** — operator-facing/operator-intent prose. **Per-line decisions:**
  - L23 "orchestrator translation of operator intent" → "principal intent" (the human's intent).
  - L29 "Three operator-facing modes of work delegation" / "the operator-facing semantics" → "principal-facing" (×2).
  - L39 "From the operator's perspective" / "the operator watches an event stream" → "principal" (×2).
  - L41 "the operator-facing benefit" → "principal-facing".
  - L371 "Orchestrator translation of operator intent" → "principal intent".
  - L376 "couples the protocol to one operator's policy choices" → "one network's policy choices" (an org's policy → `network`).
  - L395 comment "terminal: operator interrupt or timeout" → "principal interrupt".
  - L402 "Operator-in-the-loop visibility" / "the operator can *see*" → "Principal-in-the-loop" / "the principal can see".
  - L473 "Cross-operator task routing" / "cross-operator task markets" / "an agent from operator A cannot inherit operator B's principal scope" → "Cross-network" / "cross-network task markets" / "an agent from network A cannot inherit network B's principal scope".
  - L479 "The \`mf.net-{operator}.*\` convention" → **R12b** — this names the *legacy subject token*; it pairs with `docs/migration-from-legacy-nats.md`'s historical `mf.net-{operator}` and stays verbatim as a legacy-format citation.
  - L493 "Extensible per operator" → "per network".
- **R12b** — L372, L405 reference "operator-side AI-agent standards" / "operator-side review process" / "audited by an operator-side review process" (Northpower STD-NPW-AI-001 context). "operator-side" here means the *deploying organisation's governance side*. **Deferred to R12b** — this is governance-org terminology that may legitimately differ from the bus `principal`/`network` split; a follow-up grill (with the compass CONTEXT-MAP) decides.

### `docs/nak-reasons.md`

- **R7** — L39 `- **Subject:** \`local.{org}.dispatch.task.rejected\`` → `local.{principal}.…` ; L84 same.

### `docs/migration-from-legacy-nats.md`

The **historical record** of the legacy → myelin subject migration. The `mf.net-{operator}.*` references describe the **legacy** format being migrated FROM — **preserved verbatim** (R12b/historical).

- **Lines describing the OLD shape — leave:** L14 `mf.net-{operator}.{domain}.{entity}.{action}`, L25, L227 "Subjects that don't fit `mf.net-{operator}.*`", L229, L279 comment, L290.
- **Lines describing the NEW (target) shape — apply R7 + R12a:** L15–16 `local.{operator}.…` / `federated.{operator}.…` (these show the *target* form — the `{operator}` token here is the new-shape segment) → `local.{principal}.…` / `federated.{principal}.…` ; L58 "The `{operator}` segment stays." → "The `{principal}` segment stays." ; L231 "### Pure broadcast subjects with no operator scoping" → "no principal scoping" (and "broadcast" here is the *mechanism* — keep lowercase, R12a) ; L233 "operator-agnostic" / "drop the operator segment" → "principal-agnostic" / "principal segment".
- **R12a prose describing the new model:** L27–28 "an operator cannot mechanically prevent…", "cross-operator agreements", "every operator's traffic" → "principal"/"cross-principal"/"every principal's traffic" ; L221 "cross-operator territory once federation lands" → "cross-principal".
- PR-time `grep -n 'operator' docs/migration-from-legacy-nats.md` — every hit gets a per-line legacy-vs-target call, recorded in the PR description.

### `docs/architecture.md`

**(MISSING in the original manifest — added.)**

- **R12a / R12b** — `operator` appears as a defined glossary term:
  - L223 `- **Operator** — a metafactory deployment under a single trust boundary (e.g. \`metafactory.grove\`). Sovereignty boundaries follow operator boundaries.` — this **glossary entry IS the term being killed**. Replace the entry: define **Network** (a federation of principals; sovereignty boundaries follow network boundaries) and **Principal** (the human owner) per `CONTEXT.md`. The deployment-unit sense (`metafactory.grove`) is a cortex **stack** — cross-reference `cortex:stack`.
  - L13 "connect agents across operators" → "across networks".
  - L84 "NATS server topology (operator hubs, leaf nodes, …)" → "network hubs" (the trust-anchor identity sense → `hub`; keep as "network hubs").
  - L192 "the transport refusing to route an envelope across an operator boundary" → "across a network boundary".
  - L204 "Each operator owns its principal registry (L4) … Cross-operator trust …" → "Each network owns its identity registry … Cross-network trust" (note: "principal registry" → "identity registry" per R1, since the registry holds all identities).

### `examples/grove-agent.ts`

- **R2** — L66 `signed_by: envelope.signed_by?.principal,` → `envelope.signed_by?.identity`
- **R7** — L58 comment `//    from F-1 (local.{org}.grove.>).` → `local.{principal}.grove.>`

### `examples/arc-search.ts`

- **R2** — L76 `console.warn(\`  ${reg.advertisement.principal} — UNVERIFIED (${result.reason})\`);` → `reg.advertisement.identity` ; L79 `console.log(\`  ${reg.advertisement.principal} (load=${reg.advertisement.load})\`);` → `reg.advertisement.identity`.

### `examples/pilot-job.ts`

- **R7** — L56 `org: "metafactory",` (option to `createLifecycleSubscriber`/emitter — if the renamed API option is `principal`, this follows) → `principal: "metafactory"` ; L65 `org: "metafactory",` (lifecycle-emitter option) → `principal: "metafactory"`. (Driven by the option-name rename in `src/dispatch/lifecycle.ts` / `src/composition` factories — PR-time verify the public option key.)
- **R6** — L68 `source: "metafactory.pilot.dispatch",` is a 3-segment `source` — valid post-R6 (`metafactory`=principal, `pilot`=stack, `dispatch`=assistant). Vocabulary check: `dispatch` as an *assistant name* is questionable. Leave if it parses; flag for the examples-cleanup pass.
- **R13** — L83 `target_principal: echo.did,` → `target_assistant: echo.did`.
- **R2 (dispatch-payload `principal` field — Tier 2)** — L61 `principal: (env.payload as { principal?: string }).principal,` reads the `principal` key off the **task lifecycle payload**. Confirmed against `src/dispatch/types.ts`: the field is declared on six payload interfaces (`AssignedPayload` L48, `StartedPayload` L53, `ProgressPayload` L57, `CompletedPayload` L71, `FailedPayload` L82, `AbortedPayload` L91) — see that file's R2 section, which is the driver for this rename. Rename: `identity: (env.payload as { identity?: string }).identity,` — both the cast key and the property access. This is the same Tier-2 wire-payload rename; during the back-compat window the read may accept either key (`(p.identity ?? p.principal)`), emitting only `identity`.
- **R9** — L88–89 comment `// tasks.@{principal}.{capability}; principal-encoding …` → `tasks.@{assistant}.{capability}; assistant-encoding`.

### `examples/README.md`

- **R7** — L7 `… Matches the namespace convention from F-1 (\`local.{org}.grove.>\`).` → `local.{principal}.grove.>`

### `tests/integration/sovereignty-end-to-end.test.ts`

- **Fixture-slug rename (R12a)** — L137, 377, 390, 396, 440 — every `federated.operator-b.tasks.>` → `federated.principal-b.tasks.>` (PR-time grep enumerates all).
- **R2** — L424 `expect(entry.principal).toBe("did:mf:echo");` → `entry.identity` ; L486 `expect(entry.principal).toBe("did:mf:rogue");` → `entry.identity`.

### `tests/integration/sovereignty-transport.test.ts`

- **Fixture-slug rename (R12a)** — L143, 147, 157 — `federated.operator-b.…` → `federated.principal-b.…`.

### `tests/integration/dispatch-lifecycle.test.ts`

**(MISSING in the original manifest — added.)**

- **R11** — L147, 151, 155 `distribution_mode: "broadcast"` → `"offer"`.
- **R13** — L73 `requirements: ["code-review"], target_principal: principal,` → `target_assistant: principal` (the local variable `principal` is unrelated — it's a DID; leave the variable, rename the key).
- **R2 (dispatch-payload `principal` key — Tier 2)** — the lifecycle payloads pass a `principal` shorthand (the renamed `AssignedPayload`/`StartedPayload`/`ProgressPayload` field). Rename every payload `principal` key → `identity`: L77, L80, L84, L87 (test 1) and L152, L155 (test 2). NB: L62 and L137 declare a `const principal = "did:mf:pilot:test";` local — leave the variable name; the rename is the object *key* (the shorthand `{ principal }` becomes `{ identity: principal }`, or the variable may be renamed to `identity` per PR-author preference — either keeps the value).

### `tests/integration/bidding-round.test.ts`

- **R11** — L124 comment `* broadcast and inbox subscription …` → `offer and inbox subscription`.

---

## `distribution_mode` enum migration plan (R11 — the wire-enum change)

`"broadcast"` is a **live wire enum value** (`distribution_mode` in `schemas/envelope.schema.json`, `DISTRIBUTION_MODES` set + error message in `src/envelope.ts`, `DistributionMode` type in `src/types.ts`, the `publisher.ts` default, and ~25 test sites). Renaming it `"offer"` is a breaking wire change. Phased plan:

1. **Transition release (myelin minor, schema v1.x):**
   - `DISTRIBUTION_MODES` accepts BOTH `"broadcast"` and `"offer"` on read.
   - `DistributionMode` type = `'broadcast' | 'offer' | 'direct' | 'delegate'`.
   - All *write* paths emit `"offer"` (`publisher.ts:384` default → `"offer"`; `createEnvelope` passes through but new callers use `"offer"`).
   - Validator logs a deprecation warning when it reads `"broadcast"`.
   - `schemas/envelope.schema.json` (v1) enum stays `["broadcast","direct","delegate"]` OR adds `"offer"` — publish an interim schema that accepts both.
2. **Breaking release (myelin major, schema v2):**
   - `DISTRIBUTION_MODES` = `["offer","direct","delegate"]`; `"broadcast"` rejected.
   - `DistributionMode` = `'offer' | 'direct' | 'delegate'`.
   - `schemas/envelope.schema.json` `$id` → `…/envelope/v2`, enum `["offer","direct","delegate"]`.
3. **Schedule:** ~2 weeks between transition and breaking, gated on cortex/pilot/signal companion PRs landing (they publish + consume `distribution_mode`).

The exported function `broadcastTaskSubject` → `offerTaskSubject` is a *symbol* rename (not a wire value) — handled with a one-minor deprecated alias (see `src/subjects.ts` / `src/index.ts`).

---

## Cross-cutting notes

### Error-string lockstep (IMPORTANT)

Several tests assert **literal validator-error strings**: `src/envelope.test.ts:621` (`'signed_by.principal'`), `src/identity/chain.test.ts:148` (`'signed_by[1].principal'`), `src/envelope.test.ts:891` (`'target_principal'`). The validator builds these strings from the field path (`src/envelope.ts:343` `\`${path}.principal\``). **Back-compat cannot serve two error strings simultaneously** — an error has one `field` value. Therefore: the validator error-string change and the asserting tests **MUST change in the same PR** as the field rename. There is no transition window for the error string; it flips with the field. Consumers that pattern-match on the old error string (cortex's envelope-validation surfacing) must be updated in their companion PR — list this in the consumer table.

### Semver decisions (per-tier)

- **Tier 1** (comment/doc/internal-type renames): myelin **patch** bumps. No `$id` change. No CHANGELOG `### Changed` required except R1/R3 (exported type aliases → CHANGELOG entry).
- **Tier 2** (R2 field renames, R4 `Identity.operator`/`AgentIdentity.operator` + sovereignty `org`/`partner_org`, R5 enum value, registry-file `principals` key): myelin **minor** for the transition release (back-compat read), then **major** for the breaking release. `schemas/envelope.schema.json` `$id` → `v2` lands with the **major**.
- **Tier 3** (R6 `source` grammar, R11 `distribution_mode` enum, R13 `target_principal` field, R7 `org`→`principal` parameter rename): the wire-affecting subset lands in the **major**; `$id` → `https://myelin.metafactory.ai/schemas/envelope/v2`. The R7 *parameter* rename (`deriveSubject(org,…)` → `deriveSubject(principal,…)`) is a source-level breaking change to every caller — **major**, no runtime back-compat possible for a positional parameter (positional args don't carry names); coordinate via the consumer table + companion PRs.
- The myelin **package version** (`package.json`, currently `0.2.0`) gets a **major bump to `1.0.0`** when the breaking release lands — the vocabulary migration is the natural 1.0 line.

### Consumer × field table (drives companion-PR coordination)

Which downstream repo reads which renamed field. `local`/`✓` = consumes it; companion PR required.

| Renamed item | cortex | pilot | signal-collector | blueprint | halden |
|---|---|---|---|---|---|
| `signed_by[].principal` → `.identity` (R2, wire) | ✓ (envelope validation, dispatch-listener) | ✓ (review-loop envelopes) | ✓ (telemetry taps read `signed_by`) | — | ✓ (stack signing) |
| `originator.principal` → `.identity` (R2, wire) | ✓ (policy attribution) | — | ✓ (attribution display) | — | — |
| `target_principal` → `target_assistant` (R13, wire) | ✓ (**`dispatch.task` envelopes carry it** — most consumer-affecting) | ✓ (Pilot is the canonical Delegate receiver) | — | — | — |
| dispatch-payload `principal` → `identity` (R2, wire payload) | ✓ (dispatch-listener reads `payload.principal`) | ✓ (Pilot reads lifecycle payloads; `examples/pilot-job.ts:61`) | — | — | — |
| `source` grammar 3–5 → fixed-3 (R6, wire) | ✓ (every published envelope's `source`) | ✓ | ✓ | — | ✓ |
| `distribution_mode` `"broadcast"` → `"offer"` (R11, wire) | ✓ (orchestrator emits it) | ✓ (Pilot reads it) | ✓ (dashboards bucket by it) | — | — |
| `Principal`/`PrincipalType` exported type (R1/R3) | ✓ (`import type`) | ✓ | ✓ | ✓ | ✓ |
| `org`→`principal` subject-builder param (R7) | ✓ (every `deriveSubject` caller) | ✓ | ✓ | — | ✓ |
| `Identity.operator`/`AgentIdentity.operator` → `.network` (R4) | ✓ (`cortex.yaml` `operator.id` — see deployment note) | ✓ | — | — | ✓ |

Every `✓` is a companion PR that lands in lockstep with the corresponding myelin Tier-2/Tier-3 release. cortex carries the heaviest load — `target_assistant` + `source` + `distribution_mode` all hit its dispatch path.

### PR ordering (dependency-ordered sequence)

The type definitions must land before (or be back-compat-aliased ahead of) their dependents, or the repo will not compile mid-migration.

```
PR-1  src/identity/types.ts            — R1/R3/R4/R5 interface + R2 wire fields.
                                         Ships deprecated `Principal`/`PrincipalType`
                                         aliases so dependents still compile.
PR-2  src/patterns.ts + the 4 ORG_RE   — R7: ORG_RE→PRINCIPAL_RE definition +
      sites (composition/lifecycle.ts,   delete both redefinitions + fix both
      sovereignty/schema.ts,             imports. ALL FIVE in one PR (compile-coupled).
      observability/transport.ts,
      bidding/subjects.ts)
PR-3  src/identity/* (registry, verify, — R1/R2/R3/R5 cascade. Depends on PR-1.
      chain, index) + identity tests
PR-4  src/index.ts re-exports          — R1/R3 package surface + deprecated aliases.
PR-5  src/agent-identity/*             — R1/R4. Depends on PR-1.
PR-6  src/envelope.ts + schemas/        — R2/R6/R11/R13 wire changes. Tier 2/3.
      envelope.schema.json + canonicalize  Depends on PR-1. Schema $id → v2 here.
PR-7  src/dispatch/* + src/types.ts    — R2 (dispatch-payload `principal`→
                                         `identity` on the six lifecycle payload
                                         interfaces + lifecycle.test.ts fixtures)
                                         / R7 / R11 / R13. Depends on PR-1, PR-6.
PR-8  src/sovereignty/*                — R2/R4/R12a (incl. partner_network rename
                                         + fixture slugs). Depends on PR-1, PR-2.
PR-9  src/discovery/*                  — R2 advertisement.identity. Depends on PR-1.
PR-10 src/bidding/* + src/composition/* — R2/R7/R11. Depends on PR-1, PR-2, PR-6.
PR-11 src/subjects.ts + subjects.test  — R7/R9/R10/R11 (offerTaskSubject). Tier 3.
PR-12 specs/namespace.md + docs/* +    — Tier 1 prose. Can run in parallel once
      README.md + examples/              the code lands; group by doc.
PR-13 tests/integration/*              — R2 (incl. dispatch-payload `principal`→
                                         `identity` in dispatch-lifecycle.test.ts)
                                         / R11 / R13 + fixture slugs. Last —
                                         depends on every wire change above.
```

Tier-1 doc PRs (PR-12) and the comment-only subsets can be parallelised; the **code** PRs must respect the order above. Each PR runs `bunx tsc --noEmit && bun test` green before merge.

### JetStream replay strategy (retained pre-migration envelopes)

The dispatch-lifecycle stream (`EVENTS_{org}` — `src/dispatch/stream.ts`) and cortex's `CODE_REVIEW` stream hold **retained envelopes** signed before the migration. A post-migration consumer replaying history will see old field names (`signed_by[].principal`, `target_principal`, `distribution_mode: "broadcast"`, 5-segment `source`). Strategy:

1. **Dual-schema read window:** the Tier-2 *transition* release of myelin's validator accepts BOTH old and new field names. Consumers stay on the transition release (or newer with back-compat) for the **full stream retention period** of every stream they replay. Do not jump a consumer straight to the breaking major while it still replays a pre-migration stream.

   **Conflict-rejection rule (security boundary).** The transition reader prefers the new name when present, BUT MUST reject the envelope outright when both the old and new field appear with **different values** (e.g. `signed_by[0].principal = "did:mf:alice"` AND `signed_by[0].identity = "did:mf:bob"`). At a signed-envelope trust boundary, silently preferring one field opens an attack where different consumers / canonicalization paths interpret different identities. Specifically:
   - For each renamed wire field (R2 `signed_by[].principal`/`.identity`, R2 `originator.principal`/`.identity`, R13 `target_principal`/`target_assistant`, R11 `distribution_mode` legacy/`offer`, R2 dual-name payload `principal`/`identity`): if BOTH names are present, the validator MUST raise a typed error (`dual_field_conflict`) and refuse to parse. **Both present with identical values is also rejected** — it indicates an over-eager producer and signals a bug worth surfacing rather than silently coalescing.
   - The conflict check runs **before** any canonicalization or signature-bytes derivation, so an attacker cannot use one form for signature canonicalization and the other for downstream consumer parsing.
   - The transition release ships a regression test per renamed field that asserts:
     - both names with different values → rejected with `dual_field_conflict`
     - both names with identical values → rejected with `dual_field_conflict`
     - only old name → accepted, parsed as new
     - only new name → accepted
     This test is the rollback safety net (item 4 of the Rollback artefact section) and the breaking-major deletion guard.
2. **Stream drain before the breaking major:** for streams with bounded retention, the safest path is to let the stream's retention window fully expire (all pre-migration messages aged out) before deploying the breaking major to that stream's consumers. Document each stream's `max-age` so the migration timeline can wait it out.
3. **Stream-name shape:** `EVENTS_{org}` → `EVENTS_{principal}` (`stream.ts:21`) is a **new stream name**. Do NOT rename a live stream in place — create the new-named stream, dual-publish or mirror during the transition, retire the old one after drain. Treat exactly like a wire-breaking change.
4. **Re-stamp is not required:** retained envelopes keep their original signatures (re-stamping would invalidate the chain). Consumers MUST verify old-shape envelopes with the back-compat validator — verification reads the same bytes, only the field-name *parsing* differs.

### Rollback artefact

1. **Tag before starting:** before PR-1 merges, cut a release tag `pre-vocab-migration` (and a myelin release, e.g. `v0.2.x`) so any consumer can pin to the last all-old-vocabulary myelin.
2. **Schema `$id` pinning:** because `schemas/envelope.schema.json` keeps `$id` `…/envelope/v1` published alongside the new `…/v2`, a consumer can pin its validator to `v1` and keep running unmodified through the transition.
3. **Per-tier rollback:**
   - Tier 1 — pure revert of the doc/comment PR; no runtime effect.
   - Tier 2 — revert to the *transition* release (which still reads old names); never roll a consumer back past a release it has already written new-vocabulary data with, or it loses the ability to read its own recent writes. The transition release is the safe rollback floor.
   - Tier 3 — the breaking major has no clean partial rollback; roll the *whole ecosystem* back to the transition release. This is why Tier 3 lands last and only after every companion PR is verified.
4. **Rollback test:** the transition release MUST retain a regression test proving it reads BOTH old and new field names — that test is the rollback safety net.

### `cortex.yaml` / deployment migration (cross-repo coupling)

The `Identity.operator` → `Identity.network` rename (R4) couples to cortex deployment config: `cortex.yaml` carries an `operator.id` block consumed at stack startup. Renaming `operator` → `principal`/`network` in myelin's identity model means **every deployed stack's `cortex.yaml` needs an `operator.id` → `principal.id` (or `network.id`) migration**.

- This is **cortex's manifest's job to detail** — myelin's manifest only flags the coupling so the timelines align.
- cortex MUST ship a `cortex config migrate` step that rewrites `operator.id` → the new key, and a **mixed-version-tolerance window** where the stack accepts both `operator.id` and the new key (so a myelin upgrade doesn't hard-break an un-migrated `cortex.yaml`).
- The myelin Tier-2 release notes MUST cross-reference the cortex config-migration requirement so operators upgrading myelin know to run `cortex config migrate`.

### Completion signal — what proves the migration is done

The migration is complete when ALL of:

1. **Integration test on the new shape:** a `tests/integration/` test publishes a pilot→cortex `dispatch.task` envelope using the new vocabulary end-to-end — `source` fixed-3, `signed_by[].identity`, `target_assistant`, `distribution_mode: "offer"` — and asserts cortex's consumer accepts and routes it. This test lives in cortex (the consumer) or in a shared integration suite; myelin's manifest requires it exists and is green.
2. **CI grep guard:** a CI check asserts **no `operator` and no `{org}`** appear in `src/`, `schemas/`, `specs/` outside an explicit allow-list. The allow-list contains exactly: the R12b-deferred lines (NSC carve-out in `sovereignty/nsc.ts`, the `mf.net-{operator}` legacy citations in `docs/migration-from-legacy-nats.md`, `docs/design-agent-task-routing.md` operator-side-governance lines) and the deprecated back-compat aliases. Any new occurrence fails CI. Implement as a `bun` script in `package.json` (`check:vocab`).
3. **Deprecated aliases removed:** the breaking major has deleted every `@deprecated` alias (`Principal`/`PrincipalType`/`broadcastTaskSubject`/`toPrincipal`/`offerTaskEnvelope`) — confirmed by the grep guard.
4. **All companion PRs merged:** every `✓` in the consumer table has a merged PR on the corresponding myelin release.

---

## R12b — explicitly deferred ambiguous `operator` lines

These lines use "operator" in a sense not mechanically resolvable to `principal` or `network` without a follow-up grill. They are **listed, not silently dropped** — the manifest's promise ("every line decided") is kept by naming exactly what is undecided:

- `src/sovereignty/nsc.ts` L9, L137, L361 — "operator" = the human running `nsc`. Likely `principal`, but tightly coupled to NSC-CLI mechanics. Defer.
- `docs/sovereignty-network.md` (post-rename) L118, L265, L345 — "operators apply them", "operator's signing service" — NSC-operational human. Defer.
- `docs/design-agent-task-routing.md` L372, L405 — "operator-side AI-agent standards", "operator-side review process" (Northpower STD-NPW-AI-001 governance context) — the deploying organisation's governance side. May legitimately differ from the bus vocabulary. Defer to a grill with `compass/ecosystem/CONTEXT-MAP.md`.
- NSC account placeholders everywhere — `OP_ANDREAS`, `${PARTNER_ACCOUNT_OPERATOR_B}`, `nsc operator` — **decided: stay** (NATS infra, not the cortex `operator` concept). Listed here for completeness; not deferred, resolved as "no change".

A follow-up grill resolves the genuinely-deferred set above. Until then, the CI grep guard's allow-list (completion signal #2) contains exactly these lines.

---

## What this manifest does NOT cover

- The NSC carve-out and legacy citations enumerated in R12b above.
- New tests for the renamed shapes beyond those named — each Tier-2/Tier-3 PR adds tests for the new field names AND retains a back-compat regression test for the transition release.
- The cortex-side `cortex.yaml` config migration mechanics (cross-referenced under "cortex.yaml / deployment migration" — cortex owns the detail).
- The pilot/signal companion-PR internals — myelin's manifest provides the consumer table; each consumer repo writes its own change list.

---

## Per-PR checklist (template)

For each PR:

- [ ] Pull latest `main`; respect the PR-ordering dependency sequence above
- [ ] Apply every change in this manifest under the PR's scope
- [ ] `bunx tsc --noEmit` clean
- [ ] `bun test` green (full suite, not just the file touched)
- [ ] Update `CHANGELOG.md` (Tier 2/3 PRs, plus R1/R3 for the exported-type aliases)
- [ ] If the PR touches `schemas/envelope.schema.json`, bump `$id` to `v2` (Tier 3) and keep `v1` published; write the back-compat note
- [ ] If the PR touches a wire field / enum / config-file key, confirm the transition release reads BOTH old and new (back-compat regression test added)
- [ ] Cross-link the cortex/pilot/signal companion PRs in the body (per the consumer table)
- [ ] Reference this manifest path in the PR body
- [ ] For Tier 3 — confirm the ADR `docs/adr/0002-rename-org-segment-to-principal.md` exists and records the decision + timeline
- [ ] Tag JC (jcfischer) on the Tier-2/Tier-3 PRs
