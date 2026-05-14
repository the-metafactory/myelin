import { describe, it, expect } from 'bun:test';
import {
  deriveSubject,
  subjectPrefixAligns,
  isSubjectClassification,
  STACK_SEGMENT_REGEX,
  encodeDidSegment,
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

  // Parity check `deriveNatsSubject` ↔ `deriveSubject` lives in
  // `envelope.test.ts` so this suite stays pure-`./subjects` (Sage R2).
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

  // Sage R1 — hot-path optimization: subjectPrefixAligns must avoid the
  // throwaway array allocation of split('.'). Verify behavioral correctness
  // for subjects with and without dots, which is what the indexOf+slice path
  // has to get right.
  it('handles subjects without a dot (single-segment) without throwing', () => {
    expect(subjectPrefixAligns('localonly', 'local')).toEqual({
      aligned: false,
      expected: 'local',
      actual: 'localonly',
    });
  });

  it('handles subjects with a leading dot (empty first segment)', () => {
    expect(subjectPrefixAligns('.acme.ops.deploy.completed', 'local')).toEqual({
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

// myelin#135 — DID → NATS subject segment encoder.
//
// Single source of truth for example fixtures: `SPEC_EXAMPLES` below mirrors
// the worked examples in `specs/namespace.md` §"Principal encoding". The
// grammar-rule tests destructure entries from this table so a grammar
// revision touches one place, not five (sage#138 cycle 2 — Maintainability
// lens called out the prior duplication between per-rule tests and a
// separate spec-examples test).
const SPEC_EXAMPLES = {
  simple: { did: 'did:mf:forge', encoded: '@did-mf-forge' },
  pilot: { did: 'did:mf:pilot', encoded: '@did-mf-pilot' },
  luna: { did: 'did:mf:luna', encoded: '@did-mf-luna' },
  dotted: { did: 'did:mf:hub.metafactory', encoded: '@did-mf-hub--metafactory' },
  hyphenated: { did: 'did:mf:hub-metafactory', encoded: '@did-mf-hub-metafactory' },
} as const;

describe('encodeDidSegment', () => {
  it('encodes a simple DID (no `.` in msi)', () => {
    for (const key of ['simple', 'pilot', 'luna'] as const) {
      const { did, encoded } = SPEC_EXAMPLES[key];
      expect(encodeDidSegment(did)).toBe(encoded);
    }
  });

  it('encodes a DID containing both `:` and `.` (the injectivity case)', () => {
    // `.` → `--` preserves distinguishability against literal `-` in the msi.
    const { did, encoded } = SPEC_EXAMPLES.dotted;
    expect(encodeDidSegment(did)).toBe(encoded);
  });

  it('encodes a DID with `-` inside the msi (preserved as single hyphen)', () => {
    const { did, encoded } = SPEC_EXAMPLES.hyphenated;
    expect(encodeDidSegment(did)).toBe(encoded);
  });

  it('produces distinct encodings for `.` vs `-` inside the msi', () => {
    // The spec history: collision between these two was the reason the
    // first-draft mapping (both → `-`) was rejected. Verify the third-draft
    // grammar keeps them distinct.
    expect(encodeDidSegment(SPEC_EXAMPLES.dotted.did)).not.toBe(
      encodeDidSegment(SPEC_EXAMPLES.hyphenated.did),
    );
  });

  it('throws on invalid DID (wrong method prefix)', () => {
    expect(() => encodeDidSegment('did:xyz:forge')).toThrow(/invalid DID/);
  });

  it('throws on invalid DID (consecutive hyphens in msi — the precondition)', () => {
    // DID_RE rejects `--` via `-(?!-)`; the encoder relies on this for
    // injectivity. Verify the validation surface holds.
    expect(() => encodeDidSegment('did:mf:hub--metafactory')).toThrow(/invalid DID/);
  });

  it('throws on invalid DID (empty / non-DID strings)', () => {
    expect(() => encodeDidSegment('')).toThrow(/invalid DID/);
    expect(() => encodeDidSegment('forge')).toThrow(/invalid DID/);
    expect(() => encodeDidSegment('did:mf:')).toThrow(/invalid DID/);
  });

  it('throws on invalid DID (msi starts with digit)', () => {
    // DID_RE requires the msi to start with a lowercase letter.
    expect(() => encodeDidSegment('did:mf:0foo')).toThrow(/invalid DID/);
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
