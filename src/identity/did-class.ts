/**
 * DID-class structural helpers (RFC-0003 §3.2, §3.17; RFC-0005 §6.1 grill D9).
 *
 * Class-explicit `did:mf` DIDs encode their granularity in the first name
 * segment:
 *
 * - agent-class:     `did:mf:agent.{principal}.{stack}.{assistant}`
 * - principal-class: `did:mf:principal.{principal-id}`
 *
 * The **principal component** is what ingress trust keys on: `imported_principals`
 * entries are principal-class DIDs, and the matcher compares the principal
 * component extracted from the last stamp's (agent-class) identity against the
 * entry — a principal-class entry admits every agent of that principal
 * (RFC-0005 §6.1, grill D9; ADR-0013 per-principal trust).
 *
 * A DID in neither class-explicit form (a legacy bare `did:mf:{name}` or the
 * pre-flag-day-R `did:mf:{principal}.{agent}` shape) has no extractable class,
 * so `principalComponentOf` returns it unchanged — preserving byte-for-byte
 * matching until the RFC-0001 §9 flag-day R cut flips entries to the
 * class-explicit form.
 */

const AGENT_PREFIX = 'did:mf:agent.';
const PRINCIPAL_PREFIX = 'did:mf:principal.';

/** True iff `did` is a class-explicit agent-class DID (`did:mf:agent.*`). */
export function isAgentClassDid(did: string): boolean {
  return did.startsWith(AGENT_PREFIX);
}

/** True iff `did` is a class-explicit principal-class DID (`did:mf:principal.*`). */
export function isPrincipalClassDid(did: string): boolean {
  return did.startsWith(PRINCIPAL_PREFIX);
}

/**
 * Extract the principal component used for ingress `imported_principals`
 * matching. Agent-class → the `{principal}` segment; principal-class → the
 * `{principal-id}`; any other (legacy) form → the DID unchanged, so legacy
 * entries keep matching byte-for-byte until flag-day R.
 */
export function principalComponentOf(did: string): string {
  if (isAgentClassDid(did)) {
    const rest = did.slice(AGENT_PREFIX.length);
    // did:mf:agent.{principal}.{stack}.{assistant} — first segment is the principal.
    return rest.split('.', 1)[0] ?? did;
  }
  if (isPrincipalClassDid(did)) {
    const id = did.slice(PRINCIPAL_PREFIX.length);
    return id || did;
  }
  return did;
}
