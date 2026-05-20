# Myelin — Vocabulary Migration Manifest (2026-05)

**Status:** draft for review · deterministic ground truth
**Source:** `CONTEXT.md` (myelin) + `CONTEXT-MAP.md` (compass/ecosystem) — grill-with-docs sessions, May 2026
**Method:** every entry below was produced by `rg` against `main` (commit `b27b720`, 2026-05-20). Each line in this manifest is a real occurrence in the codebase; nothing is inferred.

Read this as the script: each PR claims one rename or one file/cluster, performs every listed change, runs `bunx tsc --noEmit && bun test`, opens for review.

---

## Rename inventory (canonical)

| #  | Old | New | Scope | Source |
|----|---|---|---|---|
| R1 | `Principal` (TS type/interface name) | `Identity` | code | `myelin/CONTEXT.md` (myelin-Q1) |
| R2 | `signed_by[].principal` / `originator.principal` / `advertisement.principal` / `chain[i].principal` (object field) | `.identity` | code + schema + prose | myelin-Q1 |
| R3 | `PrincipalType` (TS type) | `IdentityType` | code | myelin-Q1 |
| R4 | `Identity.operator` (object field) | `Identity.network` | code + prose | myelin-Q2 |
| R5 | `Identity.type: "operator"` (string literal value) | `"hub"` | code + prose | myelin-Q2 |
| R6 | envelope `source` grammar `org.agent.instance` (3–5 segments) | `{principal}.{stack}.{assistant}` (fixed 3) | schema + validator + prose | myelin-Q3 |
| R7 | `{org}` (subject grammar token) + `org` (code parameter / variable name) | `{principal}` / `principal` | code + grammar + prose | cortex-Q3 (myelin owns grammar) |
| R8 | `"Reach"` column header | `"Scope"` | prose | cortex-Q10 |
| R9 | `@{principal}` (subject segment) | `@{assistant}` | grammar + prose + code comments | cortex-Q5 |
| R10 | `"principal address"` prose | `"assistant address"` | prose | cortex-Q5 |
| R11 | `Broadcast` (dispatch mode name) | `Offer` | prose + code comments | cortex-Q13b |
| R12 | `operator` prose where it means the human / org | `principal` or `network` (context-dependent) | prose | cortex-Q2 + myelin-Q2 |

Renames not made by this manifest:
- `originator.principal` ⇒ `originator.identity` (this is R2 — the field rename applies to **every** envelope field whose value is a DID-style identifier)
- NSC operator account terminology (`OP_ANDREAS`, `nsc`-CLI "operator") — that is NATS infra terminology, *not* the cortex `operator`-the-human concept. Leave unchanged.
- Legacy `mf.net-{operator}.*` references in `docs/migration-from-legacy-nats.md` — historical content describing the pre-myelin subject shape. Leave unchanged; that doc is a record of what was migrated *from*.

---

## Per-file changes

### `src/identity/types.ts`

This file is the source-of-truth for the renamed interface + field. Touch this first; everything else cascades.

- **R1 + R3 + R4 + R5** — the interface definition:
  - L4 `export type PrincipalType = "agent" | "service" | "operator";` → `export type IdentityType = "agent" | "service" | "hub";`
  - L6 `export interface Principal {` → `export interface Identity {`
  - L9 `  operator: string;` → `  network: string;`
  - L11 `  type: PrincipalType;` → `  type: IdentityType;`
- **R2** — `SignedBy.principal` field on stamps:
  - L75 `  principal?: Principal;` → `  identity?: Identity;`
  - L86 `      principal: Principal;` → `      identity: Identity;`

### `src/identity/registry.ts`

- **R1** (16 hits) — every `Principal` type identifier becomes `Identity`:
  - L4 `import type { Principal } from "./types";` → `import type { Identity } from "./types";`
  - L8 `  resolve(did: string): Principal | null;` → `Identity | null;`
  - L9 `  list(): Principal[];` → `Identity[];`
  - L10 `  trustedHubs(): Principal[];` → `Identity[];`
  - L11 `  add(principal: Principal): void;` → `add(identity: Identity): void;` (parameter name also renamed for consistency)
  - L16 `  principals: Principal[];` → `  identities: Identity[];` (field of the registry — see R2 note below)
  - L21 `  protected store: Map<string, Principal>;` → `Map<string, Identity>;`
  - L24 `  constructor(principals: Principal[] = [], trustedHubDids: string[] = []) {` → `constructor(identities: Identity[] = [], ...) {`
  - L29 `  resolve(did: string): Principal | null {` → `Identity | null {`
  - L33 `  list(): Principal[] {` → `Identity[] {`
  - L37 `  trustedHubs(): Principal[] {` → `Identity[] {`
  - L43 `  add(principal: Principal): void {` → `add(identity: Identity): void {`
  - L49 `  override add(_principal: Principal): never {` → `override add(_identity: Identity): never {`
- **R4** — operator field validator:
  - L79 `  if (typeof pr.operator !== "string" || pr.operator.length === 0) {` → `pr.network !== "string" || pr.network.length === 0)`
  - L80 `    throw new Error(\`principals[${index}].operator: required non-empty string\`);` → `\`identities[${index}].network: required non-empty string\``
- **R5** — type-value validator:
  - L65 `const VALID_TYPES = new Set<string>(["agent", "service", "operator"]);` → `new Set<string>(["agent", "service", "hub"]);`
  - L83 `    throw new Error(\`principals[${index}].type: must be "agent", "service", or "operator", got "${String(pr.type)}"\`);` → `\`identities[${index}].type: must be "agent", "service", or "hub", got "${...}"\``

Note (R2/registry): the registry constructor + field `principals` is plural-of-Principal-the-interface. After rename, it becomes `identities: Identity[]` — both type AND field-name renamed for consistency. External callers passing `{principals: […]}` to the constructor will break — they must rename the keyword arg. Worth a back-compat shim (`principals` as deprecated alias) for one minor version. See "Roll-out" below.

### `src/identity/index.ts`

- **R1 + R3** — re-exports:
  - L4 `  Principal,` → `  Identity,`
  - L5 `  PrincipalType,` → `  IdentityType,`

### `src/identity/verify.ts`

- **R1** — type uses:
  - L4 `  Principal,` (import) → `  Identity,`
  - L152 `  principal: Principal,` (parameter) → `  identity: Identity,`
  - L202 `  principal: Principal,` (parameter) → `  identity: Identity,`
  - L284 `): Promise<Principal> {` → `Promise<Identity> {`
