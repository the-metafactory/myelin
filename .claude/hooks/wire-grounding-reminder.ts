#!/usr/bin/env bun
// PreToolUse (Edit|Write) — emit a one-line reminder naming the governing RFC
// for a wire-implementing path. Non-blocking: prints context, never exits
// non-zero, never calls the bus/network. Implements §4 of the ecosystem
// domain-grounding standard (compass/standards/domain-grounding.md) for myelin.
// More specific globs first — src/wire/ before the broad src/ fallback.
const RULES: Array<{ glob: RegExp; rfc: string }> = [
  {
    glob: /(^|\/)specs\/grammar\//,
    rfc: "specs/rfc/rfc-0002-subject-namespace.md, rfc-0003-envelope.md — grammar changes are wire changes (rfc-bcp-0001)",
  },
  {
    glob: /(^|\/)specs\/vectors\//,
    rfc: "specs/rfc/rfc-0003-envelope.md + rfc-0004-envelope-signing.md — vectors must match the signed envelope grammar",
  },
  {
    glob: /(^|\/)src\/wire\//,
    rfc: "specs/rfc/rfc-0003-envelope.md, rfc-0004-envelope-signing.md, rfc-0002-subject-namespace.md — the grammar is normative for this tree",
  },
  {
    glob: /(^|\/)src\//,
    rfc: "specs/rfc/ — the RFC grammar is normative for src/; see src/CLAUDE.md and the root wire_grounding table",
  },
];

const input = JSON.parse(await Bun.stdin.text()) as {
  tool_input?: { file_path?: string };
};
const path = input.tool_input?.file_path ?? "";
const hit = RULES.find((r) => r.glob.test(path));
if (hit) {
  // Surface as additional context on the tool call; do not block.
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: `Wire-grounding: editing ${path} — governed by ${hit.rfc}. Read the RFC before changing wire behavior.`,
      },
    }),
  );
}
process.exit(0); // always non-blocking
