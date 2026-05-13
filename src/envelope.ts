import type {
  MyelinEnvelope,
  CreateEnvelopeInput,
  ValidationResult,
  ValidationError,
  Classification,
} from './types';
import type { SigningIdentity } from './identity/types';
import { signEnvelope } from './identity/sign';
import { MAX_CHAIN_LENGTH } from './identity/chain';
import { UUID_RE } from './uuid';
import { DID_RE, BASE64_RE, CAPABILITY_TAG_RE } from './patterns';
import {
  detectSubjectForm,
  deriveSubject,
  subjectPrefixAligns,
  type SubjectForm,
} from './subjects';

// Backward-compat re-exports for callers that imported these from `./envelope`
// before they moved to `./subjects`. NEW grammar primitives introduced in
// myelin#115 (deriveSubject, subjectPrefixAligns, isSubjectClassification) are
// intentionally NOT re-exported here — consumers wanting them should import
// from `./subjects` directly to preserve the no-envelope-dep boundary
// (Sage R2).
export {
  STACK_SEGMENT_REGEX,
  detectSubjectForm,
} from './subjects';
export type {
  SubjectForm,
  SubjectFormDetection,
} from './subjects';

const SOURCE_RE = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){2,4}$/;
const TYPE_RE = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){1,4}$/;
const RESIDENCY_RE = /^[A-Z]{2}$/;
const ISO8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

import { CLASSIFICATION_VALUES } from './classifications';

const CLASSIFICATIONS: ReadonlySet<string> = new Set(CLASSIFICATION_VALUES);
const MODEL_CLASSES = new Set(['local-only', 'frontier', 'any']);
const SOVEREIGNTY_REQUIREMENTS = new Set(['open', 'selective', 'strict', 'bidding']);
const DISTRIBUTION_MODES = new Set(['broadcast', 'direct', 'delegate']);
const STAMP_ROLES = new Set(['origin', 'transit', 'accountability', 'sovereignty', 'notary']);
const MAX_REQUIREMENTS = 10;

export function createEnvelope(input: CreateEnvelopeInput): MyelinEnvelope {
  return {
    id: crypto.randomUUID(),
    source: input.source,
    type: input.type,
    timestamp: new Date().toISOString(),
    ...(input.correlation_id ? { correlation_id: input.correlation_id } : {}),
    sovereignty: { ...input.sovereignty },
    ...(input.economics ? { economics: input.economics } : {}),
    ...(input.extensions ? { extensions: input.extensions } : {}),
    ...(input.requirements?.length ? { requirements: input.requirements } : {}),
    ...(input.sovereignty_required ? { sovereignty_required: input.sovereignty_required } : {}),
    ...(input.deadline ? { deadline: input.deadline } : {}),
    ...(input.distribution_mode ? { distribution_mode: input.distribution_mode } : {}),
    ...(input.target_principal ? { target_principal: input.target_principal } : {}),
    payload: input.payload,
  };
}

/**
 * Create an envelope and optionally sign it in one step.
 * When identity is provided, the envelope is Ed25519-signed.
 * When identity is null/undefined, returns an unsigned envelope (same as createEnvelope).
 */
export async function createSignedEnvelope(
  input: CreateEnvelopeInput,
  identity?: SigningIdentity | null,
): Promise<MyelinEnvelope> {
  const envelope = createEnvelope(input);
  if (!identity) return envelope;
  return signEnvelope(envelope, identity.privateKey, identity.did);
}