- **R3** — PrincipalType uses:
  - L5 `  PrincipalType,` (import) → `  IdentityType,`
  - L266 `  mustIncludePrincipalType?: PrincipalType;` → `mustIncludeIdentityType?: IdentityType;` (NB: the option *key* name also renames — affects callers)
  - L305 `  if (options?.mustIncludePrincipalType !== undefined) {` → `options?.mustIncludeIdentityType`
  - L306 `    const type = options.mustIncludePrincipalType;` → `options.mustIncludeIdentityType`
- **R2** — `.principal` field accesses (verify-result + chain stamps):
  - L77 `        reason: \`stamp[${i}] (${stamp.principal}): ${verdict.reason ?? "unknown failure"}\`,` → `${stamp.identity}`
  - L92 `    principal: last.principal!,` → `identity: last.identity!,` (result-builder)
  - L107 `  const principalDid = stamp.principal;` → `const identityDid = stamp.identity;` (variable name follows)
  - L307 `    if (!chain.some((v) => v.principal?.type === type)) {` → `v.identity?.type === type`
  - L315 `    if (!chain.some((v) => v.principal?.id === did)) {` → `v.identity?.id === did`
  - L321 `  return result.principal;` → `return result.identity;`

### `src/identity/chain.ts`

- **R2**:
  - L70 `  return chain.at(-1)?.principal;` → `chain.at(-1)?.identity;`

### `src/identity/chain.test.ts`

- **R1** — Partial<Principal> uses:
  - L15 `import type { Principal } from "./types";` → `Identity`
  - L37 `function makePrincipal(id: string, publicKey: string, overrides: Partial<Principal> = {}): Principal {` → `makeIdentity(... Partial<Identity> = {}): Identity {` (and rename the helper)
- **R2** — `signed_by[i].principal` assertions:
  - L85 `    expect(normalized.signed_by![0].principal).toBe("did:mf:echo");` → `.signed_by![0].identity`
  - L148 `    expect(result.errors.some((e) => e.field === "signed_by[1].principal")).toBe(true);` → `"signed_by[1].identity"` (validator-error string also renames — see `src/envelope.ts:343`)
  - L192 `    expect(signed.signed_by![0].principal).toBe("did:mf:echo");` → `.identity`
  - L204 `    expect(second.signed_by![1].principal).toBe("did:mf:luna");` → `.identity`
  - L238 `      expect(result.chain[0].principal!.id).toBe("did:mf:echo");` → `.identity!.id`
  - L239 `      expect(result.chain[1].principal!.id).toBe("did:mf:luna");` → `.identity!.id`
  - L241 `      expect(result.principal.id).toBe("did:mf:luna");` → `result.identity.id`
  - L510 `    expect(chain[0].principal).toBe("did:mf:echo");` → `chain[0].identity`
- **R5** — `type: "operator"` test fixtures:
  - L342 `      makePrincipal("did:mf:hub.metafactory", k2.publicKey, { type: "operator", is_hub: true }),` → `type: "hub"` (and rename helper to `makeIdentity`)
  - L373 `  it("accepts mustIncludePrincipalType when present", async () => {` → `mustIncludeIdentityType`
  - L376 `      requireVerifiedIdentity(envelope, registry, { mustIncludePrincipalType: "operator" }),` → `mustIncludeIdentityType: "hub"`
  - L380 `  it("rejects mustIncludePrincipalType when absent", async () => {` → `mustIncludeIdentityType`
  - L383 `      requireVerifiedIdentity(envelope, registry, { mustIncludePrincipalType: "service" }),` → `mustIncludeIdentityType`

### `src/identity/registry.test.ts`

- **R1**:
  - L4 `import type { Principal } from "./types";` → `Identity`
  - L9 `function makePrincipal(overrides: Partial<Principal> = {}): Principal {` → `makeIdentity(... Partial<Identity> = {}): Identity {`
- **R5**:
  - L47 `    const hub = makePrincipal({ id: "did:mf:hub.metafactory", type: "operator", is_hub: true });` → `makeIdentity({ ..., type: "hub", is_hub: true })`
  - L88 `    const hub = makePrincipal({ id: "did:mf:hub", type: "operator", is_hub: true });` → `makeIdentity({ ..., type: "hub", ... })`

### `src/identity/verify.test.ts`

- **R1**:
  - L9 `import type { Principal } from "./types";` → `Identity`
  - L31 `function makePrincipal(publicKey: string, overrides: Partial<Principal> = {}): Principal {` → `makeIdentity(... Partial<Identity> = {}): Identity {`
- **R2**:
  - L54 `      expect(result.principal.id).toBe("did:mf:echo");` → `result.identity.id`
- **R5**:
  - L149 `      type: "operator",` → `type: "hub",`

### `src/identity/types.test.ts`

- **R1**:
  - L4 `import {` then `  Principal,` (block import) → `  Identity,`
  - L10 `  it("Principal type accepts valid agent", () => {` → `it("Identity type accepts valid agent", …)`
  - L11 `    const p: Principal = {` → `const p: Identity = {`
  - L23 `  it("Principal accepts hub flag", () => {` → `it("Identity accepts hub flag", …)`
  - L24 `    const p: Principal = {` → `const p: Identity = {`
- **R5**:
  - L28 `      type: "operator",` → `type: "hub",`
- **R10** (comment):
  - L103 `  // The wire-format encoding for principal-addressed task subjects collapses` → `assistant-addressed`

### `src/identity/integration.test.ts`

- **R2**:
  - L55 `      expect(verifyResult.principal.id).toBe("did:mf:echo");` → `verifyResult.identity.id`
  - L105 `      expect(echoResult.principal.id).toBe("did:mf:echo");` → `echoResult.identity.id`
  - L113 `      expect(lunaResult.principal.id).toBe("did:mf:luna");` → `lunaResult.identity.id`

### `src/identity/sign.test.ts`

- **R2**:
  - L44 `    expect(signed.signed_by![0].principal).toBe("did:mf:echo");` → `.identity`
  - L78 `    expect(second.signed_by![1].principal).toBe("did:mf:echo");` → `.identity`

### `src/envelope.ts`

