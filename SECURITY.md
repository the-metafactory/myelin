# Security Policy

Myelin is a cryptographic trust library — Ed25519 envelope signing, a
`signed_by` chain-of-stamps, key rotation, and sovereignty enforcement. Bugs in
these paths are security bugs. This document says what we support and how to
report a vulnerability.

## Supported versions

Myelin is pre-1.0. Only the **current minor** receives security fixes; there are
no long-term-support branches yet.

| Version | Supported |
|---|---|
| current minor (`0.4.x`) | ✅ |
| any older minor | ❌ — upgrade to the current minor |

Pre-1.0, a minor bump can be breaking (see `RELEASING.md`); consumers should
never be more than one breaking minor behind.

## Reporting a vulnerability

**Do not open a public issue for a security bug.**

Use **GitHub private vulnerability reporting**: go to the repository's
[Security tab](https://github.com/the-metafactory/myelin/security) →
**Report a vulnerability**. This opens a private advisory visible only to
maintainers.

Please include: affected version/commit, a minimal reproduction, and the impact
you believe it has (signature bypass, canonicalization mismatch, sovereignty
escape, etc.).

### Response expectation

Best effort, pre-1.0. There is no paid bounty and no contractual SLA. We aim to
acknowledge a report, confirm or dispute it, and — for a confirmed issue — ship a
fix on the current minor and credit the reporter in the release notes (unless
you ask otherwise).

## Security surfaces

These are the parts of myelin where a bug is a security bug, not just a
correctness bug:

- **Signature verification** — `src/identity/verify.ts`, `src/identity/chain.ts`.
  Every stamp in a `signed_by` chain must verify; a chain is trusted only if
  *every* per-stamp verdict is valid. Unsigned envelopes are always rejected.
- **Canonicalization** — `src/identity/canonicalize.ts` (JCS / RFC 8785). The
  signed bytes are the canonical field set. Any change to `SIGNABLE_FIELDS` or
  the canonical encoding is signature-affecting and must preserve verification
  of previously-signed envelopes.
- **Sovereignty enforcement** — `src/sovereignty/`. Egress/ingress policy
  decisions and `trusted_substrates` gating. A "fail-open" bug here is a
  sovereignty escape.

## Operational note: JetStream replay windows

Several breaking wire cuts (e.g. `0.4.0`: `signed_by[].principal` removal,
`target_principal` → `target_assistant`) mean **JetStream-replayed envelopes
that predate the cut no longer canonicalize or verify**. Before deploying a
version that lands such a cut, **drain the replay windows** of any JetStream
streams (`EVENTS`, dispatch, audit) that could redeliver pre-migration records —
otherwise a legitimate old envelope will fail verification and be dropped. A
wire record carrying BOTH a deprecated and a canonical field name is rejected
with a typed `dual_field_conflict` rather than silently trusting one side. See
`CHANGELOG.md` (0.4.0) and `docs/migrations/` for the per-cut detail.
