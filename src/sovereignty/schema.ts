import type { Classification, ValidationError, ValidationResult } from "../types";
import type { EgressRule, ScopeMapping, SovereigntyPolicy, TrustedSubstrate } from "./types";
import { DID_RE, CAPABILITY_TAG_RE, PRINCIPAL_RE } from "../patterns";

const CLASSIFICATIONS = new Set<Classification>(["local", "federated", "public"]);
const RESIDENCY_RE = /^[A-Z]{2}$/;
const SUBJECT_TOKEN_RE = /^[a-z0-9*>-]+$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Transition reader for the R4 sovereignty-config renames
 * (`org` → `network`, `partner_org` → `partner_network`; vocabulary
 * migration 2026-05, PR-8).
 *
 * `SovereigntyPolicy` is local operator config persisted in the
 * `SOVEREIGNTY_POLICY` KV bucket — it is NOT carried inside the signed
 * envelope `sovereignty` wire field (that is the unrelated `Sovereignty`
 * interface in `src/types.ts`, which PR-8 does not touch). It is
 * therefore not signed-canonical content: there is no signature-bytes
 * trust boundary here, so the strict `dual_field_conflict` rejection
 * used for wire-field renames (`src/dual-field.ts`) is deliberately NOT
 * applied. Per the manifest's PR-8 schema decision, the validator
 * simply accepts the deprecated key on read for one minor cycle —
 * preferring the canonical key when present — so a policy JSON written
 * before the migration still loads. Writers emit only the new name.
 */
function readPolicyField(
  obj: Record<string, unknown>,
  oldKey: string,
  newKey: string,
): unknown {
  return newKey in obj ? obj[newKey] : obj[oldKey];
}

/**
 * R4 transition normalizers (vocabulary migration 2026-05, PR-8).
 *
 * Validation alone is not enough: a pre-migration policy JSON loaded
 * from the `SOVEREIGNTY_POLICY` KV bucket carries the deprecated
 * `org` / `partner_org` keys. Downstream code is typed against the
 * canonical `SovereigntyPolicy` / `ScopeMapping` and accesses
 * `policy.network` / `mapping.partner_network` — which would be
 * `undefined` on an un-normalized old-shape object, silently breaking
 * federated routing (the federated-allow match against
 * `partner_network` fails, so an allowed envelope is wrongly blocked).
 *
 * `normalizePolicy` rewrites the deprecated keys to their canonical
 * names so the object that leaves loading ALWAYS carries the new key,
 * regardless of which key the input used. The deprecated key is
 * dropped from the normalized object. Call this only AFTER
 * `validatePolicy` has confirmed the input is well-formed.
 */
function normalizeScopeMapping(mapping: Record<string, unknown>): ScopeMapping {
  const { partner_org: _deprecated, ...rest } = mapping;
  return {
    ...(rest as Omit<ScopeMapping, "partner_network">),
    partner_network: readPolicyField(mapping, "partner_org", "partner_network") as string,
  };
}

/**
 * Return a `SovereigntyPolicy` with the R4-renamed keys normalized to
 * their canonical form (`org` → `network`, `partner_org` →
 * `partner_network` on every scope mapping). The deprecated keys are
 * removed. Idempotent — a policy already in canonical form is returned
 * with the same shape.
 */
export function normalizePolicy(policy: SovereigntyPolicy): SovereigntyPolicy {
  const raw = policy as unknown as Record<string, unknown>;
  const { org: _deprecatedOrg, ...rest } = raw;
  const ingress = raw.ingress as Record<string, unknown> | undefined;
  const scopeMappings = Array.isArray(ingress?.scope_mappings)
    ? ingress.scope_mappings.map((m) => normalizeScopeMapping(m as Record<string, unknown>))
    : ingress?.scope_mappings;
  return {
    ...(rest as Omit<SovereigntyPolicy, "network" | "ingress">),
    network: readPolicyField(raw, "org", "network") as string,
    ingress: {
      ...(ingress as SovereigntyPolicy["ingress"]),
      scope_mappings: scopeMappings as ScopeMapping[],
    },
  };
}

function pushSubjectErrors(field: string, subject: unknown, errors: ValidationError[]): void {
  if (typeof subject !== "string" || subject.length === 0) {
    errors.push({ field, message: "must be a non-empty string" });
    return;
  }
  const tokens = subject.split(".");
  for (let i = 0; i < tokens.length; i++) {
    if (!SUBJECT_TOKEN_RE.test(tokens[i])) {
      errors.push({ field, message: `token ${i} '${tokens[i]}' contains invalid characters` });
      return;
    }
  }
  const gtIdx = tokens.indexOf(">");
  if (gtIdx !== -1 && gtIdx !== tokens.length - 1) {
    errors.push({ field, message: "'>' wildcard must be the final token" });
  }
}

