# Decision memo — myelin registry publishing (H1)

**Status:** DECISION NEEDED (human). Draft per remediation task H1. Nothing published.

## The problem

`@the-metafactory/myelin` is not published to any registry. All six consumers
pin it by a raw 40-char git SHA in `package.json`:

| Consumer | Pinned SHA | Corresponds to |
|---|---|---|
| cortex | `f5ec865…` | v0.4.0 cut |
| pilot | `f5ec865…` | v0.4.0 cut |
| sage | `9fc8476…` | (older) |
| grove | `2cdf3b0…` | (older) |
| cedar | `2cdf3b0…` | (older) |
| reflex | `2a5f1be…` | (older) |

Consequences:
- **Hand-edited SHAs** — every bump is a manual 40-char paste; no human can read
  "which version" from a `package.json` diff.
- **Silent skew** — four of six consumers lag the v0.4.0 cut across at least one
  breaking minor, invisible until validation hard-fails.
- **Transitive coupling** — pilot's effective myelin version is entangled with
  cortex's because they resolve through the same install graph; a bump in one
  can surprise the other.

Now that tags exist (`v0.2.0`, `v0.4.0`, per F3/RELEASING.md), a real
distribution channel is finally an option.

## Options

### A. Status quo — git tags, SHA pins
Keep pinning, but pin to **tags** (`…/myelin.git#v0.4.0`) instead of SHAs.
- **+** Zero infra; works today; readable diffs.
- **−** Still no integrity/immutability guarantees a registry gives; private-repo
  install needs git auth on every consumer/CI; no dep-graph tooling.

### B. GitHub Packages under `@the-metafactory` (recommended)
Publish to GitHub's npm registry, scoped `@the-metafactory`.
- **+** Native to the existing GitHub org + auth; scoped private packages;
  immutable versions; `package.json` reads `"@the-metafactory/myelin": "0.4.0"`;
  Dependabot/version tooling works.
- **−** Consumers need an `.npmrc` registry line + a GH token in CI; one-time
  publish step added to RELEASING.md.

### C. npm public registry
Publish public to npmjs.com.
- **+** Simplest consumer install; best tooling.
- **−** Makes the protocol library **public** — a policy decision, not just infra.
  Premature pre-1.0 while the wire format still churns.

## Recommendation

**B (GitHub Packages) with A (tags) as the fallback.** It fits the org's existing
auth, keeps the library private, gives immutable readable versions, and kills the
SHA-paste ritual. Add the publish step to `RELEASING.md`; add the `.npmrc`
registry line to each consumer as part of the next G1 pin-bump.

## What this memo does NOT do

Publish anything, change any `package.json`, or add an `.npmrc`. Human decides A/B/C
first. If B: someone with org-admin enables GitHub Packages and provisions the CI
token before the next release.
