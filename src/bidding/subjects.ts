import { DID_RE } from "../identity/types";

const ORG_RE = /^[a-z][a-z0-9-]{0,62}[a-z0-9]$/;
const CAPABILITY_TAG_RE = /^[a-z](?:[a-z0-9]|-(?!-)){0,62}[a-z0-9]$/;

function assertOrg(org: string): void {
  if (!ORG_RE.test(org)) {
    throw new Error(`bidding subject: invalid org '${org}' — must match ${ORG_RE}`);
  }
}

function assertCapability(capability: string): void {
  if (!CAPABILITY_TAG_RE.test(capability)) {
    throw new Error(`bidding subject: invalid capability '${capability}' — must match capability-tag grammar`);
  }
}

function encodePrincipalForSubject(principal: string): string {
  // Mirror tasks.@{principal} encoding from F-019: ':' → '-', '.' → '--'.
  // DID grammar (DID_RE) rejects '--' so encoding stays injective.
  return principal.replace(/:/g, "-").replace(/\./g, "--");
}

export function deriveBidRequestSubject(org: string, capability: string): string {
  assertOrg(org);
  assertCapability(capability);
  return `local.${org}.tasks.bid-request.${capability}`;
}

export function deriveAssignmentSubject(org: string, principal: string, capability: string): string {
  assertOrg(org);
  assertCapability(capability);
  if (!DID_RE.test(principal)) {
    throw new Error(`bidding subject: invalid principal DID '${principal}'`);
  }
  return `local.${org}.tasks.@${encodePrincipalForSubject(principal)}.${capability}`;
}

export function deriveBidLifecycleSubject(
  org: string,
  event: "bid-opened" | "bid-received" | "bid-closed" | "bid-retry" | "assigned",
): string {
  assertOrg(org);
  return `local.${org}.dispatch.task.${event}`;
}
