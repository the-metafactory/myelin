# Node #342: PR #340 glossary dispositions

Scope: Sage round 1 on PR #340, reviewed commit `86ea0fdcd0be3f711bb0310256c9535387a8bd0f`.
The findings below use the review's original line numbers and order. Each is addressed by wording or an explicit, local glossary annotation; none is deferred or declined. This record supports the supervisor's eventual close receipt; it does not assert a merge or close the node.

<!-- glossary-ignore: principal, root, bus, owner, message, error, data -->
<!-- These are the exact tokens identified by the review, discussed as vocabulary rather than domain aliases. -->

| Finding | Reviewed location | Disposition and reason |
| --- | --- | --- |
| F1 | `CHANGELOG.md:10`, principal | Annotated: the answer comes from the Principal, and the Subject grammar uses that segment. Identity would broaden the meaning. |
| F2 | `CHANGELOG.md:10`, root | Reworded to “package entry point”; this export surface is unrelated to a Hub. |
| F3 | `CONTEXT.md:78`, bus | Reworded Attention Resolution reporting to use the canonical Transport term. |
| F4 | `src/execution/attention-resolved.test.ts:15,177,178`, root | Renamed the test namespace to `packageExports` and clarified the test title. |
| F5 | `src/execution/attention-resolved.test.ts:40`, principal | Annotated: the fixture names the Principal's Subject segment. |
| F6 | `src/execution/attention-resolved.test.ts:78,129`, owner | Annotated: GitHub account coordinates, including deliberately malformed fixtures; no Myelin role is being named. |
| F7 | `src/execution/attention-resolved.test.ts:90,155,173`, message | Annotated: the forbidden free-text fixture key and diagnostic text fields. The former keeps closed-Payload coverage; the latter preserves `ValidationError` expectations. |
| F8 | `src/execution/attention-resolved.test.ts:149,158,166`, error | Annotated diagnostic variables and reworded the test title. These are validation diagnostics, not dispatch Naks. |
| F9 | `src/execution/attention-resolved.ts:14`, principal | Annotated: the public option selects the Principal's Subject segment. |
| F10 | `src/execution/attention-resolved.ts:31,46`, owner | Annotated the GitHub coordinate grammar and diagnostic; changing it to Principal would misdescribe the accepted ref. |
| F11 | `src/execution/attention-resolved.ts:43,46,68,71`, message | Annotated diagnostic text fields; these are neither Envelopes nor Payloads. |
| F12 | `src/execution/attention-resolved.ts:66`, data | Reworded to “malformed envelope or payload,” covering both validation boundaries. |
| F13 | `src/execution/payload-checks.ts:16,20,27,35,55,59`, message | Annotated diagnostic fields and reworded the formatting comment to describe an exception. |
| F14 | `src/execution/payload-checks.ts:62`, error | Annotated the local `ValidationError` diagnostic; no Nak is emitted. |
| F15 | `src/execution/types.ts:54`, owner | Annotated the GitHub coordinate format of `filed`; the public field retains its meaning. |
| F16 | `src/subjects.test.ts:74,76,77`, principal | Annotated the Principal's Subject segment and its expected validation diagnostics. |
| F17 | `src/subjects.test.ts:80`, error | Annotated the required TypeScript directive; replacing it with Nak would disable its compiler check. |
| F18 | `src/subjects.ts:440–449`, principal | Annotated both attention-resolution Subject helpers: the segment identifies the Principal, not any Identity. |

Verification uses the existing attention-resolution and Subject tests, plus the required host-wide `bun test src/ tools/ && bunx tsc --noEmit` check before the commit. No wire fields, accepted values, diagnostic strings or exported declarations are changed.
