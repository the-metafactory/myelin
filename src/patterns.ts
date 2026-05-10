/**
 * Canonical regex grammars used across the codebase.
 *
 * Single source of truth so that a tightening here propagates to every
 * site that validates capability tags or DIDs. See F-019 cycle 3 (DID_RE
 * injectivity), F-021 cycle 1 (capability tag grammar), and #51 cycle 2
 * (this consolidation).
 *
 * DID_RE lives with identity domain types — re-exported here for
 * convenience so consumers don't need to know the domain hierarchy.
 */
export { DID_RE, BASE64_RE } from "./identity/types";

/**
 * Capability tag: 2-64 chars, starts with letter, ends with letter/digit,
 * no trailing or consecutive hyphens. Mirrors DID_RE's `--` rejection so
 * tags stay safe to embed in NATS subjects, KV keys, and file paths
 * downstream. Single-char tags excluded — none in the seed taxonomy and
 * they collide with the 1-char forms of structured identifiers.
 */
export const CAPABILITY_TAG_RE = /^[a-z](?:[a-z0-9]|-(?!-)){0,62}[a-z0-9]$/;

/**
 * Org slug used as the second token of every namespaced NATS subject
 * (`local.{org}.…`, `federated.{org}.…`, `local.{org}._metrics.…`). Must
 * be a single NATS subject segment — no dots, no wildcards (`*`/`>`), no
 * other separator characters. 2-64 chars, starts with letter, ends with
 * letter/digit. Matches the original definition in bidding/subjects.ts.
 *
 * Validating at every subject-derivation site keeps a malformed `org`
 * (typo, accidental dot, wildcard pasted from a subscription pattern)
 * from silently producing a subject with the wrong token count.
 */
export const ORG_RE = /^[a-z][a-z0-9-]{0,62}[a-z0-9]$/;
