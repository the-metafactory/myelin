# src/ — Myelin M2–M6 wire contract implementation

This tree implements the myelin wire contracts. The RFC pack (`specs/rfc/`) and grammar
(`specs/grammar/`) are **normative** for this tree: code conforms to the spec; a divergence is a
bug, and a spec change is a wire change (`specs/rfc/rfc-bcp-0001-wire-change-control-and-versioning.md`).

Governing RFCs (`specs/rfc/`) — full trigger→RFC map in the root `CLAUDE.md` `wire_grounding` table:
- subjects → `rfc-0002`; envelope → `rfc-0003`; signing / JCS → `rfc-0004`; identity / `signed_by` → `rfc-0001`
- sovereignty / `federated.*` → `rfc-0005`; admission → `rfc-0006`; transport → `rfc-0007`
- discovery → `rfc-0008`; economics / bidding → `rfc-0009`; refusal → `rfc-0010`
