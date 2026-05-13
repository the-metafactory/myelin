import type { Classification, ValidationError, ValidationResult } from "../types";
import type { EgressRule, ScopeMapping, SovereigntyPolicy } from "./types";
import { DID_RE, CAPABILITY_TAG_RE } from "../patterns";

const CLASSIFICATIONS = new Set<Classification>(["local", "federated", "public"]);
const ORG_RE = /^[a-z][a-z0-9-]{0,62}[a-z0-9]$/;
const RESIDENCY_RE = /^[A-Z]{2}$/;
const SUBJECT_TOKEN_RE = /^[a-z0-9*>-]+$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  if (typeof mapping.partner_org !== "string" || !ORG_RE.test(mapping.partner_org)) {
    errors.push({ field: `${path}.partner_org`, message: "must match /^[a-z][a-z0-9-]{0,62}[a-z0-9]$/" });
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

export function validatePolicy(policy: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  if (!isObject(policy)) {
    return { valid: false, errors: [{ field: "policy", message: "must be an object" }] };
  }
  if (policy.version !== 1) {
    errors.push({ field: "version", message: "must be 1" });
  }
  if (typeof policy.org !== "string" || !ORG_RE.test(policy.org)) {
    errors.push({ field: "org", message: "must match /^[a-z][a-z0-9-]{0,62}[a-z0-9]$/" });
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
export type { SovereigntyPolicy, EgressRule, ScopeMapping };
