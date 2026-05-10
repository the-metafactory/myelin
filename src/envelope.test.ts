import { describe, it, expect } from 'bun:test';
import { utils, getPublicKeyAsync } from '@noble/ed25519';
import {
  createEnvelope,
  createSignedEnvelope,
  validateEnvelope,
  parseSovereignty,
  deriveNatsSubject,
  validateSubjectEnvelopeAlignment,
} from './envelope';
import { verifyEnvelopeIdentity } from './identity/verify';
import { createInMemoryRegistry } from './identity/registry';
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

describe('validateEnvelope — signed_by field', () => {
  it('accepts envelope without signed_by (backwards compatible)', () => {
    const env = createEnvelope(validInput);
    const result = validateEnvelope(env);
    expect(result.valid).toBe(true);
  });

  it('accepts envelope with valid ed25519 signed_by', () => {
    const env = {
      ...createEnvelope(validInput),
      signed_by: {
        method: 'ed25519',
        principal: 'did:mf:echo',
        signature: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        at: '2026-05-07T12:00:00Z',
      },
    };
    const result = validateEnvelope(env);
    expect(result.valid).toBe(true);
  });

  it('accepts envelope with valid hub-stamp signed_by', () => {
    const env = {
      ...createEnvelope(validInput),
      signed_by: {
        method: 'hub-stamp',
        principal: 'did:mf:echo',
        stamped_by: 'did:mf:hub.metafactory',
        signature: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        at: '2026-05-07T12:00:00Z',
      },
    };
    const result = validateEnvelope(env);
    expect(result.valid).toBe(true);
  });

  it('rejects invalid method', () => {
    const env = {
      ...createEnvelope(validInput),
      signed_by: {
        method: 'rsa',
        principal: 'did:mf:echo',
        at: '2026-05-07T12:00:00Z',
      },
    };
    const result = validateEnvelope(env);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'signed_by.method')).toBe(true);
  });

  it('rejects invalid principal DID format', () => {
    const env = {
      ...createEnvelope(validInput),
      signed_by: {
        method: 'ed25519',
        principal: 'echo',
        signature: 'short',
        at: '2026-05-07T12:00:00Z',
      },
    };
    const result = validateEnvelope(env);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'signed_by.principal')).toBe(true);
  });

  it('rejects ed25519 without signature', () => {
    const env = {
      ...createEnvelope(validInput),
      signed_by: {
        method: 'ed25519',
        principal: 'did:mf:echo',
        at: '2026-05-07T12:00:00Z',
      },
    };
    const result = validateEnvelope(env);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'signed_by.signature')).toBe(true);
  });

  it('rejects hub-stamp without stamped_by', () => {
    const env = {
      ...createEnvelope(validInput),
      signed_by: {
        method: 'hub-stamp',
        principal: 'did:mf:echo',
        at: '2026-05-07T12:00:00Z',
      },
    };
    const result = validateEnvelope(env);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'signed_by.stamped_by')).toBe(true);
  });
});

describe('createSignedEnvelope', () => {
  it('returns unsigned envelope when identity is null', async () => {
    const env = await createSignedEnvelope(validInput, null);
    expect(env.signed_by).toBeUndefined();
    expect(env.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(env.source).toBe(validInput.source);
  });

  it('returns unsigned envelope when identity is undefined', async () => {
    const env = await createSignedEnvelope(validInput);
    expect(env.signed_by).toBeUndefined();
  });

  it('returns signed envelope when identity is provided', async () => {
    const privKey = utils.randomSecretKey();
    const privKeyB64 = Buffer.from(privKey).toString('base64');

    const env = await createSignedEnvelope(validInput, {
      did: 'did:mf:test-bot',
      privateKey: privKeyB64,
    });

    expect(env.signed_by).toBeDefined();
    expect(env.signed_by!.method).toBe('ed25519');
    expect(env.signed_by!.principal).toBe('did:mf:test-bot');
  });

  it('signed envelope passes validation', async () => {
    const privKey = utils.randomSecretKey();
    const privKeyB64 = Buffer.from(privKey).toString('base64');

    const env = await createSignedEnvelope(validInput, {
      did: 'did:mf:test-bot',
      privateKey: privKeyB64,
    });

    const result = validateEnvelope(env);
    expect(result.valid).toBe(true);
  });

  it('E2E: signed envelope verifies against registry', async () => {
    const privKey = utils.randomSecretKey();
    const pubKey = await getPublicKeyAsync(privKey);
    const privKeyB64 = Buffer.from(privKey).toString('base64');
    const pubKeyB64 = Buffer.from(pubKey).toString('base64');

    const registry = createInMemoryRegistry();
    registry.add({
      id: 'did:mf:test-bot',
      display_name: 'Test Bot',
      operator: 'OP_TEST',
      public_key: pubKeyB64,
      type: 'agent',
      created_at: new Date().toISOString(),
    });

    const env = await createSignedEnvelope(validInput, {
      did: 'did:mf:test-bot',
      privateKey: privKeyB64,
    });

    const result = await verifyEnvelopeIdentity(env, registry);
    expect(result.status).toBe('verified');
    if (result.status === 'verified') {
      expect(result.principal.id).toBe('did:mf:test-bot');
      expect(result.method).toBe('ed25519');
    }
  });

  it('E2E: unsigned envelope returns rejected from verification', async () => {
    const env = await createSignedEnvelope(validInput, null);

    const registry = createInMemoryRegistry();
    const result = await verifyEnvelopeIdentity(env, registry);
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.reason).toContain('missing signed_by');
    }
  });

  it('throws on invalid DID format', async () => {
    const privKey = utils.randomSecretKey();
    const privKeyB64 = Buffer.from(privKey).toString('base64');

    await expect(
      createSignedEnvelope(validInput, { did: 'bad-did', privateKey: privKeyB64 }),
    ).rejects.toThrow('Invalid principal DID');
  });

  it('throws on wrong-length private key', async () => {
    const shortKey = Buffer.from(new Uint8Array(16)).toString('base64');

    await expect(
      createSignedEnvelope(validInput, { did: 'did:mf:test-bot', privateKey: shortKey }),
    ).rejects.toThrow('expected 32-byte');
  });
});

