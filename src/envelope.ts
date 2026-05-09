import type {
  MyelinEnvelope,
  CreateEnvelopeInput,
  ValidationResult,
  ValidationError,
  Classification,
} from './types';
import type { SigningIdentity } from './identity/types';
import { DID_RE, BASE64_RE } from './identity/types';
import { signEnvelope } from './identity/sign';
import { UUID_RE } from './uuid';

const SOURCE_RE = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){2,4}$/;
const TYPE_RE = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){1,4}$/;
const RESIDENCY_RE = /^[A-Z]{2}$/;
const ISO8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
// Capability tag: 2-64 chars, starts with letter, ends with letter/digit,
// no trailing or consecutive hyphens. Mirrors DID_RE's `--` rejection so tags
// stay safe to embed in NATS subjects, KV keys, and file paths downstream.
// (Single-char tags excluded — none in the seed taxonomy and they collide
//  with the 1-char forms of structured identifiers.)
const CAPABILITY_TAG_RE = /^[a-z](?:[a-z0-9]|-(?!-)){0,62}[a-z0-9]$/;

const CLASSIFICATIONS = new Set(['local', 'federated', 'public']);
const MODEL_CLASSES = new Set(['local-only', 'frontier', 'any']);
const SOVEREIGNTY_REQUIREMENTS = new Set(['open', 'selective', 'strict']);
const DISTRIBUTION_MODES = new Set(['broadcast', 'direct', 'delegate']);
const MAX_REQUIREMENTS = 10;

export function createEnvelope(input: CreateEnvelopeInput): MyelinEnvelope {
  return {
    id: crypto.randomUUID(),
    source: input.source,
    type: input.type,
    timestamp: new Date().toISOString(),
    ...(input.correlation_id ? { correlation_id: input.correlation_id } : {}),
    sovereignty: { ...input.sovereignty },
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
    if (!e.signed_by || typeof e.signed_by !== 'object' || Array.isArray(e.signed_by)) {
      errors.push({ field: 'signed_by', message: 'must be an object when present' });
    } else {
      const sb = e.signed_by as Record<string, unknown>;
      if (sb.method !== 'ed25519' && sb.method !== 'hub-stamp') {
        errors.push({ field: 'signed_by.method', message: 'must be "ed25519" or "hub-stamp"' });
      }
      if (typeof sb.principal !== 'string' || !DID_RE.test(sb.principal)) {
        errors.push({ field: 'signed_by.principal', message: 'must be a DID string (did:mf:<name>)' });
      }
      if (typeof sb.at !== 'string' || !ISO8601_RE.test(sb.at)) {
        errors.push({ field: 'signed_by.at', message: 'must be a valid ISO-8601 timestamp' });
      }
      if (sb.method === 'ed25519') {
        if (typeof sb.signature !== 'string' || !BASE64_RE.test(sb.signature) || sb.signature.length < 88) {
          errors.push({ field: 'signed_by.signature', message: 'required valid Base64 Ed25519 signature (≥88 chars)' });
        }
      }
      if (sb.method === 'hub-stamp') {
        if (typeof sb.stamped_by !== 'string' || !DID_RE.test(sb.stamped_by)) {
          errors.push({ field: 'signed_by.stamped_by', message: 'required DID for hub-stamp method' });
        }
        if (typeof sb.signature !== 'string' || !BASE64_RE.test(sb.signature) || sb.signature.length < 88) {
          errors.push({ field: 'signed_by.signature', message: 'required valid Base64 hub signature (≥88 chars)' });
        }
      }
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
    errors.push({ field: 'sovereignty_required', message: 'must be open, selective, or strict' });
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

export function deriveNatsSubject(envelope: MyelinEnvelope): string {
  const prefix = envelope.sovereignty.classification;
  const org = envelope.source.split('.')[0];

  if (prefix === 'public') {
    return `public.${envelope.type}`;
  }
  return `${prefix}.${org}.${envelope.type}`;
}

export function validateSubjectEnvelopeAlignment(
  subject: string,
  envelope: MyelinEnvelope,
): { aligned: boolean; expected: Classification; actual: Classification } {
  const subjectPrefix = subject.split('.')[0] as Classification;
  const envelopeClassification = envelope.sovereignty.classification;
  return {
    aligned: subjectPrefix === envelopeClassification,
    expected: envelopeClassification,
    actual: subjectPrefix,
  };
}