export function validateEnvelope(envelope: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (!envelope || typeof envelope !== 'object') {
    return { valid: false, errors: [{ field: 'envelope', message: 'must be an object' }] };
  }

  const e = envelope as Record<string, unknown>;

  if (typeof e.id !== 'string' || !UUID_RE.test(e.id)) {
    errors.push({ field: 'id', message: 'must be a valid UUID' });
  }

  if (typeof e.source !== 'string' || !SOURCE_RE.test(e.source)) {
    errors.push({ field: 'source', message: 'must match org.agent.instance pattern (3-5 segments, lowercase)' });
  }

  if (typeof e.type !== 'string' || !TYPE_RE.test(e.type)) {
    errors.push({ field: 'type', message: 'must match domain.entity.action pattern (2-5 segments, lowercase)' });
  }

  if (typeof e.timestamp !== 'string' || !ISO8601_RE.test(e.timestamp)) {
    errors.push({ field: 'timestamp', message: 'must be a valid ISO-8601 date-time (e.g., 2026-01-01T00:00:00Z)' });
  }

  if (e.correlation_id !== undefined && (typeof e.correlation_id !== 'string' || !UUID_RE.test(e.correlation_id))) {
    errors.push({ field: 'correlation_id', message: 'must be a valid UUID when present' });
  }

  if (!e.sovereignty || typeof e.sovereignty !== 'object' || Array.isArray(e.sovereignty)) {
    errors.push({ field: 'sovereignty', message: 'required object' });
  } else {
    const s = e.sovereignty as Record<string, unknown>;
    if (!CLASSIFICATIONS.has(s.classification as string)) {
      errors.push({ field: 'sovereignty.classification', message: 'must be local, federated, or public' });
    }
    if (typeof s.data_residency !== 'string' || !RESIDENCY_RE.test(s.data_residency)) {
      errors.push({ field: 'sovereignty.data_residency', message: 'must be ISO 3166-1 alpha-2 (e.g., CH, DE)' });
    }
    if (typeof s.max_hop !== 'number' || !Number.isInteger(s.max_hop) || s.max_hop < 0) {
      errors.push({ field: 'sovereignty.max_hop', message: 'must be a non-negative integer' });
    }
    if (typeof s.frontier_ok !== 'boolean') {
      errors.push({ field: 'sovereignty.frontier_ok', message: 'must be a boolean' });
    }
    if (!MODEL_CLASSES.has(s.model_class as string)) {
      errors.push({ field: 'sovereignty.model_class', message: 'must be local-only, frontier, or any' });
    }
    const sovAllowed = new Set(['classification', 'data_residency', 'max_hop', 'frontier_ok', 'model_class']);
    for (const key of Object.keys(s)) {
      if (!sovAllowed.has(key)) {
        errors.push({ field: `sovereignty.${key}`, message: 'unknown field (additionalProperties: false)' });
      }
    }
  }

  if (e.payload === undefined || e.payload === null || typeof e.payload !== 'object' || Array.isArray(e.payload)) {
    errors.push({ field: 'payload', message: 'required object (not array)' });
  }

  if (e.signed_by !== undefined) {
    if (!e.signed_by || typeof e.signed_by !== 'object') {
      errors.push({ field: 'signed_by', message: 'must be an object or array of stamps when present' });
    } else if (Array.isArray(e.signed_by)) {
      // myelin#31 — chain form. At least one stamp; each stamp validated independently.
      if (e.signed_by.length === 0) {
        errors.push({ field: 'signed_by', message: 'chain must contain at least one stamp when present' });
      } else if (e.signed_by.length > MAX_CHAIN_LENGTH) {
        errors.push({
          field: 'signed_by',
          message: `chain length ${e.signed_by.length} exceeds maximum ${MAX_CHAIN_LENGTH}`,
        });
      } else {
        e.signed_by.forEach((stamp, idx) => validateSignedByStamp(stamp, errors, `signed_by[${idx}]`));
      }
    } else {
      // Pre-#31 back-compat shim: a single stamp object. Validated under the
      // unprefixed `signed_by.*` field path so existing error messages keep working.
      validateSignedByStamp(e.signed_by, errors, 'signed_by');
    }
  }

  // F-021 task routing field validations
  if (e.requirements !== undefined) {
    if (!Array.isArray(e.requirements)) {
      errors.push({ field: 'requirements', message: 'must be an array of capability tags' });
    } else if (e.requirements.length > MAX_REQUIREMENTS) {
      errors.push({ field: 'requirements', message: `must contain at most ${MAX_REQUIREMENTS} capability tags` });
    } else {
      e.requirements.forEach((tag, idx) => {
        if (typeof tag !== 'string') {
          errors.push({ field: `requirements[${idx}]`, message: 'must be a string' });
        } else if (!CAPABILITY_TAG_RE.test(tag)) {
          errors.push({ field: `requirements[${idx}]`, message: 'must match capability tag pattern: 2-64 chars, starts with letter, ends with letter/digit, no trailing or consecutive hyphens' });
        }
      });
    }
  }

  if (e.sovereignty_required !== undefined && !SOVEREIGNTY_REQUIREMENTS.has(e.sovereignty_required as string)) {
    errors.push({ field: 'sovereignty_required', message: 'must be open, selective, strict, or bidding' });
  }

  if (e.deadline !== undefined && (typeof e.deadline !== 'string' || !ISO8601_RE.test(e.deadline))) {
    errors.push({ field: 'deadline', message: 'must be a valid ISO-8601 date-time when present' });
  }

  if (e.distribution_mode !== undefined && !DISTRIBUTION_MODES.has(e.distribution_mode as string)) {
    errors.push({ field: 'distribution_mode', message: 'must be broadcast, direct, or delegate' });
  }

  if (e.target_principal !== undefined && (typeof e.target_principal !== 'string' || !DID_RE.test(e.target_principal))) {
    errors.push({ field: 'target_principal', message: 'must be a DID string (did:mf:<name>)' });
  }

  if (e.economics !== undefined) {
    validateEconomics(e.economics, errors);
  }

  // Cross-field rule: direct/delegate require target_principal
  if ((e.distribution_mode === 'direct' || e.distribution_mode === 'delegate') && !e.target_principal) {
    errors.push({ field: 'target_principal', message: 'required when distribution_mode is direct or delegate' });
  }

  const allowedFields = new Set([
    'id', 'source', 'type', 'timestamp', 'correlation_id', 'sovereignty', 'signed_by', 'economics', 'extensions', 'payload',
    'requirements', 'sovereignty_required', 'deadline', 'distribution_mode', 'target_principal',
  ]);
  for (const key of Object.keys(e)) {
    if (!allowedFields.has(key)) {
      errors.push({ field: key, message: `unknown field (additionalProperties: false)` });
    }
  }

  return { valid: errors.length === 0, errors };
}