// F-021 task routing extension tests

describe('validateEnvelope — backwards compatibility', () => {
  it('accepts envelope without task routing fields', () => {
    const env = createEnvelope(validInput);
    expect(validateEnvelope(env).valid).toBe(true);
  });
});

describe('validateEnvelope — requirements', () => {
  const baseEnv = createEnvelope(validInput);

  it('accepts valid requirements array', () => {
    const env = { ...baseEnv, requirements: ['code-review', 'security-scan'] };
    expect(validateEnvelope(env).valid).toBe(true);
  });

  it('accepts empty requirements array', () => {
    const env = { ...baseEnv, requirements: [] };
    expect(validateEnvelope(env).valid).toBe(true);
  });

  it('rejects requirements exceeding 10 elements', () => {
    const env = { ...baseEnv, requirements: Array(11).fill('cap-x') };
    const r = validateEnvelope(env);
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.field === 'requirements' && e.message.includes('at most 10'))).toBe(true);
  });

  it('rejects invalid capability tag pattern (uppercase, spaces, digit-start)', () => {
    expect(validateEnvelope({ ...baseEnv, requirements: ['Code-Review'] }).valid).toBe(false);
    expect(validateEnvelope({ ...baseEnv, requirements: ['code review'] }).valid).toBe(false);
    expect(validateEnvelope({ ...baseEnv, requirements: ['1code'] }).valid).toBe(false);
  });

  it('rejects trailing hyphen (parses ambiguously in NATS subjects)', () => {
    expect(validateEnvelope({ ...baseEnv, requirements: ['code-'] }).valid).toBe(false);
  });

  it('rejects consecutive hyphens (parallel to DID_RE)', () => {
    expect(validateEnvelope({ ...baseEnv, requirements: ['code--review'] }).valid).toBe(false);
  });

  it('accepts non-adjacent hyphens', () => {
    expect(validateEnvelope({ ...baseEnv, requirements: ['code-review', 'security-scan-deep'] }).valid).toBe(true);
  });

  it('rejects single-char tags (collide with structured-identifier 1-char forms)', () => {
    expect(validateEnvelope({ ...baseEnv, requirements: ['x'] }).valid).toBe(false);
  });

  it('accepts 64-char tag (max length)', () => {
    const tag = 'a' + 'b'.repeat(63);
    expect(tag.length).toBe(64);
    expect(validateEnvelope({ ...baseEnv, requirements: [tag] }).valid).toBe(true);
  });

  it('rejects 65-char tag (over max)', () => {
    const tag = 'a' + 'b'.repeat(64);
    expect(tag.length).toBe(65);
    expect(validateEnvelope({ ...baseEnv, requirements: [tag] }).valid).toBe(false);
  });

  it('rejects non-string requirement', () => {
    const env = { ...baseEnv, requirements: ['code-review', 42 as unknown as string] };
    expect(validateEnvelope(env).valid).toBe(false);
  });

  it('rejects non-array requirements', () => {
    const env = { ...baseEnv, requirements: 'code-review' as unknown as string[] };
    expect(validateEnvelope(env).valid).toBe(false);
  });
});

describe('validateEnvelope — sovereignty_required', () => {
  const baseEnv = createEnvelope(validInput);

  it('accepts open, selective, strict, bidding', () => {
    expect(validateEnvelope({ ...baseEnv, sovereignty_required: 'open' }).valid).toBe(true);
    expect(validateEnvelope({ ...baseEnv, sovereignty_required: 'selective' }).valid).toBe(true);
    expect(validateEnvelope({ ...baseEnv, sovereignty_required: 'strict' }).valid).toBe(true);
    expect(validateEnvelope({ ...baseEnv, sovereignty_required: 'bidding' }).valid).toBe(true);
  });

  it('rejects invalid value', () => {
    const env = { ...baseEnv, sovereignty_required: 'lenient' as 'open' };
    expect(validateEnvelope(env).valid).toBe(false);
  });
});

