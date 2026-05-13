import { describe, it, expect } from 'bun:test';
import { utils, getPublicKeyAsync } from '@noble/ed25519';
import {
  createEnvelope,
  createSignedEnvelope,
  validateEnvelope,
  parseSovereignty,
  deriveNatsSubject,
  validateSubjectEnvelopeAlignment,
  detectSubjectForm,
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
  it('derives local subject with org prefix (legacy, stack omitted)', () => {
    const env = createEnvelope(validInput);
    expect(deriveNatsSubject(env)).toBe('local.acme.ops.deploy.completed');
  });

  it('derives federated subject with org prefix (legacy, stack omitted)', () => {
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

  // myelin#113 — stack-aware emit (IAW Phase A.5)
  it('derives local subject with explicit stack segment', () => {
    const env = createEnvelope({
      ...validInput,
      source: 'andreas.runner.lab',
      type: 'experiments.run.completed',
    });
    expect(deriveNatsSubject(env, 'research')).toBe(
      'local.andreas.research.experiments.run.completed',
    );
  });

  it('derives federated subject with explicit stack segment', () => {
    const env = createEnvelope({
      ...validInput,
      source: 'metafactory.pilot.local',
      type: 'code.pr.review',
      sovereignty: { ...validInput.sovereignty, classification: 'federated' },
    });
    expect(deriveNatsSubject(env, 'default')).toBe(
      'federated.metafactory.default.code.pr.review',
    );
  });

  it('emits stack=default explicitly when caller opts in', () => {
    const env = createEnvelope(validInput);
    expect(deriveNatsSubject(env, 'default')).toBe(
      'local.acme.default.ops.deploy.completed',
    );
  });

  it('ignores stack argument for public subjects (no org-scope, no stack)', () => {
    const env = createEnvelope({
      ...validInput,
      type: 'registry.package.published',
      sovereignty: { ...validInput.sovereignty, classification: 'public' },
    });
    expect(deriveNatsSubject(env, 'research')).toBe('public.registry.package.published');
  });

  it('rejects malformed stack segments', () => {
    const env = createEnvelope(validInput);
    expect(() => deriveNatsSubject(env, 'BadStack')).toThrow(/Invalid stack/);
    expect(() => deriveNatsSubject(env, '0bad')).toThrow(/Invalid stack/);
    expect(() => deriveNatsSubject(env, 'has.dot')).toThrow(/Invalid stack/);
    expect(() => deriveNatsSubject(env, '')).toThrow(/Invalid stack/);
    expect(() => deriveNatsSubject(env, 'a'.repeat(64))).toThrow(/Invalid stack/);
  });

  it('accepts a 63-char stack segment at the upper bound', () => {
    const env = createEnvelope(validInput);
    const stack = 'a' + 'b'.repeat(62);
    expect(deriveNatsSubject(env, stack)).toBe(
      `local.acme.${stack}.ops.deploy.completed`,
    );
  });
});

describe('validateSubjectEnvelopeAlignment', () => {
  it('detects aligned subject (legacy form)', () => {
    const env = createEnvelope(validInput);
    const result = validateSubjectEnvelopeAlignment('local.acme.ops.deploy.completed', env);
    expect(result.aligned).toBe(true);
    expect(result.form).toBe('legacy');
    expect(result.stack).toBeUndefined();
  });

  it('detects misaligned subject', () => {
    const env = createEnvelope(validInput);
    const result = validateSubjectEnvelopeAlignment('federated.acme.ops.deploy.completed', env);
    expect(result.aligned).toBe(false);
    expect(result.expected).toBe('local');
    expect(result.actual).toBe('federated');
  });

  // myelin#113 — stack-aware alignment
  it('detects aligned subject (stack-aware form) and exposes the stack', () => {
    const env = createEnvelope({
      ...validInput,
      source: 'andreas.runner.lab',
      type: 'experiments.run.completed',
    });
    const result = validateSubjectEnvelopeAlignment(
      'local.andreas.research.experiments.run.completed',
      env,
    );
    expect(result.aligned).toBe(true);
    expect(result.form).toBe('stack-aware');
    expect(result.stack).toBe('research');
  });

  it('detects aligned federated subject (stack-aware) with default stack', () => {
    const env = createEnvelope({
      ...validInput,
      source: 'metafactory.pilot.local',
      type: 'code.pr.review',
      sovereignty: { ...validInput.sovereignty, classification: 'federated' },
    });
    const result = validateSubjectEnvelopeAlignment(
      'federated.metafactory.default.code.pr.review',
      env,
    );
    expect(result.aligned).toBe(true);
    expect(result.form).toBe('stack-aware');
    expect(result.stack).toBe('default');
  });

  it('detects public subject as the public form (no stack)', () => {
    const env = createEnvelope({
      ...validInput,
      type: 'registry.package.published',
      sovereignty: { ...validInput.sovereignty, classification: 'public' },
    });
    const result = validateSubjectEnvelopeAlignment('public.registry.package.published', env);
    expect(result.aligned).toBe(true);
    expect(result.form).toBe('public');
    expect(result.stack).toBeUndefined();
  });

  // Roundtrip: legacy envelope → derive subject → validate → re-derive same subject
  it('round-trips a legacy-shape envelope cleanly via the default-stack pathway', () => {
    const env = createEnvelope({
      ...validInput,
      source: 'andreas.runner.lab',
      type: 'experiments.run.completed',
    });
    const legacySubject = deriveNatsSubject(env);
    expect(legacySubject).toBe('local.andreas.experiments.run.completed');

    // Subscriber semantics: a `local.andreas.research.>` filter does NOT match the
    // legacy form, but a stack-omitted subscriber on `local.andreas.>` does — and
    // the default-derivation rule documented in specs/namespace.md tells the
    // subscriber to treat it as `andreas/default`. Alignment validates regardless
    // and reports `form='legacy'`.
    const legacyAlignment = validateSubjectEnvelopeAlignment(legacySubject, env);
    expect(legacyAlignment.aligned).toBe(true);
    expect(legacyAlignment.form).toBe('legacy');
    expect(legacyAlignment.stack).toBeUndefined();

    // Same envelope, explicit stack=default — produces 6-segment form that a
    // stack-aware subscriber on `local.andreas.default.>` matches.
    const stackAware = deriveNatsSubject(env, 'default');
    expect(stackAware).toBe('local.andreas.default.experiments.run.completed');
    const stackAlignment = validateSubjectEnvelopeAlignment(stackAware, env);
    expect(stackAlignment.aligned).toBe(true);
    expect(stackAlignment.form).toBe('stack-aware');
    expect(stackAlignment.stack).toBe('default');
  });

  // Sage R2 finding #1 + R3 segment-counting tiebreaker — stack-name / type-prefix collision
  it('resolves stack-name / type-prefix collision via segment-counting tiebreaker (no hint required)', () => {
    // Operator picks `stack=security` and publishes a signal whose type begins with `security.`.
    // The pure content heuristic (slot2 vs envTypeFirst) cannot distinguish; the structural
    // tiebreaker (segments.length vs typeSegs.length + 2) does.
    const env = createEnvelope({
      ...validInput,
      source: 'metafactory.scanner.prod',
      type: 'security.scanner.triggered',
    });
    const subject = deriveNatsSubject(env, 'security');
    expect(subject).toBe('local.metafactory.security.security.scanner.triggered');
    // 6 segments; type has 3 segments; 6 > 2+3 ⇒ stack-aware, no caller hint needed.

    const stateless = validateSubjectEnvelopeAlignment(subject, env);
    expect(stateless.aligned).toBe(true);
    expect(stateless.form).toBe('stack-aware');
    expect(stateless.stack).toBe('security');

    // The caller-supplied stack hint still works as an explicit override.
    const hinted = validateSubjectEnvelopeAlignment(subject, env, 'security');
    expect(hinted.aligned).toBe(true);
    expect(hinted.form).toBe('stack-aware');
    expect(hinted.stack).toBe('security');

    // Legacy variant of the same envelope: 5 segments, slot2='security', envTypeFirst='security'.
    // 5 == 2+3 ⇒ tiebreaker correctly falls back to legacy.
    const legacy = `local.metafactory.${env.type}`;
    expect(legacy).toBe('local.metafactory.security.scanner.triggered');
    const legacyAlignment = validateSubjectEnvelopeAlignment(legacy, env);
    expect(legacyAlignment.aligned).toBe(true);
    expect(legacyAlignment.form).toBe('legacy');
    expect(legacyAlignment.stack).toBeUndefined();
  });

  // Sage finding #3 (nit) — unknown-prefix variant
  it('reports form="unknown" for unrecognized prefixes', () => {
    const env = createEnvelope(validInput);
    const result = validateSubjectEnvelopeAlignment('bogus.acme.ops.deploy.completed', env);
    expect(result.aligned).toBe(false);
    expect(result.form).toBe('unknown');
    expect(result.stack).toBeUndefined();
  });
});

// Sage finding #2 (suggestion) — standalone subject classifier without an envelope
describe('detectSubjectForm', () => {
  it('classifies public subjects without any hint', () => {
    expect(detectSubjectForm('public.registry.package.published')).toEqual({ form: 'public' });
  });

  it('classifies stack-aware local subjects with no hint by defaulting to stack-aware', () => {
    const result = detectSubjectForm('local.andreas.research.experiments.run.completed');
    expect(result).toEqual({ form: 'stack-aware', stack: 'research' });
  });

  it('falls back to envelope-type hint when stack hint is absent', () => {
    // Same subject; envelopeType says first type segment is "research" — so slot2 is the type prefix.
    const result = detectSubjectForm(
      'local.andreas.research.experiments.run.completed',
      'research.experiments.run.completed',
    );
    expect(result).toEqual({ form: 'legacy' });
  });

  it('prefers caller-supplied stack hint over envelope-type heuristic', () => {
    // Collision case: stack=security AND type starts with security.*
    const result = detectSubjectForm(
      'local.metafactory.security.security.scanner.triggered',
      'security.scanner.triggered',
      'security',
    );
    expect(result).toEqual({ form: 'stack-aware', stack: 'security' });
  });

  // Sage R3 — segment-counting tiebreaker
  it('uses segment-count tiebreaker when slot2 collides with envTypeFirst', () => {
    // Stack-aware: 6 segments, type has 3 → 6 > 5 → stack-aware
    expect(
      detectSubjectForm(
        'local.metafactory.security.security.scanner.triggered',
        'security.scanner.triggered',
      ),
    ).toEqual({ form: 'stack-aware', stack: 'security' });

    // Legacy: 5 segments, type has 3 → 5 == 5 → legacy
    expect(
      detectSubjectForm(
        'local.metafactory.security.scanner.triggered',
        'security.scanner.triggered',
      ),
    ).toEqual({ form: 'legacy' });
  });

  it('returns form="unknown" for unrecognized prefixes', () => {
    expect(detectSubjectForm('weird.thing.happened')).toEqual({ form: 'unknown' });
  });

  it('returns form="legacy" when slot2 is missing or malformed', () => {
    // Subject too short to have slot2
    expect(detectSubjectForm('local.acme')).toEqual({ form: 'legacy' });
    // slot2 contains uppercase — fails STACK_SEGMENT_REGEX
    expect(detectSubjectForm('local.acme.BadSeg.ops.deploy.completed')).toEqual({
      form: 'legacy',
    });
  });

  it('handles the every-hint-aligned case (stack hint matches, slot2 matches, envelopeType differs)', () => {
    // Caller knows stack=research; subject has slot2=research; envelopeType doesn't start with research.
    // All signals point to stack-aware.
    const result = detectSubjectForm(
      'local.andreas.research.experiments.run.completed',
      'experiments.run.completed',
      'research',
    );
    expect(result).toEqual({ form: 'stack-aware', stack: 'research' });
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
    expect(env.signed_by).toHaveLength(1);
    expect(env.signed_by![0]!.method).toBe('ed25519');
    expect(env.signed_by![0]!.principal).toBe('did:mf:test-bot');
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