const CURRENCY_RE = /^[A-Z]{3}$/;
const MODEL_ID_RE = /^[a-z][a-z0-9-]*$/;

/**
 * Validate one stamp (myelin#31). `path` is the JSON pointer-ish field
 * prefix used in error messages — `"signed_by"` for the legacy single-object
 * shim, `"signed_by[N]"` for the chain form. Keeps error paths informative
 * for both shapes without duplicating the body.
 */
function validateSignedByStamp(value: unknown, errors: ValidationError[], path: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push({ field: path, message: 'must be an object' });
    return;
  }
  const sb = value as Record<string, unknown>;
  if (sb.method !== 'ed25519' && sb.method !== 'hub-stamp') {
    errors.push({ field: `${path}.method`, message: 'must be "ed25519" or "hub-stamp"' });
  }
  if (typeof sb.principal !== 'string' || !DID_RE.test(sb.principal)) {
    errors.push({ field: `${path}.principal`, message: 'must be a DID string (did:mf:<name>)' });
  }
  if (typeof sb.at !== 'string' || !ISO8601_RE.test(sb.at)) {
    errors.push({ field: `${path}.at`, message: 'must be a valid ISO-8601 timestamp' });
  }
  if (sb.method === 'ed25519') {
    if (typeof sb.signature !== 'string' || !BASE64_RE.test(sb.signature) || sb.signature.length < 88) {
      errors.push({ field: `${path}.signature`, message: 'required valid Base64 Ed25519 signature (≥88 chars)' });
    }
  }
  if (sb.method === 'hub-stamp') {
    if (typeof sb.stamped_by !== 'string' || !DID_RE.test(sb.stamped_by)) {
      errors.push({ field: `${path}.stamped_by`, message: 'required DID for hub-stamp method' });
    }
    if (typeof sb.signature !== 'string' || !BASE64_RE.test(sb.signature) || sb.signature.length < 88) {
      errors.push({ field: `${path}.signature`, message: 'required valid Base64 hub signature (≥88 chars)' });
    }
  }
  if (sb.role !== undefined && !STAMP_ROLES.has(sb.role as string)) {
    errors.push({
      field: `${path}.role`,
      message: 'must be one of: origin, transit, accountability, sovereignty, notary',
    });
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkNonNegativeInt(field: string, value: unknown, errors: ValidationError[]): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    errors.push({ field, message: 'must be a non-negative integer' });
  }
}