- **R2** — validator field names + accessor:
  - L342 `  if (typeof sb.principal !== 'string' || !DID_RE.test(sb.principal)) {` → `sb.identity !== 'string' || !DID_RE.test(sb.identity)`
  - L343 `    errors.push({ field: \`${path}.principal\`, message: 'must be a DID string (did:mf:<name>)' });` → `\`${path}.identity\`` (validator-error key — note tests in `src/envelope.test.ts:621` + `src/identity/chain.test.ts:148` rely on the string `"signed_by.principal"` / `"signed_by[1].principal"` and must rename in lockstep)
  - L459 `  if (typeof value.principal !== 'string' || !DID_RE.test(value.principal)) {` → `value.identity !== 'string' || !DID_RE.test(value.identity)` (this is `originator.principal` validator)
  - L460 `    errors.push({ field: 'originator.principal', message: 'must be a DID string (did:mf:<name>)' });` → `'originator.identity'`
  - L479 ` * Returns \`envelope.originator.principal\` when set; otherwise falls back` (doc comment) → `.identity`
  - L488 `  if (envelope.originator?.principal) return envelope.originator.principal;` → `.identity`
  - L490 `  return chain[0]?.principal;` → `chain[0]?.identity`
- **R6** — source-field validator:
  - L100 `    errors.push({ field: 'source', message: 'must match org.agent.instance pattern (3-5 segments, lowercase)' });` → `'must match {principal}.{stack}.{assistant} pattern (3 fixed segments, lowercase)'` (and the regex itself — see `src/envelope.ts:96-99` ish; if there's a regex constant, it gets retightened to 3 segments)
- **R7** — comments referencing `{org}`:
  - L518 ` * segment between \`{org}\` and \`{type}\` (myelin#113 — IAW Phase A.5). When` → `{principal}` and `{type}`
  - L520 ` * default-derive that to \`{org}.default.>\` per \`specs/namespace.md\`` → `{principal}.default.>`

### `src/envelope.test.ts`

- **R2**:
  - L621 `    expect(result.errors.some(e => e.field === 'signed_by.principal')).toBe(true);` → `'signed_by.identity'`
  - L678 `    expect(env.signed_by![0].principal).toBe('did:mf:test-bot');` → `.identity`
  - L718 `      expect(result.principal.id).toBe('did:mf:test-bot');` → `result.identity.id` (chain-verify result)
  - L999 `    expect(r.errors.some(e => e.field === 'originator.principal')).toBe(true);` → `'originator.identity'`
  - L1008 `    expect(r.errors.some(e => e.field === 'originator.principal')).toBe(true);` → `'originator.identity'`
  - L1051 `  it('returns originator.principal when set', () => {` (test name) → `'returns originator.identity when set'`
  - L1069 `  it('prefers originator.principal over signed_by[0] when both present', async () => {` → `originator.identity over signed_by[0].identity`
- **R4 + R12 (NSC operator vs human)** — these test fixtures use `operator:` as a *prose-only* key meaning the NSC operator account, not Identity.operator. Leave unless we want to clarify:
  - L704 `      operator: 'OP_TEST',` — appears to be a test fixture; if it's not consuming a real Identity.operator field, leave; if it IS, rename to `network: 'OP_TEST'`. Verify by reading L700–720 in PR.
  - L1099 `      operator: 'OP_META',` — same.
- **R2** (originator):
  - L969 `      originator: { principal: 'did:mf:operator', attribution: 'adapter-resolved' },` → `{ identity: 'did:mf:operator', ...}` (DID value also probably want `did:mf:principal` for clarity — but stays as a unit-test fixture)
  - L991 `    const r = validateEnvelope({ ...baseEnv, originator: 'did:mf:operator' });` (negative test — bare string instead of object) → leave structure, optionally rename the DID

### `src/sovereignty/validators/ingress.ts`

- **R2**:
  - L60 `      reason: "envelope is unsigned (no signed_by.principal)",` → `"envelope is unsigned (no signed_by.identity)"`

### `src/sovereignty/validators/chain.ts`

- **R2**:
  - L65 `    const principal = chain[i].principal;` → `const identity = chain[i].identity;` (and the variable name follows; uses of `principal` in this function body — check L65–80 — rename to `identity`)

### `src/sovereignty/engine.test.ts`

- **R2**:
  - L130 `    expect(e.principal).toBeUndefined();` → `e.identity` (`e` is an envelope-like with a principal field that holds an identity DID)
  - L165 `    expect(e.principal).toBe("did:mf:echo");` → `e.identity`
  - L185 `    expect(e.principal).toBe("did:mf:rogue");` → `e.identity`

### `src/composition/types.ts`

- **R1** (comment):
  - L165 `  /** Principal that executed the step. */` → `/** Identity that executed the step. */`

### `src/composition/orchestrator.ts`

- **R2**:
  - L946 `        ...(failed.principal ? { agent_principal: failed.principal } : {}),` → `failed.identity` (and possibly `agent_identity:` for the key, if that's an envelope payload key — verify with myelin owner; the *outgoing* envelope shape may stay `agent_principal` if it's a fixed wire field, OR rename to `agent_identity`)
  - L972 `          ...(completed.principal ? { agent_principal: completed.principal } : {}),` → same call-site
  - L988 `      ...(completed.principal ? { agent_principal: completed.principal } : {}),` → same

### `src/composition/integration.test.ts`

- **R7** (comment):
  - L111 ` * each event on \`local.{org}.dispatch.{event}\` and a single` → `local.{principal}.dispatch.{event}`

### `src/agent-identity/types.ts`

- **R1**:
  - L2 `import type { Principal } from "../identity/types";` → `Identity`
  - L14 ` *   - Principal via toPrincipal() — public-only fragment for registry` → `Identity via toIdentity()` (also renames the function — see helpers.ts)
  - L79 `export type { SigningIdentity, Principal };` → `Identity`

### `src/agent-identity/helpers.ts`

- **R1**:
  - L2 `import type { Principal, SigningIdentity } from "../identity/types";` → `Identity`
  - L19 ` * The Principal grammar requires \`is_hub\`. AgentIdentity is for` → `The Identity grammar requires`
  - L23 `export function toPrincipal(identity: AgentIdentity, options: { is_hub?: boolean } = {}): Principal {` → `export function toIdentity(...): Identity {` (and rename function — affects callers)

### `src/agent-identity/agent-identity.test.ts`

- **R1** (test name + comment):
  - L423 `  it("returns a public-only Principal — never includes private key", async () => {` → `"returns a public-only Identity — never includes private key"`

### `src/subjects.ts`

This file is the **wire-grammar core** — heaviest comment + code rename for R7 (`{org}` token + `org` parameter name).

- **R7** — `org` parameter / variable:
  - Renaming the `org` parameter to `principal` in every exported function. Each function in `subjects.ts` takes `(classification, org, type, stack)` or variants — rename `org` → `principal` throughout. Affects every call site in the repo (and every downstream consumer — see "Roll-out").
  - L171 `  return \`local.${org}.${stackInfix(stack)}tasks.${capability}.>\`;` → `local.${principal}.…`
  - L199 `  return \`local.${org}.${stackInfix(stack)}tasks.${encodeDidSegment(did)}.>\`;` → `local.${principal}.…`
  - L257 `  return \`local.${org}.${stackInfix(stack)}tasks.${capability}\`;` → `local.${principal}.…`
  - L295 `  return \`local.${org}.${stackInfix(stack)}code.pr.${kind}.${status}\`;` → `local.${principal}.…`
  - L395 `  return \`local.${org}.${stackInfix(stack)}code.pr.${kind}.>\`;` → `local.${principal}.…`
  - L426 `    return \`${classification}.${org}.${type}\`;` → `${classification}.${principal}.${type}`
  - L435 `  return \`${classification}.${org}.${stack}.${type}\`;` → `${classification}.${principal}.${stack}.${type}`
  - L636 (the legacy-default-derivation rule comment) → update `{org}` → `{principal}`
- **R7** — `{org}` in comments (12 hits):
  - L63, 103, 114, 125, 130, 145, 177, 205, 226, 266, 301, 409, 412, 501, 502, 588, 606 → each `{org}` token in a doc-comment becomes `{principal}`
- **R9 + R10** (comments referencing principal-addressed segments):
  - L63 ` * \`local.{org}.{stack}.tasks.@{principal}.{capability}\`. Source of truth for` → `@{assistant}`
  - L64 ` * the encoding rules is \`specs/namespace.md\` §"Principal encoding".` → `§"Assistant encoding"` (header in namespace.md also renames; see namespace.md row)
  - L177 ` * Direct-routing mode — \`local.{org}.tasks.@{encoded-did}.>\`. The DID is` → `local.{principal}.tasks.@{assistant}.>` — or keep `@{encoded-did}` as the lower-level encoding shape
- **R12** — `operator` prose in subjects.ts: search for any `operator` mentions in comments (none in this grep output for subjects.ts, but verify with a targeted grep before PR).

### `src/subjects.test.ts`

- **R7** (comments):
  - L172 `// the worked examples in \`specs/namespace.md\` §"Principal encoding". The` → `§"Assistant encoding"` (R9)
  - L255 `// (\`local.{org}.{stack}.tasks.{capability}.>\`).` → `local.{principal}.…`
  - L294 `// = \`local.{org}.tasks.code-review.>\`. The \`.typescript\` token fills` → `local.{principal}.…`
  - L286 `// per the spec (\`specs/namespace.md\` Direct/Broadcast section); it lets` → `Direct/Offer section` (R11)
  - L386 `    // Broadcast-reachable stack-aware (6-segment subject; pairs with` → `Offer-reachable` (R11)
  - L415, 787 — additional `{org}` in comments

### `src/bidding/index.ts`

- **R7** (comments):
  - L17 ` *      / \`bid-retry\` / \`bid-assigned\`) on \`local.{org}.dispatch.bid.>\`.` → `local.{principal}.…`
  - L32 ` *   - \`local.{org}.tasks.bid-request.{capability}\` — broadcast request` → `local.{principal}.…` + "offer request" (R11)
  - L33 ` *   - \`local.{org}.tasks.@{principal}.{capability}\` — direct-address` → `@{assistant}` (R9)
  - L35 ` *   - \`local.{org}.dispatch.bid.>\` — bidding lifecycle (NOT` → `local.{principal}.…`

### `src/bidding/subjects.ts`

- **R7**:
  - L5 `    throw new Error(\`bidding subject: invalid org '${org}' — must match ${ORG_RE}\`);` → `principal '${principal}' — must match ${PRINCIPAL_RE}` (regex constant also renames if owned here)
  - L24 `  return \`local.${org}.tasks.bid-request.${capability}\`;` → `local.${principal}.…`
  - L33 `  return \`local.${org}.tasks.@${encodePrincipalForSubject(principal)}.${capability}\`;` → `local.${principal}.tasks.@${encodeAssistantForSubject(assistant)}.${capability}` — the **function name** `encodePrincipalForSubject` itself renames to `encodeAssistantForSubject` (R9). Verify against `encodeDidSegment` (myelin#138) — possible duplication; consolidate.
  - L37–38 comments: `Bidding lifecycle events live under \`local.{org}.dispatch.bid.{event}\`, NOT \`local.{org}.dispatch.task.{event}\`.` → `local.{principal}.…` (both lines)
  - L49 `  return \`local.${org}.dispatch.bid.${event}\`;` → `local.${principal}.…`
- **R9** (comment):
  - L16 `  // Mirror tasks.@{principal} encoding from F-019: ':' → '-', '.' → '--'.` → `tasks.@{assistant}`

### `src/bidding/subjects.test.ts`

- **R7** (comment):
  - L9 `  it("builds local.{org}.tasks.bid-request.{capability}", () => {` (test name) → `local.{principal}.…`

### `src/bidding/publisher.ts`

- **R7** + **R11**:
  - L28 `   * on \`local.{org}.dispatch.task.failed\` whenever a round terminates` → `local.{principal}.…`
  - L129 `   *   1. Broadcast bid request on \`local.{org}.tasks.bid-request.{capability}\`.` → `Offer` (R11) + `local.{principal}.…`
  - L399 `          \`local.${org}.dispatch.task.failed\`,` (template literal — if `org` is a parameter, it's R7 code rename)

### `src/bidding/response.ts`

- **R2**:
  - L94 `  if (bid.bidder !== bid.signed_by.principal) {` → `bid.signed_by.identity`
  - L95 `    return { valid: false, reason: \`bidder/principal mismatch: ${bid.bidder} vs ${bid.signed_by.principal}\` };` → `bidder/identity mismatch` + `${bid.signed_by.identity}`

### `src/bidding/response.test.ts`

- **R2**:
  - L28 `    expect(bid.signed_by.principal).toBe("did:mf:luna");` → `bid.signed_by.identity`

### `src/bidding/types.ts`

- **R7** (comments):
  - L39–40 ` * \`local.{org}.dispatch.bid.>\` does not overlap with F-020 dispatch lifecycle's \`local.{org}.dispatch.task.>\` (which has its own \`assigned\` state).` → both lines `local.{principal}.…`

### `src/bidding/agent.ts`

- **R7** (comment):
  - L78 ` * On \`start()\`, subscribes to \`local.{org}.tasks.bid-request.{capability}\`` → `local.{principal}.…`

### `src/discovery/discovery.test.ts`

- **R2**:
  - L59 `    expect(reg.signed_by.principal).toBe("did:mf:luna");` → `reg.signed_by.identity`
  - L117 `    // Tamper: swap signed_by.principal` → `signed_by.identity`
  - L118 `    const tampered = { ...reg, signed_by: { ...reg.signed_by, principal: "did:mf:fern" } };` → `identity: "did:mf:fern"`
  - L191 `    expect(all.map((r) => r.advertisement.principal).sort()).toEqual(["did:mf:fern", "did:mf:luna"]);` → `r.advertisement.identity`

### `src/discovery/register.ts`

- **R2** — `advertisement.principal` field rename (R2 applies — advertisement.principal IS an identity DID):
  - L24 ` *   - advertisement.principal matches identity.did (no spoofing)` → `advertisement.identity matches identity.did`
  - L33 `  if (!DID_RE.test(advertisement.principal)) {` → `advertisement.identity`
  - L34 `    throw new Error(\`signCapabilityRegistration: invalid DID '${advertisement.principal}'\`);` → `advertisement.identity`
  - L36 `  if (advertisement.principal !== identity.did) {` → `advertisement.identity`
  - L38 `      \`signCapabilityRegistration: advertisement.principal (${advertisement.principal}) must match identity.did (${identity.did})\`,` → `advertisement.identity (${advertisement.identity})`
  - L96 `  if (existing.advertisement.principal !== identity.did) {` → `existing.advertisement.identity`
  - L97 `    throw new Error(\`updateLoad: identity ${identity.did} cannot update registration for ${existing.advertisement.principal}\`);` → `existing.advertisement.identity`

### `src/discovery/verify.ts`

- **R2**:
  - L11 ` *   1. signed_by.principal matches advertisement.principal (anti-spoof)` → both `.identity`
  - L23 `  if (signed_by.principal !== advertisement.principal) {` → both `.identity`
  - L26 `      reason: \`principal mismatch: signed_by=${signed_by.principal} advertisement=${advertisement.principal}\`,` → `identity mismatch: signed_by=${signed_by.identity} advertisement=${advertisement.identity}`
  - L30 `  const principal = registry.resolve(advertisement.principal);` → `const identity = registry.resolve(advertisement.identity);`
  - L32 `    return { status: "rejected", reason: \`unknown principal: ${advertisement.principal}\` };` → `unknown identity: ${advertisement.identity}`
  - L49 `    return { status: "rejected", reason: \`invalid public_key encoding for ${advertisement.principal}\` };` → `${advertisement.identity}`
  - L70 `  return { status: "verified", principal: advertisement.principal, advertisement };` → `identity: advertisement.identity`

### `src/discovery/memory-store.ts`

- **R2**:
  - L24 ` *   - put / get / delete keyed by advertisement.principal` → `advertisement.identity`
  - L40 `    const key = registration.advertisement.principal;` → `registration.advertisement.identity`

### `src/discovery/discovery.ts` (and all other discovery files that reference `advertisement.principal` not captured above)

A follow-up `rg 'advertisement\.principal' src/discovery/` pass during PR — every hit renames to `advertisement.identity`.

### `src/transport/envelope.ts`

- **R7** (comments):
  - L29 `   * Operator stack segment slotted between \`{org}\` and \`{type}\` on the` → `{principal}` (and possibly "Operator" → "Principal" in the prose)
  - L106 `    // 6-segment grammar \`local.{org}.{stack}.{type}\` post-myelin#113.` → `local.{principal}.…`

### `src/transport/envelope.test.ts`

- **R2**:
  - L263 `    expect(env.signed_by![0].principal).toBe("did:mf:test-bot");` → `.identity`
- **R7** (comments):
  - L108 `  it("derives local subject: local.{org}.{type}", async () => {` (test name) → `local.{principal}.{type}`
  - L179–180 `// The wire-form detector heuristic cannot tell \`local.{org}.review.review.completed\` apart from \`local.{org}.review.completed\` (legacy 5-seg) without the` → both `local.{principal}.…`

### `src/transport/dead-letter.ts`

- **R7**:
  - L87 `  // Expect at least: prefix.{org}.tasks.{capability}[.{subcapability}]` → `prefix.{principal}.tasks.…`
  - L91 `      \`deriveDeadLetterSubject: unexpected subject shape '${originalSubject}' — expected '{prefix}.{org}.tasks.{capability}.*'\`,` → `'{prefix}.{principal}.tasks.{capability}.*'`

### `src/transport/dead-letter.test.ts`

- **R7 + R9** (comment):
  - L61 `    // local.{org}.tasks.@{principal}.{capability} — capability is at parts[3]` → `local.{principal}.tasks.@{assistant}.{capability}`

### `src/transport/nak.ts`

- **R7** (comment):
  - L17 `//    publishes \`dispatch.task.rejected\` on \`local.{org}.dispatch.task.rejected\`` → `local.{principal}.dispatch.task.rejected`

### `src/dispatch/lifecycle.ts`

- **R7** (comments):
  - L24 ` *     local.{org}.dispatch.task.{state}` → `local.{principal}.…`
  - L27 ` *     local.{org}.{stack}.dispatch.task.{state}` → `local.{principal}.{stack}.…`
  - L44 (template literal `return \`local.${org}.${stackInfix(stack)}dispatch.task.${state}\`;`) — code R7 (param name)
  - L56 (template literal) — code R7
- **R11** (comment table):
  - L94 ` *   | state      | Broadcast | Direct | Delegate |` → `| Offer | Direct | Delegate |`

### `src/dispatch/lifecycle.test.ts`

- **R7** (test name comment):
  - L192 `  it("received() emits to local.{org}.dispatch.task.received with full payload", async () => {` → `local.{principal}.…`

### `src/dispatch/stream.ts`

- **R7** (comments + code):
  - L15 ` *   subjects:   local.{org}.dispatch.task.>` → `local.{principal}.…`
  - L21 ` * Stream name is org-scoped (\`EVENTS_{org}\` upper-cased). JetStream` → `principal-scoped (\`EVENTS_{principal}\` upper-cased)` (NB: changing the STREAM NAME shape is a wire-affecting change — back-compat matters; see "Roll-out")
  - L36 `    subjects: [\`local.${org}.dispatch.task.>\`],` (code, param rename — R7)

### `src/dispatch/types.ts`

- **R7** (comment):
  - L10 `//     local.{org}.dispatch.task.{state}` → `local.{principal}.…`

### `src/observability/transport.ts`

- **R7** (comments + code):
  - L46 `   * subject \`local.{org}._metrics.transport.{source}\` so external` → `local.{principal}._metrics.…`
  - L174 `   * \`local.{org}._metrics.transport.>\` wildcard subscriptions.` → `local.{principal}._metrics…`
  - L183 `      throw new Error(\`metricsSubject: invalid org '${org}' — must match ${ORG_RE}\`);` → `invalid principal '${principal}' — must match ${PRINCIPAL_RE}`
  - L192 `    return \`local.${org}._metrics.transport.${safe}\`;` (code — R7 param rename)

### `src/segment-validators.ts`

- **R7** (comments):
  - L79 ` * that sits between \`local.{org}.\` and the domain (\`tasks\` / \`dispatch\` /` → `local.{principal}.`
  - L95 `   *   \`local.${org}.${stackInfix(stack)}tasks.${cap}.>\`` → `local.${principal}.…`
  - L96 `   *   //  → \`local.{org}.tasks.{cap}.>\` when stack omitted` → `local.{principal}.…`
  - L97 `   *   //  → \`local.{org}.{stack}.tasks.{cap}.>\` when supplied` → `local.{principal}.{stack}.…`

### `src/composition/orchestrator.ts` (further hits)

- **R7** (comments + code):
  - L46 ` *   \`local.{org}.tasks.{capability}\`. The envelope shares the` → `local.{principal}.…`
  - L52 ` *   to \`local.{org}.dispatch.task.completed\` and \`.failed\`. Route` → `local.{principal}.…`
  - L60 ` *   live under \`local.{org}.dispatch.workflow.{state}\`.` → `local.{principal}.…`
  - L380 `      const subject = \`local.${org}.dispatch.task.>\`;` (R7 code)
  - L519 `    const subject = \`local.${org}.tasks.${step.capability}\`;` (R7 code)

### `src/composition/lifecycle.ts`

- **R7**:
  - L4 ` * Subjects sit under \`local.{org}.dispatch.workflow.{event}\` — distinct` → `local.{principal}.…`
  - L16 `    throw new Error(\`workflow subject: invalid org '${org}'\`);` → `invalid principal '${principal}'`
  - L26 `  // Subject becomes local.{org}.dispatch.{event} since each event` → `local.{principal}.…`
  - L28 `  return \`local.${org}.dispatch.${event}\`;` (R7 code — param rename)

### `src/patterns.ts`

- **R7** (comment):
  - L25 ` * (\`local.{org}.…\`, \`federated.{org}.…\`, \`local.{org}._metrics.…\`). Must` → three `{principal}` substitutions

### `src/economics.test.ts`

- **R6 + R12** (test fixture):
  - L6 `  source: "metafactory.cortex.operator",` → `source: "metafactory.cortex.<assistant>"` — this is a test fixture for the source field. With R6 the source becomes `{principal}.{stack}.{assistant}`. The fixture value `"metafactory.cortex.operator"` (3 segments) maps to principal=metafactory, stack=cortex, assistant=operator — but "operator" as an assistant name is odd. Replace with a real assistant name, e.g. `"andreas.meta-factory.echo"`.

### `schemas/envelope.schema.json`

- **R6** — the `source` description:
  - L17 `      "description": "Origin address. Minimum 3 segments (org.agent.instance), up to 5 for domain-scoped agents (org.domain.agent.instance.replica).",` → `"Origin address. Exactly 3 segments: {principal}.{stack}.{assistant}. Format aligns with the wire subject's leading segments per specs/namespace.md."`
- **R2** — the schema definitions of `signed_by[].principal` and `originator.principal`:
  - There are property names in the JSON schema (`signed_by.items.properties.principal`, `originator.properties.principal`). These rename to `.identity`. Open the file in the PR and update every `"principal"` JSON key that holds a DID-style value. This is a **wire-schema change** — back-compat matters (see "Roll-out").

### `README.md`

- **R6** (envelope table):
  - L48 `| \`source\` | string | Origin: \`org.agent.instance\` (3-5 segments) |` → `| Origin: \`{principal}.{stack}.{assistant}\` (fixed 3 segments) |`
- **R7** (subject table):
  - L63 `| \`local.{org}.{stack}.{domain}.{entity}.{action}\` | Org only | Never leaves org boundary |` → `local.{principal}.{stack}.{domain}.{entity}.{action}` + `Never leaves principal boundary`
  - L64 `| \`federated.{org}.{stack}.{domain}.{entity}.{action}\` | Cross-org | Subject to envelope sovereignty |` → `federated.{principal}.…` + `Cross-principal`
- **R8** (column header):
  - L61 `| Prefix | Reach | Rule |` → `| Prefix | Scope | Rule |`

### `specs/namespace.md`

The grammar authority — heaviest single doc.

- **R7** — `{org}` → `{principal}` everywhere (15+ hits):
  - L28, 44, 60, 69, 88 (×2), 114, 155, 168, 175, 188, 235, 249, 250, 251, 266
- **R8** — table column header:
  - L15 `| Prefix | Reach | Sovereignty Rule |` → `| Prefix | Scope | Sovereignty Rule |`
- **R9** — `@{principal}` segment:
  - L188 `local.{org}.{stack}.tasks.@{principal}.{capability}` → `local.{principal}.{stack}.tasks.@{assistant}.{capability}` (both R7 and R9 on this line)
  - L191 `The \`@{principal}\` segment routes to a single agent by principal id.` → `The \`@{assistant}\` segment routes to a single assistant by name.` (R9 + R10 — prose rewrite, not just token swap)
  - L250 `federated.{org}.{stack}.tasks.@{principal}.{capability}` → `federated.{principal}.{stack}.tasks.@{assistant}.{capability}`
  - L374 `| \`tasks.@{principal}\` | \`target_principal\` | DID encoded per Tasks Domain rules ...` → `| \`tasks.@{assistant}\` | \`target_assistant\` | DID encoded ...` (envelope-field `target_principal` ALSO renames to `target_assistant` for consistency — wire-schema change; see "Roll-out")
- **R10** — "principal address" prose:
  - L130 `The \`@\` character is allowed as the **first character of a segment** to denote a principal address (used by the \`tasks\` domain for Direct/Delegate routing — see Tasks Domain below).` → `to denote an assistant address`
  - L159 `| \`@*\` (any segment starting with \`@\`) | Direct/Delegate principal address (see Tasks Domain) | No capability tag may start with \`@\` |` → `Direct/Delegate assistant address`
- **R11** — Broadcast:
  - L168 `… extends the standard \`{prefix}.{org}.{stack}.{domain}.*\` form with three operator-facing distribution shapes — Broadcast, Direct, Delegate — plus …` → `{principal}` (R7) + `three principal-facing distribution shapes — Offer, Direct, Delegate` (R11 + R12)
  - L172 `### Broadcast — competing consumers (open market)` → `### Offer — competing consumers (open market)`
  - L361 `The standard derivation above produces Broadcast task subjects directly:` → `produces Offer task subjects`
  - L385 `The \`distribution_mode\` envelope field (also F-021) selects between Broadcast (standard derivation, \`target_principal\` absent) and Direct/Delegate (extended derivation above).` → `between Offer (… \`target_assistant\` absent) and Direct/Delegate` (R11 + the envelope-field rename `target_principal → target_assistant` from L374)
- **R12** — operator-prose:
  - L33 `The \`{stack}\` segment scopes the signal to one of an operator's stacks` → `one of a principal's stacks`
  - L36 `\`local.acme.default.ops.deploy.completed\` — deploy notification within acme (single-stack operator)` → `single-stack principal`
  - L69 prose `The \`{stack}\` segment names a stack under the operator identified by \`{org}\`.` → `under the principal identified by \`{principal}\``

### `docs/envelope.md`

- **R6**:
  - L18 `| \`source\` | yes | string | Origin address (\`org.agent.instance\`, 3-5 segments) |` → `\`{principal}.{stack}.{assistant}\` (fixed 3 segments)`
- **R7** (subject prefixes):
  - L101 `local.{org}.{domain}.{entity}.{action}     # never leaves org boundary` → `local.{principal}.…` + `never leaves principal boundary`
  - L102 `federated.{org}.{domain}.{entity}.{action} # cross-org, sovereignty-gated` → `federated.{principal}.…` + `cross-principal`
- **R2** (originator examples):
  - L163, 170, 175, 176, 197 — `originator.principal` → `originator.identity` (verify each line in PR)
- **R11** (prose):
  - L114 `Full namespace spec — including the \`tasks\` domain extension with Broadcast / Direct / Delegate / dead-letter shapes …` → `Offer / Direct / Delegate / dead-letter`
- **R12** (prose):
  - L98, 164 — operator-prose lines, rename to `principal` per context.

### `docs/identity.md`

- **R2** (table):
  - L38 `| \`signed_by.principal\` | Verified identity | Yes — cryptographically |` → `| \`signed_by.identity\` | Verified identity | Yes |`
  - L110 `  console.log(result.principal.id);                  // "did:mf:hub.metafactory" — LAST verified principal` → `result.identity.id` + `LAST verified identity`
- **R4** + **R5** (interface example):
  - L25 `  operator: string;     // "metafactory"` → `  network: string;     // "metafactory"`
  - L27 `  type: "agent" | "service" | "operator";` → `"agent" | "service" | "hub"`
- **R5** (subsequent code examples):
  - L90 `registry.add({ id: "did:mf:hub.metafactory", operator: "metafactory", public_key: hubPubKey, type: "operator", created_at: "...", is_hub: true });` → `network: "metafactory", ..., type: "hub"`
  - L121 prose "Must be signed by an operator-type principal" → "Must be signed by a hub-type identity"
  - L126, 175 `mustIncludePrincipalType: "operator"` → `mustIncludeIdentityType: "hub"`
  - L224 sample JSON `"operator": "metafactory"` → `"network": "metafactory"`
  - L253 table row `Chain-shape predicates (\`mustIncludeRole\`, \`mustIncludePrincipalType\`, \`mustIncludePrincipal\`, \`minLength\`)` → `mustIncludeIdentityType`, `mustIncludeIdentity`
- **R12** (prose):
  - L17 `did:mf:hub.metafactory — operator hub` → `did:mf:hub.metafactory — network hub`
  - L76 `for intra-operator trust` → `for intra-network trust`
  - L89, 90 prose lines containing "operator" — review case-by-case

### `docs/sovereignty.md`

- **R2** (prose + diagram):
  - L21 `carry a \`signed_by.principal\` mapped to a known partner …` → `signed_by.identity`
  - L141 `start --> q1{envelope.signed_by.principal<br/>present?}` → `signed_by.identity` (Mermaid diagram label)
  - L192 table row references → `signed_by.identity`

### `docs/sovereignty-operator.md`

- **R2**:
  - L90, 240, 364 — `signed_by.principal` → `signed_by.identity` in three prose locations
- **R12** + **R7** (NSC subject examples):
  - L331, 332 — `federated.operator-b.tasks.>` is a test-fixture subject name. After grill: this should be `federated.principal-b.tasks.>` (the segment value is the principal slug). But this doc may be a runbook with fixed examples; if so, rename the example slug `operator-b` → `principal-b` for consistency.
  - L268 `\`federated.{org}.*\` subjects cross account boundaries` → `\`federated.{principal}.*\``

### `docs/discovery.md`

- **R2** (table + prose):
  - L38 `| \`principal\` | DID of the advertising agent. MUST match \`signed_by.principal\` (anti-spoof). |` → `| \`identity\` | DID … MUST match \`signed_by.identity\``
  - L71 `- \`advertisement.principal\` matches \`identity.did\` (no impersonation)` → `advertisement.identity`
  - L87 `  // result.principal + result.advertisement are guaranteed; no \`reason\`.` → `result.identity`
  - L94 `1. \`signed_by.principal === advertisement.principal\` (anti-spoof, fast reject)` → both `.identity`
- **R7** (prose):
  - L166 `\`local.{org}.tasks.@{principal-encoded}.{capability}\`` → `local.{principal}.tasks.@{assistant-encoded}.{capability}` (R7 + R9)
- **R12** (prose):
  - L189, 191, 196 — operator-prose → principal/network per context

### `docs/design-agent-task-routing.md`

The agent-task-routing design — heaviest **R11** doc.

- **R7** (subject examples — 12+ lines): L389–395, 440, 457–460, 479 — every `local.{org}.…` → `local.{principal}.…`
- **R9** (subject examples): L34, 439, 477 — `tasks.@{principal}.{capability}` → `tasks.@{assistant}.{capability}`
- **R11** (mode names — extensive): L33, 41, 47, 53, 371, 386 — every "Broadcast" → "Offer" (table row, prose, examples). Re-read each line in PR to verify the prose flows.
- **R12** (operator-facing/operator-intent prose): L23, 29, 39, 41, 371, 376, 395, 402, 405, 473, 479, 493 — operator-prose mentions. Each line needs a case-by-case judgment: "operator-facing" → "principal-facing" or "operator-watching" per cortex Q2; some lines may refer to NSC operator and stay.

### `docs/nak-reasons.md`

- **R7**:
  - L39 `- **Subject:** \`local.{org}.dispatch.task.rejected\`` → `local.{principal}.…`
  - L84 same

### `docs/migration-from-legacy-nats.md`

This doc is the **historical record** of the legacy → myelin subject migration. Most `{operator}` and `mf.net-{operator}.*` references in this doc describe the **legacy** format being migrated FROM. Leave them. Only update the prose that describes the *target* (myelin) format:
- Any line describing `local.*.…` / `federated.*.…` as the target — apply R7 (`{org}` → `{principal}`) and R12 (operator-prose → principal-prose) where it describes the new shape.
- Lines describing the OLD `mf.net-{operator}.*` shape — preserve verbatim.

Detailed pass during PR.

### `examples/grove-agent.ts`

- **R2**:
  - L66 `        signed_by: envelope.signed_by?.principal,` → `envelope.signed_by?.identity`
- **R7** (comment):
  - L58 `  //    from F-1 (local.{org}.grove.>).` → `local.{principal}.grove.>`

### `examples/arc-search.ts`

- **R2**:
  - L76 `      console.warn(\`  ${reg.advertisement.principal} — UNVERIFIED (${result.reason})\`);` → `reg.advertisement.identity`
  - L79 `    console.log(\`  ${reg.advertisement.principal} (load=${reg.advertisement.load})\`);` → `reg.advertisement.identity`

### `examples/pilot-job.ts`

- **R2**:
  - L61 `        principal: (env.payload as { principal?: string }).principal,` → if this is the payload field name (envelope payload key, not a wire schema field), it's a payload-internal name — choose: rename to `identity` for consistency with the rest of the rename, OR leave as application-level naming. Recommended: rename for consistency.

### `examples/README.md`

- **R7** (prose):
  - L7 `… Matches the namespace convention from F-1 (\`local.{org}.grove.>\`).` → `local.{principal}.grove.>`

### `tests/integration/sovereignty-end-to-end.test.ts`

This file uses `operator-b` as a fixture-name for a *peer principal*. Per cortex Q2 + myelin Q2, operator → principal everywhere — the fixture slug should rename too:
- L137, 377, 390, 396, 440 — every `federated.operator-b.tasks.>` → `federated.principal-b.tasks.>` (12 hits across both integration files)
- L424 `    expect(entry.principal).toBe("did:mf:echo");` → `entry.identity` (R2)
- L486 `    expect(entry.principal).toBe("did:mf:rogue");` → `entry.identity` (R2)

### `tests/integration/sovereignty-transport.test.ts`

- L143, 147, 157 — same `operator-b` → `principal-b` rename as above

### `src/composition/types.ts` (Step receipts)

(Already covered above — L165 comment).

### `src/index.ts` (top-level re-exports)

- **R1 + R3**:
  - L106 `  Principal,` → `  Identity,`
  - L107 `  PrincipalType,` → `  IdentityType,`

---

## Roll-out strategy

The renames split into three risk tiers:

### Tier 1 — pure renames (low risk, do first)

R7 grammar comments + docs, R8, R11, R12 prose, R1 internal-only types, R3 internal-only types.

- All within-package renames; no wire-schema or external-contract changes.
- One PR per file cluster (e.g. `src/identity/*`, `src/subjects.ts + tests`, `specs/namespace.md`, `docs/*`).
- Each PR: do every change in this manifest under its rename group(s), run `bunx tsc --noEmit && bun test`, open for review.

### Tier 2 — schema-affecting renames (medium risk, with back-compat)

R2 (`signed_by[].principal` → `.identity`), R4 (`Identity.operator` → `.network`), R5 (`type: "operator"` → `"hub"`), R6 (envelope `source` grammar).

These change the **envelope schema** (`schemas/envelope.schema.json`) + the registry config shape (`{principals: […]}` constructor arg). Consumers (cortex, pilot, signal) read these — wire-breaking.

- Land a transitional myelin minor: accept BOTH old and new field names on read; emit ONLY the new on write. Add a deprecation warning on read of the old. One release cycle.
- Land a follow-up myelin major: remove the read-side back-compat. Consumers must have migrated.
- Schedule: ~2 weeks between the transitional and breaking releases.

### Tier 3 — wire-grammar token rename (high risk, ecosystem-wide)

R7 code (the `org` → `principal` parameter rename in `src/subjects.ts`, `src/transport/envelope.ts`, every `subjects.ts` helper that builds a subject). R9 (envelope field `target_principal` → `target_assistant`).

These affect every consumer that calls `deriveSubject(...)` or reads `target_principal` from a task envelope.

- Land the variable rename in myelin as a **breaking minor** with a re-export of the old parameter name shape if feasible.
- Coordinate with cortex / pilot / signal migration PRs to land in lockstep.
- This is the riskiest single change; warrants an ADR (`docs/adr/0002-rename-org-segment-to-principal.md`) recording the decision + the migration timeline.

---

## What this manifest does NOT cover

- `mf.net-{operator}.*` legacy-format references in `docs/migration-from-legacy-nats.md` — historical, preserved.
- NSC CLI operator terminology (`OP_ANDREAS`, `nsc operator`) — this is NATS infra, not the cortex `operator` concept.
- The `network-registry` service in cortex (`src/services/network-registry/`) — that service handles network-level operator registrations; its internal `operator` terminology is NATS-aligned and stays. (But: the field names it exposes that participate in cortex.yaml may need their own pass — that's a cortex-side manifest concern, not myelin's.)
- New tests for the renamed shapes. Each Tier-2/Tier-3 PR adds tests for the new field names + retains a regression test for the back-compat read.

---

## Per-PR checklist (template)

For each PR:

- [ ] Pull latest main
- [ ] Apply every change in this manifest under the PR's scope
- [ ] `bunx tsc --noEmit` clean
- [ ] `bun test` green (full suite, not just the file touched)
- [ ] Update `CHANGELOG.md` with the rename (Tier 2/3 PRs only — Tier 1 is internal)
- [ ] If the PR touches `schemas/envelope.schema.json`, bump the schema `$id` minor (Tier 2) or major (Tier 3) and write the back-compat note
- [ ] Cross-link the cortex/pilot/signal companion PRs in the body
- [ ] Reference this manifest path in the PR body
- [ ] Tag JC (jcfischer) on the Tier-2/Tier-3 PRs
