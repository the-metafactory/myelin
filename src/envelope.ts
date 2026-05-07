import type {
  MyelinEnvelope,
  CreateEnvelopeInput,
  ValidationResult,
  ValidationError,
  Classification,
} from './types';

const SOURCE_RE = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){2,4}$/;
const TYPE_RE = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){1,4}$/;
const RESIDENCY_RE = /^[A-Z]{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const CLASSIFICATIONS = new Set(['local', 'federated', 'public']);
const MODEL_CLASSES = new Set(['local-only', 'frontier', 'any']);

export function createEnvelope(input: CreateEnvelopeInput): MyelinEnvelope {
  return {
    id: crypto.randomUUID(),
    source: input.source,
    type: input.type,
    timestamp: new Date().toISOString(),
    ...(input.correlation_id ? { correlation_id: input.correlation_id } : {}),
    sovereignty: { ...input.sovereignty },
    ...(input.extensions ? { extensions: input.extensions } : {}),
    payload: input.payload,
  };
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
      const DID_RE = /^did:mf:[a-z][a-z0-9._-]+$/;
      if (sb.method !== 'ed25519' && sb.method !== 'hub-stamp') {
        errors.push({ field: 'signed_by.method', message: 'must be "ed25519" or "hub-stamp"' });
      }
      if (typeof sb.principal !== 'string' || !DID_RE.test(sb.principal)) {
        errors.push({ field: 'signed_by.principal', message: 'must be a DID string (did:mf:<name>)' });
      }
      if (typeof sb.at !== 'string' || !ISO8601_RE.test(sb.at)) {
        errors.push({ field: 'signed_by.at', message: 'must be a valid ISO-8601 timestamp' });
      }
      if (sb.method === 'ed25519' && (typeof sb.signature !== 'string' || sb.signature.length === 0)) {
        errors.push({ field: 'signed_by.signature', message: 'required for ed25519 method' });
      }
      if (sb.method === 'hub-stamp' && (typeof sb.stamped_by !== 'string' || !DID_RE.test(sb.stamped_by))) {
        errors.push({ field: 'signed_by.stamped_by', message: 'required DID for hub-stamp method' });
      }
    }
  }

  const allowedFields = new Set(['id', 'source', 'type', 'timestamp', 'correlation_id', 'sovereignty', 'signed_by', 'economics', 'extensions', 'payload']);
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
