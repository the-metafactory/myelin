# Contributing to myelin

Myelin is the protocol stack the metafactory ecosystem runs on. It is a
Bun/TypeScript library; there is no build step for development.

## Dev setup

```bash
bun install          # install dependencies
bun test             # full unit suite (integration tests skip without NATS)
bunx tsc --noEmit    # typecheck
bun run lint         # eslint (strict typed baseline)
```

All four must pass before you open a PR.

### Integration tests

The unit suite skips integration tests unless `NATS_URL` is set. To run them
locally against a real JetStream broker:

```bash
docker compose -f docker-compose.test.yml up -d --wait   # --wait blocks until healthy
NATS_URL=nats://localhost:4222 bun test tests/integration
docker compose -f docker-compose.test.yml down
```

`--wait` holds until the broker's healthcheck passes, so the tests don't race a
not-yet-bound port. Without `NATS_URL`, `bun test` stays green on a machine
without docker — every `tests/integration/` test self-skips.

> CI runs the equivalent check a different way — `integration.yml` starts NATS
> via `docker run` on host port `4223` (`NATS_URL=nats://localhost:4223`). The
> compose recipe above is the local convenience path; the broker image and flags
> match, only the launch mechanism and port differ.

## Pull request rules

- **One logical change per PR.** Keep diffs reviewable.
- **Conventional commits.** Prefix with `feat:`, `fix:`, `docs:`, `chore:`,
  `ci:`, `refactor:`, etc. The subject should name what changed.
- **Doc-update obligation.** Any change that adds, removes, or alters a layer's
  contract MUST update `docs/architecture.md` in the same PR (architecture.md
  §6, "Each layer's contract change requires a doc update"). A CI guard
  (`scripts/check-architecture-coverage.ts`) fails the build if a top-level
  `src/` module is missing from the architecture doc.
- **CODEOWNERS review.** PRs require review per `CODEOWNERS`. Signature-adjacent
  changes (`src/identity/canonicalize.ts` `SIGNABLE_FIELDS`, the envelope schema
  `required`/`additionalProperties`) get extra scrutiny — call them out
  explicitly in the PR description.
- **Green gate.** `bun test`, `bunx tsc --noEmit`, `bun run lint`, and `bun run typecheck:identity-strict` (the identity submodule under `noUncheckedIndexedAccess`, which CI also runs) must pass;
  paste their tails into the PR description.

## Vocabulary rules

Myelin's field names are the signed bytes — a rename is a wire-breaking change.
`CONTEXT.md` is the canonical glossary of domain terms (Identity, principal,
network, stamp, sovereignty, classification, …).

- Use the exact term from `CONTEXT.md`; don't reintroduce retired names
  (e.g. `operator`/`org` → `network`; `Principal` → `Identity` in code).
- A new domain term needs a `CONTEXT.md` entry in the same PR that introduces it.
- Deprecating a term goes through the migration doctrine in
  `docs/migrations/` (verifiers-before-emitters for adds; emitters-before-
  verifiers for window closures).

## Security

Do not open public issues for security bugs — see `SECURITY.md` for the private
reporting channel.