describe('validateEnvelope — distribution_mode', () => {
  const baseEnv = createEnvelope(validInput);

  it('accepts broadcast, direct, delegate', () => {
    expect(validateEnvelope({ ...baseEnv, distribution_mode: 'broadcast' }).valid).toBe(true);
    expect(validateEnvelope({ ...baseEnv, distribution_mode: 'direct', target_principal: 'did:mf:forge' }).valid).toBe(true);
    expect(validateEnvelope({ ...baseEnv, distribution_mode: 'delegate', target_principal: 'did:mf:pilot' }).valid).toBe(true);
  });

  it('rejects invalid value', () => {
    const env = { ...baseEnv, distribution_mode: 'multicast' as 'broadcast' };
    expect(validateEnvelope(env).valid).toBe(false);
  });
});

describe('validateEnvelope — deadline', () => {
  const baseEnv = createEnvelope(validInput);

  it('accepts valid ISO-8601 datetime', () => {
    expect(validateEnvelope({ ...baseEnv, deadline: '2026-12-31T23:59:59Z' }).valid).toBe(true);
  });

  it('rejects invalid format', () => {
    expect(validateEnvelope({ ...baseEnv, deadline: 'tomorrow' }).valid).toBe(false);
    expect(validateEnvelope({ ...baseEnv, deadline: '2026-12-31' }).valid).toBe(false);
    expect(validateEnvelope({ ...baseEnv, deadline: 'PT1H' }).valid).toBe(false);
  });
});

describe('validateEnvelope — target_principal', () => {
  const baseEnv = createEnvelope(validInput);

  it('accepts valid DID', () => {
    expect(validateEnvelope({ ...baseEnv, target_principal: 'did:mf:forge' }).valid).toBe(true);
    expect(validateEnvelope({ ...baseEnv, target_principal: 'did:mf:hub.metafactory' }).valid).toBe(true);
  });

  it('rejects invalid DID format', () => {
    expect(validateEnvelope({ ...baseEnv, target_principal: 'forge' }).valid).toBe(false);
    expect(validateEnvelope({ ...baseEnv, target_principal: 'did:web:forge' }).valid).toBe(false);
  });
});

describe('validateEnvelope — cross-field rules', () => {
  const baseEnv = createEnvelope(validInput);

  it('rejects direct without target_principal', () => {
    const r = validateEnvelope({ ...baseEnv, distribution_mode: 'direct' });
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.field === 'target_principal' && e.message.includes('required when'))).toBe(true);
  });

  it('rejects delegate without target_principal', () => {
    const r = validateEnvelope({ ...baseEnv, distribution_mode: 'delegate' });
    expect(r.valid).toBe(false);
  });

  it('accepts broadcast without target_principal', () => {
    expect(validateEnvelope({ ...baseEnv, distribution_mode: 'broadcast' }).valid).toBe(true);
  });

  it('accepts broadcast with target_principal (ignored at routing layer)', () => {
    expect(validateEnvelope({ ...baseEnv, distribution_mode: 'broadcast', target_principal: 'did:mf:forge' }).valid).toBe(true);
  });

  it('accepts direct with target_principal', () => {
    expect(validateEnvelope({ ...baseEnv, distribution_mode: 'direct', target_principal: 'did:mf:forge' }).valid).toBe(true);
  });

  it('accepts delegate with target_principal', () => {
    expect(validateEnvelope({ ...baseEnv, distribution_mode: 'delegate', target_principal: 'did:mf:pilot' }).valid).toBe(true);
  });
});

describe('createEnvelope — task routing fields', () => {
  it('includes requirements when provided', () => {
    const env = createEnvelope({ ...validInput, requirements: ['code-review'] });
    expect(env.requirements).toEqual(['code-review']);
  });

  it('omits requirements when empty array', () => {
    const env = createEnvelope({ ...validInput, requirements: [] });
    expect(env.requirements).toBeUndefined();
  });

  it('omits requirements when undefined', () => {
    const env = createEnvelope(validInput);
    expect(env.requirements).toBeUndefined();
  });

  it('includes all distribution mode fields', () => {
    const env = createEnvelope({
      ...validInput,
      requirements: ['code-review'],
      sovereignty_required: 'strict',
      deadline: '2026-12-31T23:59:59Z',
      distribution_mode: 'direct',
      target_principal: 'did:mf:forge',
    });
    expect(env.sovereignty_required).toBe('strict');
    expect(env.deadline).toBe('2026-12-31T23:59:59Z');
    expect(env.distribution_mode).toBe('direct');
    expect(env.target_principal).toBe('did:mf:forge');
  });

  it('omits undefined task routing fields', () => {
    const env = createEnvelope(validInput);
    expect(env.sovereignty_required).toBeUndefined();
    expect(env.deadline).toBeUndefined();
    expect(env.distribution_mode).toBeUndefined();
    expect(env.target_principal).toBeUndefined();
  });
});
