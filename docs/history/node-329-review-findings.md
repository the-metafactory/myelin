# Node #329: PR #328 review dispositions

Scope: Sage round 1 on PR #328, reviewed commit `844c389d9f07abea629ec6974696a29c7b520275`.
The findings below use the review's original order. Line numbers are those of the reviewed commit; later nodes moved some of them. One finding is declined, with a reason; the others are fixed. This record supports the supervisor's close receipt; it does not assert a merge or close the node.

<!-- glossary-ignore: bus, root, principal, message, error, level, data -->
<!-- These are the exact tokens identified by the review, discussed as vocabulary rather than domain aliases. -->

| Finding | Reviewed location | Disposition and reason |
| --- | --- | --- |
| F1 | `src/execution/types.ts:15`, `state.subject` overloads Subject | Declined as a rename, fixed as documentation. `state.subject` is in the released run-ledger contract (0.9.0 onward) that soma#787 fixes; renaming it is a wire change under `rfc-bcp-0001`, and the review itself allows keeping the name when it is fixed upstream. `CONTEXT.md` (Execution Run) and the `ExecutionRunState` doc comment now say it is a state key, not a Subject. A rename belongs on a node on soma#787, if the principal wants one. |
| F2 | `src/execution/run-finished.ts:83`, extract the calendar-range check | Fixed. `isValidCalendarParts` in `src/execution/payload-checks.ts` owns the leap-year and range checks; `timestamp` is a single guard. Behavior is unchanged and the existing timestamp tests cover it. |
| F3 | `src/edge.ts:99`, vocabulary re-exports duplicated | Fixed. `src/execution/index.ts` re-exports the run-ledger and attention-resolution vocabulary constants and types; `src/index.ts` and `src/edge.ts` need only `export * from "./execution"`. The attention vocabulary had the same duplication and moved with it. |
| F4 | `src/execution/types.ts:19`, "no free text" not enforced | Fixed. The doc comments on both payloads and the architecture text now say what the validators enforce (shape, enums, timestamps, `soma:` refs, non-empty strings) and that producers must keep prose out of the other strings. No validator change: bounding or classifying strings would be a wire change. |
| F5 | `CONTEXT.md:66`, bus | Reworded to the canonical Transport term. |
| F6 | `docs/architecture.md:152`, root | Reworded to "the package entry point". |
| F7 | `src/execution/run-finished.test.ts:21,231,232`, root | Renamed the namespace import to `packageEntry` and reworded the test title. |
| F8 | `src/execution/run-finished.test.ts:51`, principal | Annotated: the fixture names the Principal's Subject segment. |
| F9 | `src/execution/run-finished.test.ts:88,196,206`, message | Annotated: the forbidden free-text fixture key and diagnostic text fields. |
| F10 | `src/execution/run-finished.test.ts:188,210,219,227`, error | Renamed the callback parameters to `diagnostic` and reworded the test title. |
| F11 | `src/execution/run-finished.test.ts:200`, level | Reworded to "on the envelope itself". |
| F12 | `src/execution/run-finished.ts:16`, principal | Annotated: the public option selects the Principal segment of the Subject. Renaming would break the released `createExecutionRunFinished` API. |
| F13 | `src/execution/run-finished.ts:50,54,61,69,89,106` and 5 more, message | Annotated: every `message` is ValidationError diagnostic text. |
| F14 | `src/execution/run-finished.ts:123,146`, data | Reworded to "producer input" and "a malformed envelope". |
| F15 | `src/execution/run-finished.ts:127`, error | No longer present: the caught values and diagnostics were renamed by earlier nodes; the remaining `errors` is the ValidationError list. |
| F16 | `src/subjects.test.ts:46,48,49`, principal | Annotated: the Principal's Subject segment and its expected diagnostics. |
| F17 | `src/subjects.test.ts:52`, error | Annotated: the required `@ts-expect-error` directive; replacing it with Nak would disable its compiler check. |
| F18 | `src/subjects.ts:427–435`, principal | Annotated both run-ledger Subject helpers: the segment identifies the Principal, not any Identity. |

Verification: `bun test src/execution src/subjects.test.ts src/edge-surface.test.ts`, then the required host-wide `bun test src/ tools/ && bunx tsc --noEmit` before the commit. No wire field, accepted value, diagnostic string or exported name changed.
