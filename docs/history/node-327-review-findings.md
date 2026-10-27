# Node #327: PR #326 review dispositions

Scope: Sage round 1 on PR #326, reviewed commit `17f8ef7c9d8ae08100592cd4aefb3ec1d996841f`.
The findings below use the review's original order and line numbers. One is declined in part, with a reason; the others are fixed. This record supports the supervisor's close receipt; it does not assert a merge or close the node.

<!-- glossary-ignore: path, message, error, fail, reject -->
<!-- These are the exact tokens identified by the review, discussed as vocabulary rather than domain aliases. -->

| Finding | Reviewed location | Disposition and reason |
| --- | --- | --- |
| F1 | `src/outbox/outbox.ts:33`, no format version | Fixed. Every `put` and `ack` record carries `v: 1` (`src/outbox/spool.ts`). The drainer reads a record without `v` as version 1, because spools written by 0.9.0 exist, and skips any other version with a log line. Replay re-spools unsent puts as version 1. |
| F2 | `docs/architecture.md:107`, §8 packaging row | Fixed. The row now lists `./outbox` (Node-only, #323). |
| F3 | `src/outbox/outbox.ts:32`, `mkdir` on every publish | Fixed. The append runs first and creates the parent directory only on `ENOENT`, then retries once. This needs no memoized state and also recovers when the directory is removed mid-run. Tests: no `mkdir` call when the directory exists; recreation after removal. |
| F4 | `src/outbox/outbox.ts:47`, unbounded spool growth | Fixed in part, declined in part. The review's premise that no compaction exists is outdated: the startup replay (node #324) drops acknowledged puts and removes each finished claim. The architecture doc now says so, and says that within one process lifetime the spool grows with publish volume. Size-based rotation is declined: it adds a second writer to a file that producers share without locks, which is a design change that belongs on its own node if a long-lived producer needs it. |
| F5 | `src/outbox/outbox.ts:33`, duplicated append expression | Fixed. `putRecord`, `ackRecord` and `appendRecord` in `src/outbox/spool.ts` own the record shape and the append; the outbox and the drain's re-spool both use them. |
| F6 | `docs/architecture.md:117`, multi-process claim backed by an in-process test | Fixed. A new test starts four producer processes that append five 200 000-byte envelopes each into one spool after their startup claims finish, and asserts 40 complete, parseable records. The doc now states the verified bound and that larger records are unverified and that a torn line is skipped, losing that envelope. |
| F7 | `docs/architecture.md:117`, at-least-once claim omits double-failure loss | Fixed. The doc scopes at-least-once to puts that reached the spool and lists the spool-and-send double failure as an accepted loss. |
| F8 | `docs/architecture.md:114`, error | Reworded to "cause". |
| F9 | `docs/architecture.md:115`, path | Reworded to "spool file"; the `path` option name in the code spelling stays under an annotation. |
| F10 | `docs/architecture.md:120`, fail | Reworded ("breaks"); "fail-open" is annotated as the delivery stance, not a Nak. |
| F11 | `src/outbox/outbox.test.ts:4`, path | Annotated: the spool file location, not a Subject. Renaming would break the public `path` option. |
| F12 | `src/outbox/outbox.test.ts:33`, message | Annotated: a log line, not an Envelope or Payload. |
| F13 | `src/outbox/outbox.test.ts:148`, reject | Annotated: `Promise.reject`, not a Nak. |
| F14 | `src/outbox/outbox.test.ts:153`, error | Annotated: `console.error` and thrown exceptions, not a Nak. |
| F15 | `src/outbox/outbox.ts:2`, path | Annotated at the public `path` option; renaming it would break the released `createOutbox` API. |
| F16 | `src/outbox/outbox.ts:10`, message | Renamed the log parameter to `line`. |
| F17 | `src/outbox/outbox.ts:14`, fail | Annotated: "fail-open" names the delivery stance, not a Nak. |
| F18 | `src/outbox/outbox.ts:20`, error | Renamed the caught values and the `report` parameter to `cause`. |

Verification: `bun test src/outbox`, then the required host-wide `bun test src/ tools/ && bunx tsc --noEmit` before the commit. The wire contract and the exported declarations are unchanged. The one behavior change is additive: spool records gain `v`.
