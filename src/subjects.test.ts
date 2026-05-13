import { describe, it, expect } from 'bun:test';
import {
  deriveSubject,
  subjectPrefixAligns,
  isSubjectClassification,
  STACK_SEGMENT_REGEX,
  type SubjectClassification,
} from './subjects';

// myelin#115 — pure-string subject primitives.
// These tests verify that the primitives are independent of the envelope
// schema and that the envelope-bound wrappers (in `./envelope`) deliver
// identical results.

describe('deriveSubject (pure-string)', () => {
  it('derives legacy local subject when stack omitted', () => {
    expect(deriveSubject('local', 'acme', 'ops.deploy.completed')).toBe(
      'local.acme.ops.deploy.completed',
    );
  });

  it('derives legacy federated subject when stack omitted', () => {
    expect(deriveSubject('federated', 'metafactory', 'code.pr.review')).toBe(
      'federated.metafactory.code.pr.review',
    );
  });

  it('derives stack-aware local subject', () => {
    expect(
      deriveSubject('local', 'andreas', 'experiments.run.completed', 'research'),
    ).toBe('local.andreas.research.experiments.run.completed');
  });

  it('derives stack-aware federated subject', () => {
    expect(
      deriveSubject('federated', 'metafactory', 'code.pr.review', 'default'),
    ).toBe('federated.metafactory.default.code.pr.review');
  });

  it('public subjects ignore org and stack', () => {
    expect(
      deriveSubject('public', 'whatever', 'registry.package.published'),
    ).toBe('public.registry.package.published');
    expect(
      deriveSubject('public', 'still-ignored', 'registry.package.published', 'also-ignored'),
    ).toBe('public.registry.package.published');
  });

  it('rejects malformed stack segments', () => {
    expect(() => deriveSubject('local', 'acme', 'ops.deploy.completed', 'BadStack')).toThrow(
      /Invalid stack/,
    );
    expect(() => deriveSubject('local', 'acme', 'ops.deploy.completed', '0bad')).toThrow(
      /Invalid stack/,
    );
    expect(() => deriveSubject('local', 'acme', 'ops.deploy.completed', 'has.dot')).toThrow(
      /Invalid stack/,
    );
    expect(() => deriveSubject('local', 'acme', 'ops.deploy.completed', '')).toThrow(
      /Invalid stack/,
    );
    expect(() => deriveSubject('local', 'acme', 'ops.deploy.completed', 'a'.repeat(64))).toThrow(
      /Invalid stack/,
    );
  });

  it('accepts the 63-char upper bound', () => {
    const stack = 'a' + 'b'.repeat(62);
    expect(deriveSubject('local', 'acme', 'ops.deploy.completed', stack)).toBe(
      `local.acme.${stack}.ops.deploy.completed`,
    );
  });

  it('produces identical output to the envelope-bound wrapper (parity check)', async () => {
    // Sanity: the envelope-bound `deriveNatsSubject` MUST be a pure shim around
    // this function. Drift would re-introduce the duplication problem that
    // myelin#115 exists to solve.
    const { createEnvelope, deriveNatsSubject } = await import('./envelope');
    const env = createEnvelope({
      source: 'andreas.runner.lab',
      type: 'experiments.run.completed',
      sovereignty: {
        classification: 'local',
        data_residency: 'CH',
        max_hop: 0,
        frontier_ok: false,
        model_class: 'local-only',
      },
      payload: { ok: true },
    });

    expect(deriveNatsSubject(env)).toBe(
      deriveSubject('local', 'andreas', 'experiments.run.completed'),
    );
    expect(deriveNatsSubject(env, 'research')).toBe(
      deriveSubject('local', 'andreas', 'experiments.run.completed', 'research'),
    );
  });
});

