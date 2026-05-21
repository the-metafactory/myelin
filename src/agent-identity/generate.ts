import { utils, getPublicKeyAsync } from "@noble/ed25519";
import type { AgentIdentity } from "./types";
import { DID_RE } from "../identity/types";
import { CAPABILITY_TAG_RE } from "../patterns";
import { bytesToBase64 } from "../base64";

const SOURCE_URI_RE = /^(https?:\/\/|file:\/\/|did:[a-z][a-z0-9-]*:)/;

export interface GenerateAgentIdentityInput {
  /** DID, e.g., "did:mf:luna". Must match did:mf:* grammar. */
  did: string;
  /** Source URI: http(s):// | file:// | did:*:* */
  source_uri: string;
  /** Optional human display name. */
  display_name?: string;
  /** Capability tags, F-11 grammar (kebab-case alphanumeric). */
  capabilities?: string[];
  /** Owning network, e.g., "metafactory". */
  network?: string;
  /** Test injection: deterministic clock. Defaults to Date. */
  now?: () => Date;
}

/**
 * F-7: generate a fresh AgentIdentity with a new Ed25519 keypair.
 * Validates inputs strictly so a bad DID or bad source URI fails at
 * generation time, not later when signing.
 */
export async function generateAgentIdentity(input: GenerateAgentIdentityInput): Promise<AgentIdentity> {
  if (!DID_RE.test(input.did)) {
    throw new Error(`generateAgentIdentity: invalid DID '${input.did}'`);
  }
  if (typeof input.source_uri !== "string" || !SOURCE_URI_RE.test(input.source_uri)) {
    throw new Error(
      `generateAgentIdentity: invalid source_uri '${input.source_uri}' — must start with http://, https://, file://, or did:*:*`,
    );
  }
  if (input.capabilities) {
    for (const cap of input.capabilities) {
      if (typeof cap !== "string" || !CAPABILITY_TAG_RE.test(cap)) {
        throw new Error(`generateAgentIdentity: invalid capability tag '${cap}'`);
      }
    }
  }
  const privKey = utils.randomSecretKey();
  const pubKey = await getPublicKeyAsync(privKey);
  const now = input.now ?? (() => new Date());
  return {
    did: input.did,
    ...(input.display_name ? { display_name: input.display_name } : {}),
    source_uri: input.source_uri,
    public_key: bytesToBase64(pubKey),
    private_key: bytesToBase64(privKey),
    capabilities: input.capabilities ? [...input.capabilities] : [],
    ...(input.network ? { network: input.network } : {}),
    created_at: now().toISOString(),
  };
}
