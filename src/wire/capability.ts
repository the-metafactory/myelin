/**
 * ./wire — capability surface (RFC-0008 / RFC-0005 OD-7). The #238 slice: the
 * sovereignty-mode equality matcher. The converged capability-id codec, the
 * segment-prefix matcher, and the presence fold-gate are RFC-0008 flag-day-R
 * work (myelin#234), not part of this issue.
 */

export type CapabilityResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

/**
 * Sovereignty-mode matcher (RFC-0005 OD-7 / §6.5): PLAIN EQUALITY. There is NO
 * implied ordering between modes — `selective` does not subsume `strict`; a
 * capability's declared mode matches a requirement iff they are byte-equal.
 */
export function matchSovereigntyMode(input: {
  required: string;
  declared: string;
}): CapabilityResult<{ match: boolean }> {
  return { ok: true, value: { match: input.required === input.declared } };
}