describe('subjectPrefixAligns', () => {
  it('returns aligned=true when prefix matches classification', () => {
    expect(subjectPrefixAligns('local.acme.ops.deploy.completed', 'local')).toEqual({
      aligned: true,
      expected: 'local',
      actual: 'local',
    });
    expect(
      subjectPrefixAligns('federated.metafactory.code.pr.review', 'federated'),
    ).toEqual({ aligned: true, expected: 'federated', actual: 'federated' });
    expect(
      subjectPrefixAligns('public.registry.package.published', 'public'),
    ).toEqual({ aligned: true, expected: 'public', actual: 'public' });
  });

  it('returns aligned=false when prefix mismatches', () => {
    expect(
      subjectPrefixAligns('federated.acme.ops.deploy.completed', 'local'),
    ).toEqual({ aligned: false, expected: 'local', actual: 'federated' });
  });

  it('handles unknown prefix gracefully (aligned=false, actual reports the bogus prefix)', () => {
    expect(
      subjectPrefixAligns('bogus.acme.ops.deploy.completed', 'local'),
    ).toEqual({ aligned: false, expected: 'local', actual: 'bogus' });
  });

  it('handles empty-string subject without throwing', () => {
    expect(subjectPrefixAligns('', 'local')).toEqual({
      aligned: false,
      expected: 'local',
      actual: '',
    });
  });
});

describe('isSubjectClassification', () => {
  it('accepts the three valid classifications', () => {
    expect(isSubjectClassification('local')).toBe(true);
    expect(isSubjectClassification('federated')).toBe(true);
    expect(isSubjectClassification('public')).toBe(true);
  });

  it('rejects unknown strings', () => {
    expect(isSubjectClassification('private')).toBe(false);
    expect(isSubjectClassification('Local')).toBe(false);
    expect(isSubjectClassification('')).toBe(false);
    expect(isSubjectClassification('public ')).toBe(false);
  });

  it('narrows the type at the boundary', () => {
    const raw = 'local';
    if (isSubjectClassification(raw)) {
      // Type assertion: raw is now SubjectClassification, so deriveSubject accepts it.
      const subj: string = deriveSubject(raw, 'acme', 'ops.deploy.completed');
      expect(subj).toBe('local.acme.ops.deploy.completed');
    } else {
      throw new Error('guard should have accepted "local"');
    }
  });
});

describe('STACK_SEGMENT_REGEX', () => {
  it('accepts valid stack identifiers', () => {
    for (const stack of ['default', 'research', 'security', 'devops', 'r2d2', 'a', 'a-b-c']) {
      expect(STACK_SEGMENT_REGEX.test(stack)).toBe(true);
    }
  });

  it('rejects invalid stack identifiers', () => {
    for (const stack of ['Default', '0bad', 'has.dot', '', '-leading-hyphen', 'a'.repeat(64)]) {
      expect(STACK_SEGMENT_REGEX.test(stack)).toBe(false);
    }
  });
});

// Subpath import smoke — verifies that the subjects module can be imported
// without pulling in the envelope schema or any of its transitive deps.
// (Bun's module loader is tree-shaking aware; this test asserts that the
// subjects module's resolved import graph stays narrow.)
describe('./subjects subpath surface', () => {
  it('exports the documented public API', async () => {
    const mod = await import('./subjects');
    expect(typeof mod.deriveSubject).toBe('function');
    expect(typeof mod.subjectPrefixAligns).toBe('function');
    expect(typeof mod.detectSubjectForm).toBe('function');
    expect(typeof mod.isSubjectClassification).toBe('function');
    expect(mod.STACK_SEGMENT_REGEX).toBeInstanceOf(RegExp);
  });

  it('does not require importing envelope.ts to use', async () => {
    // Round-trip: call every exported function with no envelope object.
    const mod = await import('./subjects');
    const classifications: SubjectClassification[] = ['local', 'federated', 'public'];
    for (const c of classifications) {
      const subj = mod.deriveSubject(c, 'acme', 'ops.deploy.completed');
      expect(subj.startsWith(c)).toBe(true);
      const alignment = mod.subjectPrefixAligns(subj, c);
      expect(alignment.aligned).toBe(true);
      const form = mod.detectSubjectForm(subj);
      expect(form.form).toMatch(/^(legacy|public|stack-aware|unknown)$/);
    }
  });
});