function checkPositiveInt(field: string, value: unknown, errors: ValidationError[]): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    errors.push({ field, message: 'must be a positive integer' });
  }
}

function checkNonNegativeNumber(field: string, value: unknown, errors: ValidationError[]): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    errors.push({ field, message: 'must be a non-negative finite number' });
  }
}

/**
 * F-15: validate the economics annotation block. All fields optional;
 * empty `{}` is valid (no constraints, no costs). Validation does NOT
 * enforce internal consistency (e.g., total_tokens === input + output)
 * because hubs aggregate across delegate chains where the relationship
 * is not arithmetic. Downstream tooling can apply that check.
 */
function validateEconomics(value: unknown, errors: ValidationError[]): void {
  if (!isPlainObject(value)) {
    errors.push({ field: 'economics', message: 'must be an object when present' });
    return;
  }
  if (value.budget !== undefined) {
    if (!isPlainObject(value.budget)) {
      errors.push({ field: 'economics.budget', message: 'must be an object when present' });
    } else {
      if (value.budget.max_tokens !== undefined) {
        checkPositiveInt('economics.budget.max_tokens', value.budget.max_tokens, errors);
      }
      if (value.budget.max_cost_usd !== undefined) {
        checkNonNegativeNumber('economics.budget.max_cost_usd', value.budget.max_cost_usd, errors);
      }
    }
  }
  if (value.actual !== undefined) {
    if (!isPlainObject(value.actual)) {
      errors.push({ field: 'economics.actual', message: 'must be an object when present' });
    } else {
      if (value.actual.input_tokens !== undefined) checkNonNegativeInt('economics.actual.input_tokens', value.actual.input_tokens, errors);
      if (value.actual.output_tokens !== undefined) checkNonNegativeInt('economics.actual.output_tokens', value.actual.output_tokens, errors);
      if (value.actual.total_tokens !== undefined) checkNonNegativeInt('economics.actual.total_tokens', value.actual.total_tokens, errors);
      if (value.actual.duration_ms !== undefined) checkNonNegativeInt('economics.actual.duration_ms', value.actual.duration_ms, errors);
      if (value.actual.cost_usd !== undefined) checkNonNegativeNumber('economics.actual.cost_usd', value.actual.cost_usd, errors);
      if (value.actual.model !== undefined) {
        if (typeof value.actual.model !== 'string' || !MODEL_ID_RE.test(value.actual.model)) {
          errors.push({ field: 'economics.actual.model', message: 'must be lowercase alphanumeric with hyphens' });
        }
      }
    }
  }
  if (value.wallet !== undefined) {
    if (typeof value.wallet !== 'string' || !DID_RE.test(value.wallet)) {
      errors.push({ field: 'economics.wallet', message: 'must be a DID string (did:mf:<name>)' });
    }
  }
  if (value.billing_ref !== undefined) {
    if (typeof value.billing_ref !== 'string' || value.billing_ref.length > 256) {
      errors.push({ field: 'economics.billing_ref', message: 'must be a string of at most 256 characters' });
    }
  }
  if (value.currency !== undefined) {
    if (typeof value.currency !== 'string' || !CURRENCY_RE.test(value.currency)) {
      errors.push({ field: 'economics.currency', message: 'must be ISO 4217 currency code (3 uppercase letters)' });
    }
  }
}

