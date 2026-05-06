import { describe, it, expect } from 'bun:test';
import {
  createEnvelope,
  validateEnvelope,
  parseSovereignty,
  deriveNatsSubject,
  validateSubjectEnvelopeAlignment,
} from './envelope';
import type { CreateEnvelopeInput } from './types';

const validInput: CreateEnvelopeInput = {
  source: 'acme.monitor.prod-01',
  type: 'ops.deploy.completed',
  sovereignty: {
    classification: 'local',
    data_residency: 'DE',
    max_hop: 0,
    frontier_ok: false,
    model_class: 'local-only',
  },
  payload: { version: '2.4.1' },
};

describe('createEnvelope', () => {
  it('produces a valid envelope with UUID and timestamp', () => {
    const env = createEnvelope(validInput);
    expect(env.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(env.source).toBe('acme.monitor.prod-01');
    expect(env.type).toBe('ops.deploy.completed');
    expect(new Date(env.timestamp).getTime()).not.toBeNaN();
    expect(env.sovereignty.classification).toBe('local');
    expect(env.payload).toEqual({ version: '2.4.1' });
  });

  it('includes correlation_id when provided', () => {
    const env = createEnvelope({ ...validInput, correlation_id: '550e8400-e29b-41d4-a716-446655440000' });
    expect(env.correlation_id).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('omits correlation_id when not provided', () => {
    const env = createEnvelope(validInput);
    expect('correlation_id' in env).toBe(false);
  });

  it('includes extensions when provided', () => {
    const env = createEnvelope({ ...validInput, extensions: { trace_id: 'abc' } });
    expect(env.extensions).toEqual({ trace_id: 'abc' });
  });
});

describe('validateEnvelope', () => {
  it('accepts a valid envelope', () => {
    const env = createEnvelope(validInput);
    const result = validateEnvelope(env);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects missing sovereignty', () => {
    const { sovereignty, ...rest } = createEnvelope(validInput);
    const result = validateEnvelope(rest);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'sovereignty')).toBe(true);
  });

  it('rejects invalid source pattern', () => {
    const env = { ...createEnvelope(validInput), source: 'bad' };
    const result = validateEnvelope(env);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'source')).toBe(true);
  });

  it('rejects invalid classification', () => {
    const env = createEnvelope(validInput);
    (env.sovereignty as any).classification = 'secret';
    const result = validateEnvelope(env);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'sovereignty.classification')).toBe(true);
  });

  it('rejects non-integer max_hop', () => {
    const env = createEnvelope(validInput);
    (env.sovereignty as any).max_hop = 1.5;
    const result = validateEnvelope(env);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'sovereignty.max_hop')).toBe(true);
  });

  it('rejects invalid data_residency', () => {
    const env = createEnvelope(validInput);
    (env.sovereignty as any).data_residency = 'Switzerland';
    const result = validateEnvelope(env);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'sovereignty.data_residency')).toBe(true);
  });

  it('rejects non-object input', () => {
    const result = validateEnvelope('not an object');
    expect(result.valid).toBe(false);
  });

  it('accepts valid correlation_id', () => {
    const env = createEnvelope({ ...validInput, correlation_id: '550e8400-e29b-41d4-a716-446655440000' });
    const result = validateEnvelope(env);
    expect(result.valid).toBe(true);
  });

  it('rejects invalid correlation_id', () => {
    const env = { ...createEnvelope(validInput), correlation_id: 'not-a-uuid' };
    const result = validateEnvelope(env);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'correlation_id')).toBe(true);
  });

  it('rejects additional properties', () => {
    const env = { ...createEnvelope(validInput), rogue_field: true };
    const result = validateEnvelope(env);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'rogue_field')).toBe(true);
  });

  it('rejects array payload', () => {
    const env = { ...createEnvelope(validInput), payload: [1, 2, 3] };
    const result = validateEnvelope(env);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'payload')).toBe(true);
  });

  it('rejects non-ISO timestamp format', () => {
    const env = { ...createEnvelope(validInput), timestamp: 'Jan 1 2020' };
    const result = validateEnvelope(env);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'timestamp')).toBe(true);
  });

  it('rejects additional sovereignty properties', () => {
    const env = createEnvelope(validInput);
    (env.sovereignty as any).rogue = true;
    const result = validateEnvelope(env);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'sovereignty.rogue')).toBe(true);
  });

  it('rejects array sovereignty', () => {
    const env = { ...createEnvelope(validInput), sovereignty: [1, 2] };
    const result = validateEnvelope(env);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'sovereignty')).toBe(true);
  });
});

describe('parseSovereignty', () => {
  it('parses local envelope correctly', () => {
    const env = createEnvelope(validInput);
    const parsed = parseSovereignty(env);
    expect(parsed.isLocalOnly).toBe(true);
    expect(parsed.canFederate).toBe(false);
    expect(parsed.canReachFrontier).toBe(false);
    expect(parsed.residency).toBe('DE');
    expect(parsed.maxHop).toBe(0);
  });

  it('parses federated + frontier envelope', () => {
    const env = createEnvelope({
      ...validInput,
      sovereignty: {
        classification: 'federated',
        data_residency: 'CH',
        max_hop: 2,
        frontier_ok: true,
        model_class: 'frontier',
      },
    });
    const parsed = parseSovereignty(env);
    expect(parsed.isLocalOnly).toBe(false);
    expect(parsed.canFederate).toBe(true);
    expect(parsed.canReachFrontier).toBe(true);
    expect(parsed.residency).toBe('CH');
    expect(parsed.maxHop).toBe(2);
  });

  it('frontier_ok=true but model_class=local-only means no frontier', () => {
    const env = createEnvelope({
      ...validInput,
      sovereignty: {
        classification: 'federated',
        data_residency: 'US',
        max_hop: 1,
        frontier_ok: true,
        model_class: 'local-only',
      },
    });
    const parsed = parseSovereignty(env);
    expect(parsed.canReachFrontier).toBe(false);
  });
});

describe('deriveNatsSubject', () => {
  it('derives local subject with org prefix', () => {
    const env = createEnvelope(validInput);
    expect(deriveNatsSubject(env)).toBe('local.acme.ops.deploy.completed');
  });

  it('derives federated subject with org prefix', () => {
    const env = createEnvelope({
      ...validInput,
      source: 'metafactory.pilot.local',
      type: 'code.pr.review',
      sovereignty: { ...validInput.sovereignty, classification: 'federated' },
    });
    expect(deriveNatsSubject(env)).toBe('federated.metafactory.code.pr.review');
  });

  it('derives public subject without org prefix', () => {
    const env = createEnvelope({
      ...validInput,
      type: 'registry.package.published',
      sovereignty: { ...validInput.sovereignty, classification: 'public' },
    });
    expect(deriveNatsSubject(env)).toBe('public.registry.package.published');
  });
});

describe('validateSubjectEnvelopeAlignment', () => {
  it('detects aligned subject', () => {
    const env = createEnvelope(validInput);
    const result = validateSubjectEnvelopeAlignment('local.acme.ops.deploy.completed', env);
    expect(result.aligned).toBe(true);
  });

  it('detects misaligned subject', () => {
    const env = createEnvelope(validInput);
    const result = validateSubjectEnvelopeAlignment('federated.acme.ops.deploy.completed', env);
    expect(result.aligned).toBe(false);
    expect(result.expected).toBe('local');
    expect(result.actual).toBe('federated');
  });
});
