# specs/vectors/ — conformance test vectors

These vectors are **normative** conformance fixtures for the wire contracts — they must match the
signed envelope and grammar exactly. A vector that diverges from the RFC/grammar is a bug, not a new
truth: regenerate vectors from the spec rather than editing them to match code.

Governing RFCs (`specs/rfc/`): envelope → `rfc-0003-envelope.md`, signing → `rfc-0004-envelope-signing.md`,
subjects → `rfc-0002-subject-namespace.md`; per-surface vectors follow their surface's RFC. A vector
change tracking a spec change is a wire change (`specs/rfc/rfc-bcp-0001-wire-change-control-and-versioning.md`).