export function parseSovereignty(envelope: MyelinEnvelope): {
  canFederate: boolean;
  canReachFrontier: boolean;
  isLocalOnly: boolean;
  residency: string;
  maxHop: number;
} {
  const s = envelope.sovereignty;
  return {
    canFederate: s.classification !== 'local',
    canReachFrontier: s.frontier_ok && s.model_class !== 'local-only',
    isLocalOnly: s.classification === 'local',
    residency: s.data_residency,
    maxHop: s.max_hop,
  };
}

/**
 * Derive the NATS subject for an envelope.
 *
 * Envelope-bound shim around the pure-string {@link deriveSubject}
 * (in `./subjects`). Pulls `classification` from `envelope.sovereignty`
 * and `org` from the first segment of `envelope.source`, then delegates.
 *
 * `local.` and `federated.` subjects carry an operator-supplied `{stack}`
 * segment between `{org}` and `{type}` (myelin#113 — IAW Phase A.5). When
 * `stack` is omitted, the legacy 5-segment form is emitted; subscribers
 * default-derive that to `{org}.default.>` per `specs/namespace.md`
 * § Backward compatibility. `public.` subjects carry no `{stack}`.
 */
export function deriveNatsSubject(envelope: MyelinEnvelope, stack?: string): string {
  // `public.` early-return avoids the unnecessary `source.split('.')` work
  // when `deriveSubject` would discard `org` anyway (Sage R2).
  if (envelope.sovereignty.classification === 'public') {
    return deriveSubject('public', '', envelope.type, stack);
  }
  const org = envelope.source.split('.')[0]!;
  return deriveSubject(envelope.sovereignty.classification, org, envelope.type, stack);
}

// `SubjectForm`, `SubjectFormDetection`, `detectSubjectForm`, and the
// `STACK_SEGMENT_REGEX` constant moved to `./subjects` (Sage R5 nit —
// they're pure string-grammar utilities with no envelope dependency).
// Re-exported from this file above for backward compatibility with
// callers importing from `./envelope`.

export interface SubjectAlignment {
  aligned: boolean;
  expected: Classification;
  /**
   * The subject's actual prefix as found on the wire.
   *
   * Typed as `string` rather than `Classification` because mis-aligned
   * subjects carry non-classification values here — e.g., `'bogus'`,
   * `''`, or a malformed prefix. The old `as Classification` cast was a
   * type-safety lie (Sage R1). Callers that need a narrowed value can
   * gate on `aligned === true` (then `actual === expected`) or run
   * `isSubjectClassification(actual)` from `./subjects`.
   */
  actual: string;
  /** Wire form detected from the subject. */
  form: SubjectForm;
  /** Stack segment when `form === 'stack-aware'`; `undefined` otherwise. */
  stack?: string;
}

/**
 * Validate that a subject's prefix aligns with the envelope's classification,
 * and classify the wire form (myelin#113).
 *
 * Pass `stack` when the caller knows the operator's stack identity (transport
 * layer, dispatch path) so the form-detection heuristic can disambiguate the
 * collision case where the stack name equals the first type segment
 * (e.g., `stack='security'` + `type='security.scanner.triggered'`). Without
 * the hint, the validator falls back to comparing against `envelope.type` —
 * see {@link detectSubjectForm}.
 */
export function validateSubjectEnvelopeAlignment(
  subject: string,
  envelope: MyelinEnvelope,
  stack?: string,
): SubjectAlignment {
  const { aligned, expected, actual } = subjectPrefixAligns(
    subject,
    envelope.sovereignty.classification,
  );
  const { form, stack: detectedStack } = detectSubjectForm(subject, envelope.type, stack);

  return {
    aligned,
    expected,
    actual,
    form,
    stack: detectedStack,
  };
}
