# specs/grammar/ — normative ABNF wire grammar

These `.abnf` files are the **normative** grammar for the myelin wire contracts, and the source the
`src/wire/generated/**` artifacts are generated from (`bun tools/abnf-gen`, drift-gated in CI). Do
not hand-edit the generated output — change the `.abnf` and regenerate.

A grammar change **is a wire change**, governed by `specs/rfc/rfc-bcp-0001-wire-change-control-and-versioning.md`.
Each grammar maps to its RFC: `subject-namespace`→`rfc-0002`, `envelope`→`rfc-0003`,
`envelope-signing`→`rfc-0004`, `identifiers`→`rfc-0001`, `sovereignty`→`rfc-0005`,
`admission`→`rfc-0006`, `transport`→`rfc-0007`, `capability-discovery`→`rfc-0008`,
`economics`→`rfc-0009`, `rate-limit`→`rfc-0010`.
