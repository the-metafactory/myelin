/**
 * Internal segment-grammar validators shared between `./subjects` and
 * `./dispatch/lifecycle`. Lifted out of `./subjects` to satisfy the
 * Architecture-lens concern that exporting `assertSegment` from
 * `./subjects` would widen the module's public API surface for a
 * cross-file coupling that should stay internal (myelin#154 review).
 *
 * **Not re-exported from `./index`.** Anything that needs to validate a
 * NATS-namespace segment imports from here directly. Consumers outside
 * the package should rely on the public `STACK_SEGMENT_REGEX` re-export
 * from `./subjects` and inline their own validation.
 *
 * Source of truth for the grammar lives in `specs/namespace.md` §"Subject
 * Format". Drift between this module and the spec is the kind of bug the
 * single source of truth here is designed to prevent.
 */

/**
 * Permitted shape for a single segment in `local./federated.` subjects.
 * Same character set spec §"Subject Format" mandates: lowercase
 * alphanumeric + hyphens, must start with a letter, 1–63 chars.
 *
 * Re-exported from `./subjects` as `STACK_SEGMENT_REGEX` for public
 * package consumers (the historical export site) — this file is the
 * authoritative source and `./subjects` is a re-export.
 */
export const STACK_SEGMENT_REGEX = /^[a-z][a-z0-9-]{0,62}$/;

/**
 * Validate that a string is a single namespace segment per
 * `specs/namespace.md` — i.e., matches {@link STACK_SEGMENT_REGEX}.
 *
 * Used by the agent-task and lifecycle helpers to reject NATS wildcard
 * tokens (`*`, `>`, `.`) and any other input that would broaden a
 * subscription or inject a different subject root than the helper's
 * documented shape (sage#139 cycle-2 Security lens).
 *
 * @throws Error with the offending segment name and value.
 */
export function assertSegment(name: string, value: string): void {
  if (!STACK_SEGMENT_REGEX.test(value)) {
    throw new Error(
      `Invalid ${name} segment "${value}": must match ${STACK_SEGMENT_REGEX.source}`,
    );
  }
}

/**
 * Validate a dot-separated namespace path: every token between dots
 * must independently match {@link STACK_SEGMENT_REGEX}.
 *
 * Used where the helper deliberately accepts compound capabilities
 * (e.g. `'code-review.typescript'`) to preserve cedar/sage's existing
 * publish vocabulary (sage#139 cycle-3 — strict single-segment
 * validation broke their migration path). The per-token check still
 * rejects every wildcard / empty / non-grammar input the security
 * boundary cares about, because `*`, `>`, `''`, leading-dot, trailing-
 * dot, and consecutive-dot cases all produce at least one token that
 * fails `STACK_SEGMENT_REGEX`.
 *
 * @throws Error identifying the offending path and the bad token.
 */
export function assertSegmentPath(name: string, value: string): void {
  if (value === '') {
    throw new Error(`Invalid ${name} path "${value}": must be non-empty`);
  }
  const tokens = value.split('.');
  for (const tok of tokens) {
    if (!STACK_SEGMENT_REGEX.test(tok)) {
      throw new Error(
        `Invalid ${name} path "${value}": token "${tok}" must match ${STACK_SEGMENT_REGEX.source}`,
      );
    }
  }
}

/**
 * Build the optional stack prefix segment, the part of an IoAW subject
 * that sits between `local.{org}.` and the domain (`tasks` / `dispatch` /
 * `code.pr`). Returns the empty string when `stack` is undefined so
 * callers can string-concatenate without branching on every site —
 * stack-aware migration cost stays one assertion + one template per
 * helper rather than two-branch returns sprawled across the file
 * (myelin#154 cycle 2 — Maintainability lens).
 *
 * Validates the segment via {@link assertSegment} when supplied. The
 * caller is still responsible for validating `org` independently —
 * this helper does NOT validate it because some callers want different
 * grammars for `org` (e.g. `assertSegmentPath` accepts compound
 * publisher orgs in places).
 *
 * @example
 *   stackInfix(undefined)        // → ''
 *   stackInfix('default')        // → 'default.'
 *   `local.${org}.${stackInfix(stack)}tasks.${cap}.>`
 *   //  → `local.{org}.tasks.{cap}.>` when stack omitted
 *   //  → `local.{org}.{stack}.tasks.{cap}.>` when supplied
 */
export function stackInfix(stack?: string): string {
  if (stack === undefined) return '';
  assertSegment('stack', stack);
  return `${stack}.`;
}
