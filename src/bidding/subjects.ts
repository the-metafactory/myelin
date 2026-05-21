import { DID_RE, CAPABILITY_TAG_RE, PRINCIPAL_RE } from "../patterns";
import { encodeDidSegment } from "../subjects";

function assertPrincipal(principal: string): void {
  if (!PRINCIPAL_RE.test(principal)) {
    throw new Error(`bidding subject: invalid principal '${principal}' — must match ${PRINCIPAL_RE}`);
  }
}

function assertCapability(capability: string): void {
  if (!CAPABILITY_TAG_RE.test(capability)) {
    throw new Error(`bidding subject: invalid capability '${capability}' — must match capability-tag grammar`);
  }
}

export function deriveBidRequestSubject(principal: string, capability: string): string {
  assertPrincipal(principal);
  assertCapability(capability);
  return `local.${principal}.tasks.bid-request.${capability}`;
}

export function deriveAssignmentSubject(principal: string, did: string, capability: string): string {
  assertPrincipal(principal);
  assertCapability(capability);
  if (!DID_RE.test(did)) {
    throw new Error(`bidding subject: invalid assistant DID '${did}'`);
  }
  // R7 + consolidation (vocabulary migration 2026-05, PR-10) — the previous
  // bidding-local `encodePrincipalForSubject` helper duplicated the
  // `:` → `-`, `.` → `--` rule from `encodeDidSegment` in `../subjects`.
  // Consolidated to the shared helper (which also prefixes `@`) so the
  // ecosystem owns ONE DID-segment grammar.
  return `local.${principal}.tasks.${encodeDidSegment(did)}.${capability}`;
}

/**
 * Bidding lifecycle events live under `local.{principal}.dispatch.bid.{event}`,
 * NOT `local.{principal}.dispatch.task.{event}`. The `dispatch.task.>` namespace
 * is owned by F-020 dispatch lifecycle (received/assigned/started/progress/
 * completed/failed/aborted) — sharing that namespace would cause subscribers
 * to `dispatch.task.>` to receive bidding events with incompatible payload
 * shapes. The `bid` segment isolates the bidding sub-protocol cleanly.
 */
export function deriveBidLifecycleSubject(
  principal: string,
  event: "bid-opened" | "bid-received" | "bid-closed" | "bid-retry" | "bid-assigned",
): string {
  assertPrincipal(principal);
  return `local.${principal}.dispatch.bid.${event}`;
}