export function validateEgressRule(rule: unknown, path = "rule"): ValidationResult {
  const errors: ValidationError[] = [];
  if (!isObject(rule)) {
    return { valid: false, errors: [{ field: path, message: "must be an object" }] };
  }
  if (typeof rule.classification !== "string" || !CLASSIFICATIONS.has(rule.classification as Classification)) {
    errors.push({ field: `${path}.classification`, message: "must be 'local' | 'federated' | 'public'" });
  }
  if (!Array.isArray(rule.allowed_subjects) || rule.allowed_subjects.length === 0) {
    errors.push({ field: `${path}.allowed_subjects`, message: "must be a non-empty array" });
  } else {
    rule.allowed_subjects.forEach((s, i) => { pushSubjectErrors(`${path}.allowed_subjects[${i}]`, s, errors); });
  }
  if (rule.data_residency_constraints !== undefined) {
    if (!isObject(rule.data_residency_constraints)) {
      errors.push({ field: `${path}.data_residency_constraints`, message: "must be an object keyed by residency code" });
    } else {
      for (const [residency, patterns] of Object.entries(rule.data_residency_constraints)) {
        if (!RESIDENCY_RE.test(residency)) {
          errors.push({ field: `${path}.data_residency_constraints.${residency}`, message: "key must be ISO-3166 alpha-2 (e.g., 'CH')" });
        }
        if (!Array.isArray(patterns) || patterns.length === 0) {
          errors.push({ field: `${path}.data_residency_constraints.${residency}`, message: "must be a non-empty array of subject patterns" });
        } else {
          patterns.forEach((p, i) => { pushSubjectErrors(`${path}.data_residency_constraints.${residency}[${i}]`, p, errors); });
        }
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

export function validateScopeMapping(mapping: unknown, path = "mapping"): ValidationResult {
  const errors: ValidationError[] = [];
  if (!isObject(mapping)) {
    return { valid: false, errors: [{ field: path, message: "must be an object" }] };
  }
  // R4 transition (PR-8): accept the deprecated `partner_org` on read,
  // emit only `partner_network` on write. Not signed-canonical — see
  // `readPolicyField`.
  const partnerNetwork = readPolicyField(mapping, "partner_org", "partner_network");
  if (typeof partnerNetwork !== "string" || !PRINCIPAL_RE.test(partnerNetwork)) {
    errors.push({ field: `${path}.partner_network`, message: "must match /^[a-z][a-z0-9-]{0,62}[a-z0-9]$/" });
  }
  if (!Array.isArray(mapping.imported_principals) || mapping.imported_principals.length === 0) {
    errors.push({ field: `${path}.imported_principals`, message: "must be a non-empty array of DIDs" });
  } else {
    mapping.imported_principals.forEach((did, i) => {
      if (typeof did !== "string" || !DID_RE.test(did)) {
        errors.push({ field: `${path}.imported_principals[${i}]`, message: "must match did:mf:* grammar" });
      }
    });
  }
  if (!Array.isArray(mapping.local_scope) || mapping.local_scope.length === 0) {
    errors.push({ field: `${path}.local_scope`, message: "must be a non-empty array of subject patterns" });
  } else {
    mapping.local_scope.forEach((s, i) => { pushSubjectErrors(`${path}.local_scope[${i}]`, s, errors); });
  }
  if (!Array.isArray(mapping.max_capabilities)) {
    errors.push({ field: `${path}.max_capabilities`, message: "must be an array of capability tags" });
  } else {
    mapping.max_capabilities.forEach((cap, i) => {
      if (typeof cap !== "string" || !CAPABILITY_TAG_RE.test(cap)) {
        errors.push({ field: `${path}.max_capabilities[${i}]`, message: "must match capability-tag grammar" });
      }
    });
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Validate one `trusted_substrates[]` entry (DD-122). `provider` and
 * each `roles[]` entry use the shared lowercase-slug grammar
 * (`PRINCIPAL_RE` — same shape as NATS-subject-safe slugs, which keeps
 * them embeddable in subjects, KV keys, and audit fields downstream).
 * `tenancy` is provider-opaque: any non-empty string without
 * whitespace or control characters.
 */
export function validateTrustedSubstrate(entry: unknown, path = "substrate"): ValidationResult {
  const errors: ValidationError[] = [];
  if (!isObject(entry)) {
    return { valid: false, errors: [{ field: path, message: "must be an object" }] };
  }
  if (typeof entry.provider !== "string" || !PRINCIPAL_RE.test(entry.provider)) {
    errors.push({ field: `${path}.provider`, message: "must match /^[a-z][a-z0-9-]{0,62}[a-z0-9]$/" });
  }
  if (typeof entry.tenancy !== "string" || entry.tenancy.length === 0 || /[\s\p{Cc}]/u.test(entry.tenancy)) {
    errors.push({ field: `${path}.tenancy`, message: "must be a non-empty string without whitespace or control characters" });
  }
  if (!Array.isArray(entry.roles) || entry.roles.length === 0) {
    errors.push({ field: `${path}.roles`, message: "must be a non-empty array of role slugs" });
  } else {
    entry.roles.forEach((role, i) => {
      if (typeof role !== "string" || !PRINCIPAL_RE.test(role)) {
        errors.push({ field: `${path}.roles[${i}]`, message: "must match /^[a-z][a-z0-9-]{0,62}[a-z0-9]$/" });
      }
    });
  }
  if (typeof entry.data_residency_accepted !== "boolean") {
    errors.push({ field: `${path}.data_residency_accepted`, message: "must be boolean" });
  }
  return { valid: errors.length === 0, errors };
}

export function validatePolicy(policy: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  if (!isObject(policy)) {
    return { valid: false, errors: [{ field: "policy", message: "must be an object" }] };
  }
  if (policy.version !== 1) {
    errors.push({ field: "version", message: "must be 1" });
  }
  // R4 transition (PR-8): accept the deprecated `org` on read, emit
  // only `network` on write. Not signed-canonical — see `readPolicyField`.
  const network = readPolicyField(policy, "org", "network");
  if (typeof network !== "string" || !PRINCIPAL_RE.test(network)) {
    errors.push({ field: "network", message: "must match /^[a-z][a-z0-9-]{0,62}[a-z0-9]$/" });
  }
  if (!isObject(policy.egress)) {
    errors.push({ field: "egress", message: "must be an object" });
  } else {
    if (typeof policy.egress.block_local_escape !== "boolean") {
      errors.push({ field: "egress.block_local_escape", message: "must be boolean" });
    }
    if (!Array.isArray(policy.egress.rules)) {
      errors.push({ field: "egress.rules", message: "must be an array" });
    } else {
      policy.egress.rules.forEach((rule, i) => {
        const result = validateEgressRule(rule, `egress.rules[${i}]`);
        errors.push(...result.errors);
      });
    }
  }
  if (!isObject(policy.ingress)) {
    errors.push({ field: "ingress", message: "must be an object" });
  } else {
    if (!Array.isArray(policy.ingress.scope_mappings)) {
      errors.push({ field: "ingress.scope_mappings", message: "must be an array" });
    } else {
      policy.ingress.scope_mappings.forEach((m, i) => {
        const result = validateScopeMapping(m, `ingress.scope_mappings[${i}]`);
        errors.push(...result.errors);
      });
    }
    if (typeof policy.ingress.reject_unknown_partners !== "boolean") {
      errors.push({ field: "ingress.reject_unknown_partners", message: "must be boolean" });
    }
  }
  if (!isObject(policy.chain_of_stamps)) {
    errors.push({ field: "chain_of_stamps", message: "must be an object" });
  } else if (typeof policy.chain_of_stamps.verify_delegation_sovereignty !== "boolean") {
    errors.push({ field: "chain_of_stamps.verify_delegation_sovereignty", message: "must be boolean" });
  }
  // DD-122: optional, deny-by-default. Absent section is valid (no
  // non-local substrate trusted); present section must be an array of
  // well-formed entries.
  if (policy.trusted_substrates !== undefined) {
    if (!Array.isArray(policy.trusted_substrates)) {
      errors.push({ field: "trusted_substrates", message: "must be an array" });
    } else {
      policy.trusted_substrates.forEach((entry, i) => {
        const result = validateTrustedSubstrate(entry, `trusted_substrates[${i}]`);
        errors.push(...result.errors);
      });
    }
  }
  return { valid: errors.length === 0, errors };
}

export function describeErrors(errors: ValidationError[]): string {
  return errors.map((e) => `${e.field}: ${e.message}`).join(", ");
}

export function assertPolicy(policy: unknown): asserts policy is SovereigntyPolicy {
  const result = validatePolicy(policy);
  if (!result.valid) {
    throw new Error(`invalid sovereignty policy: ${describeErrors(result.errors)}`);
  }
}

// Re-export for static type inference where needed.
export type { SovereigntyPolicy, EgressRule, ScopeMapping, TrustedSubstrate };
