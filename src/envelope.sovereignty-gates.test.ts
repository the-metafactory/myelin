import { describe, it, expect } from 'bun:test';
import {
  createEnvelope,
  validateEnvelope,
  parseSovereigntyBlock,
} from './envelope';
import type { CreateEnvelopeInput } from './types';

// myelin#260 (sovereignty engine 1/3, RFC-0005 §2.3/§2.5). Fixtures are copied
// verbatim from the RFC-0001 conformance pack
// (`specs/vectors/sovereignty/crossing.json`, kind `parseSovereigntyBlock`);
// each vector id is cited in the test name. The pack is not on myelin main, so
// the vectors are inlined here rather than imported cross-repo.
//
// Token note: reason tokens are kebab-cased. The codebase-wide snake flip is
// staged separately (myelin#233) — these spellings are intentionally NOT
// flipped, per the #260 task contract.

const validBlock = {
  classification: 'local',
  data_residency: 'CH',
  max_hop: 0,
  frontier_ok: false,
  model_class: 'local-only',
} as const;

describe('parseSovereigntyBlock — RFC-0005 §2.3/§2.5 conformance vectors', () => {
  it('block/all-five-present → valid', () => {
    expect(parseSovereigntyBlock(validBlock)).toEqual({ valid: true });
  });

  it('block/missing-model-class → missing-required-field', () => {
    const { model_class: _mc, ...noModelClass } = validBlock;
    expect(parseSovereigntyBlock(noModelClass)).toEqual({
      valid: false,
      reason: 'missing-required-field',
    });
  });

  it('block/unknown-subfield → unknown-field', () => {
    expect(parseSovereigntyBlock({ ...validBlock, model_class: 'any', region: 'emea' })).toEqual({
      valid: false,
      reason: 'unknown-field',
    });
  });

  it('residency/lowercase-rejected → residency-format', () => {
    expect(parseSovereigntyBlock({ ...validBlock, model_class: 'any', data_residency: 'ch' })).toEqual({
      valid: false,
      reason: 'residency-format',
    });
  });

  it('residency/unassigned-code-rejected → residency-unassigned (grill D5, closes OD-4)', () => {
    expect(parseSovereigntyBlock({ ...validBlock, model_class: 'any', data_residency: 'ZZ' })).toEqual({
      valid: false,
      reason: 'residency-unassigned',
    });
  });

  it('frontier/contradiction-rejected → unsatisfiable-model-placement (grill D2, closes OD-1)', () => {
    expect(
      parseSovereigntyBlock({ ...validBlock, frontier_ok: false, model_class: 'frontier' }),
    ).toEqual({ valid: false, reason: 'unsatisfiable-model-placement' });
  });

  it('rejects a non-object block → not-object', () => {
    expect(parseSovereigntyBlock(null)).toEqual({ valid: false, reason: 'not-object' });
    expect(parseSovereigntyBlock([])).toEqual({ valid: false, reason: 'not-object' });
  });

  it('accepts EU and every assigned code family; XX is unassigned', () => {
    expect(parseSovereigntyBlock({ ...validBlock, model_class: 'any', data_residency: 'EU' })).toEqual({ valid: true });
    expect(parseSovereigntyBlock({ ...validBlock, model_class: 'any', data_residency: 'XX' })).toEqual({
      valid: false,
      reason: 'residency-unassigned',
    });
  });
});

// The accumulate-all `validateEnvelope` path must reject the same shapes — this
// is the enforcement seam an emitter actually hits. Acceptance criteria of #260.
describe('validateEnvelope — block gates (RFC-0005 §2.3/§2.5)', () => {
  const baseInput: CreateEnvelopeInput = {
    source: 'acme.monitor.prod-01',
    type: 'ops.deploy.completed',
    sovereignty: { ...validBlock },
    payload: { ok: true },
  };

  it('accepts a valid envelope (assigned residency, satisfiable placement)', () => {
    const result = validateEnvelope(createEnvelope(baseInput));
    expect(result.valid).toBe(true);
  });

  it('rejects frontier_ok:false + model_class:"frontier" at validation (frontier/contradiction-rejected)', () => {
    const env = createEnvelope(baseInput);
    (env.sovereignty as { frontier_ok: boolean }).frontier_ok = false;
    (env.sovereignty as { model_class: string }).model_class = 'frontier';
    const result = validateEnvelope(env);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'sovereignty')).toBe(true);
  });

  it('rejects an unassigned residency code ZZ at validation (residency/unassigned-code-rejected)', () => {
    const env = createEnvelope(baseInput);
    (env.sovereignty as { data_residency: string }).data_residency = 'ZZ';
    const result = validateEnvelope(env);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'sovereignty.data_residency')).toBe(true);
  });

  it('still accepts a well-formed assigned code (EU)', () => {
    const env = createEnvelope(baseInput);
    (env.sovereignty as { data_residency: string }).data_residency = 'EU';
    (env.sovereignty as { model_class: string }).model_class = 'any';
    expect(validateEnvelope(env).valid).toBe(true);
  });
});
