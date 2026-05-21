import { describe, it, expect } from 'bun:test';
import {
  deriveSubject,
  deriveLegacySubjectPattern,
  subjectPrefixAligns,
  isSubjectClassification,
  STACK_SEGMENT_REGEX,
  encodeDidSegment,
  offerTaskSubject,
  directTaskSubject,
  taskSubject,
  taskSubjectAndType,
  verdictSubject,
  prVerdictSubjectAndType,
  verdictWildcard,
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
// the worked examples in `specs/namespace.md` §"Assistant encoding". The
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

// myelin#134 — agent-task subject vocabulary.
// The five helpers below replace per-repo copies in cedar's and sage's
// `src/bus/subjects.ts`. Tests below exercise the documented shape, the
// directTaskSubject ↔ encodeDidSegment composition, and the cedar/sage
// parameterization of verdictSubject/verdictWildcard.

describe('offerTaskSubject', () => {
  it('produces the legacy 5-segment wildcard when stack is omitted', () => {
    expect(offerTaskSubject('metafactory', 'code-review')).toBe(
      'local.metafactory.tasks.code-review.>',
    );
    expect(offerTaskSubject('metafactory', 'code-write')).toBe(
      'local.metafactory.tasks.code-write.>',
    );
  });

  it('produces the stack-aware 6-segment wildcard when stack is supplied', () => {
    // myelin#152 — stack slot enables operators with multiple stacks
    // (`andreas/research`, `andreas/production`) to scope their broadcast
    // subscriptions per stack identity, matching sage's bridge format
    // (`local.{org}.{stack}.tasks.{capability}.>`).
    expect(offerTaskSubject('metafactory', 'code-review', 'default')).toBe(
      'local.metafactory.default.tasks.code-review.>',
    );
    expect(offerTaskSubject('metafactory', 'code-review', 'research')).toBe(
      'local.metafactory.research.tasks.code-review.>',
    );
  });

  it('throws when stack is not a valid namespace segment', () => {
    expect(() => offerTaskSubject('metafactory', 'code-review', '*')).toThrow(
      /Invalid stack segment/,
    );
    expect(() => offerTaskSubject('metafactory', 'code-review', '>')).toThrow(
      /Invalid stack segment/,
    );
    expect(() => offerTaskSubject('metafactory', 'code-review', '')).toThrow(
      /Invalid stack segment/,
    );
    expect(() => offerTaskSubject('metafactory', 'code-review', 'Bad-Stack')).toThrow(
      /Invalid stack segment/,
    );
  });
});

// NATS wildcard semantics for `taskSubject` ↔ `offerTaskSubject`:
// NATS `>` matches one or more trailing tokens, never zero. The cedar/sage
// convention is to pass a *compound* capability (e.g. `code-review.typescript`)
// into `taskSubject` so the resulting subject lands inside the broadcast
// wildcard's match set. A single-token capability produces a 4-segment
// subject that does NOT match the 5-segment wildcard — this is intentional
// per the spec (`specs/namespace.md` Direct/Offer section); it lets
// callers fan-out by capability prefix or address a terminal subject
// directly without collision.
describe('offerTaskSubject ↔ taskSubject pairing', () => {
  it('matches when capability is a compound path (cedar/sage broadcast-reachable shape)', () => {
    // Real-world sage example, preserved verbatim across the myelin upstream:
    // sage dispatch publishes `taskSubject(org, 'code-review.typescript')`,
    // and the daemon subscribes on `offerTaskSubject(org, 'code-review')`
    // = `local.{org}.tasks.code-review.>`. The `.typescript` token fills
    // the `>` slot.
    const pub = taskSubject('metafactory', 'code-review.typescript');
    const sub = offerTaskSubject('metafactory', 'code-review');
    const subPrefix = sub.slice(0, -1); // drop trailing `>`
    expect(pub.startsWith(subPrefix)).toBe(true);
    expect(pub.length).toBeGreaterThan(subPrefix.length); // ≥1 trailing token
  });

  it('does NOT match when capability is a single segment (4-segment direct/terminal shape)', () => {
    // Documenting the intentional non-pairing: `.>` requires ≥1 trailing
    // segment, so a 4-segment `taskSubject` is unreachable from the
    // 5-segment broadcast wildcard. The direct/terminal shape is used
    // when the receiver is already identified and broadcast fan-out is
    // explicitly NOT desired.
    const pub = taskSubject('metafactory', 'code-review');
    const sub = offerTaskSubject('metafactory', 'code-review');
    const subPrefix = sub.slice(0, -1); // drop trailing `>`
    // pub equals subPrefix minus its trailing dot — no token sits in `>`'s slot.
    expect(pub + '.').toBe(subPrefix);
  });
});

describe('directTaskSubject', () => {
  it('composes encodeDidSegment for the principal segment', () => {
    expect(directTaskSubject('metafactory', 'did:mf:cedar')).toBe(
      'local.metafactory.tasks.@did-mf-cedar.>',
    );
    expect(directTaskSubject('metafactory', 'did:mf:sage')).toBe(
      'local.metafactory.tasks.@did-mf-sage.>',
    );
  });

  it('preserves the `.` → `--` injectivity for DIDs with method-specific dots', () => {
    expect(directTaskSubject('metafactory', 'did:mf:hub.metafactory')).toBe(
      'local.metafactory.tasks.@did-mf-hub--metafactory.>',
    );
  });

  it('throws on invalid DID (propagated from encodeDidSegment)', () => {
    expect(() => directTaskSubject('metafactory', 'did:xyz:bogus')).toThrow(/invalid DID/);
    expect(() => directTaskSubject('metafactory', 'did:mf:hub--metafactory')).toThrow(/invalid DID/);
    expect(() => directTaskSubject('metafactory', '')).toThrow(/invalid DID/);
  });

  it('produces the stack-aware 6-segment form when stack is supplied (myelin#154)', () => {
    expect(directTaskSubject('metafactory', 'did:mf:cedar', 'default')).toBe(
      'local.metafactory.default.tasks.@did-mf-cedar.>',
    );
    expect(directTaskSubject('metafactory', 'did:mf:sage', 'research')).toBe(
      'local.metafactory.research.tasks.@did-mf-sage.>',
    );
  });

  it('throws when stack is not a valid namespace segment', () => {
    expect(() => directTaskSubject('metafactory', 'did:mf:sage', '*')).toThrow(/Invalid stack segment/);
    expect(() => directTaskSubject('metafactory', 'did:mf:sage', '>')).toThrow(/Invalid stack segment/);
    expect(() => directTaskSubject('metafactory', 'did:mf:sage', '')).toThrow(/Invalid stack segment/);
    expect(() => directTaskSubject('metafactory', 'did:mf:sage', 'Bad-Stack')).toThrow(/Invalid stack segment/);
  });
});

describe('taskSubject', () => {
  it('produces the direct/terminal 4-segment shape from a single-segment capability', () => {
    expect(taskSubject('metafactory', 'code-review')).toBe(
      'local.metafactory.tasks.code-review',
    );
    expect(taskSubject('metafactory', 'code-write')).toBe(
      'local.metafactory.tasks.code-write',
    );
  });

  it('produces the broadcast-reachable 5-segment shape from a compound capability', () => {
    // The cedar/sage convention: a content-type or sub-classifier appended
    // after `.` lands the subject inside `offerTaskSubject(org, root)`'s
    // wildcard. Preserved as-is from the per-repo helpers so existing call
    // sites (e.g. `sage dispatch` publishing on `code-review.typescript`)
    // migrate to the myelin export without refactoring.
    expect(taskSubject('metafactory', 'code-review.typescript')).toBe(
      'local.metafactory.tasks.code-review.typescript',
    );
    expect(taskSubject('metafactory', 'code-write.rust')).toBe(
      'local.metafactory.tasks.code-write.rust',
    );
  });

  it('produces stack-aware shapes when stack is supplied (myelin#152)', () => {
    // Direct/terminal stack-aware (5-segment subject; sits OUTSIDE the
    // 6-segment broadcast wildcard since `>` requires ≥1 trailing token).
    expect(taskSubject('metafactory', 'code-review', 'default')).toBe(
      'local.metafactory.default.tasks.code-review',
    );
    // Broadcast-reachable stack-aware (6-segment subject; pairs with
    // `offerTaskSubject('metafactory', 'code-review', 'default')`).
    expect(taskSubject('metafactory', 'code-review.typescript', 'default')).toBe(
      'local.metafactory.default.tasks.code-review.typescript',
    );
    expect(taskSubject('metafactory', 'code-review.typescript', 'research')).toBe(
      'local.metafactory.research.tasks.code-review.typescript',
    );
  });

  it('throws when stack is not a valid namespace segment', () => {
    expect(() => taskSubject('metafactory', 'code-review', '*')).toThrow(
      /Invalid stack segment/,
    );
    expect(() => taskSubject('metafactory', 'code-review', '>')).toThrow(
      /Invalid stack segment/,
    );
    expect(() => taskSubject('metafactory', 'code-review', '')).toThrow(
      /Invalid stack segment/,
    );
    expect(() => taskSubject('metafactory', 'code-review', 'Bad-Stack')).toThrow(
      /Invalid stack segment/,
    );
  });
});

describe('offerTaskSubject ↔ taskSubject stack-aware pairing (myelin#152)', () => {
  it('matches when both helpers use the same stack and a compound capability', () => {
    // Stack-aware publisher / subscriber pairing — the operator's stack
    // segment slots between {org} and `tasks` on both sides. Sage's
    // bridge subscribes via `offerTaskSubject(org, capability, stack)`
    // and pilot publishes via `taskSubject(org, `${cap}.${spec}`, stack)`.
    const pub = taskSubject('metafactory', 'code-review.typescript', 'default');
    const sub = offerTaskSubject('metafactory', 'code-review', 'default');
    const subPrefix = sub.slice(0, -1); // drop trailing `>`
    expect(pub.startsWith(subPrefix)).toBe(true);
    expect(pub.length).toBeGreaterThan(subPrefix.length); // ≥1 trailing token
  });

  it('does NOT match across different stacks (stack-scoping enforced)', () => {
    // Cross-stack isolation: a publish on `research` MUST NOT match a
    // subscription on `production` — that's the whole point of the
    // stack segment (operator-internal multi-tenancy).
    const pub = taskSubject('metafactory', 'code-review.typescript', 'research');
    const sub = offerTaskSubject('metafactory', 'code-review', 'production');
    const subPrefix = sub.slice(0, -1);
    expect(pub.startsWith(subPrefix)).toBe(false);
  });

  it('does NOT match when one side is stack-aware and the other is legacy', () => {
    // Migration safety: a stack-aware subscriber MUST NOT pick up legacy
    // publishes (and vice versa). Operators flip both sides in lockstep
    // or the broadcast loop silently breaks.
    const pubLegacy = taskSubject('metafactory', 'code-review.typescript');
    const subStack = offerTaskSubject('metafactory', 'code-review', 'default');
    expect(pubLegacy.startsWith(subStack.slice(0, -1))).toBe(false);

    const pubStack = taskSubject('metafactory', 'code-review.typescript', 'default');
    const subLegacy = offerTaskSubject('metafactory', 'code-review');
    expect(pubStack.startsWith(subLegacy.slice(0, -1))).toBe(false);
  });
});

describe('verdictSubject', () => {
  it('parameterizes for sage (kind=review)', () => {
    expect(verdictSubject('metafactory', 'review', 'approved')).toBe(
      'local.metafactory.code.pr.review.approved',
    );
    expect(verdictSubject('metafactory', 'review', 'changes-requested')).toBe(
      'local.metafactory.code.pr.review.changes-requested',
    );
    expect(verdictSubject('metafactory', 'review', 'commented')).toBe(
      'local.metafactory.code.pr.review.commented',
    );
  });

  it('parameterizes for cedar (kind=opened)', () => {
    expect(verdictSubject('metafactory', 'opened', 'success')).toBe(
      'local.metafactory.code.pr.opened.success',
    );
    expect(verdictSubject('metafactory', 'opened', 'failed')).toBe(
      'local.metafactory.code.pr.opened.failed',
    );
  });

  it('keeps cedar and sage on distinct wire roots (kind segment separates them)', () => {
    // The kind parameter is the whole point of moving this upstream — cedar
    // and sage can share one helper without colliding on subject root.
    const cedar = verdictSubject('metafactory', 'opened', 'success');
    const sage = verdictSubject('metafactory', 'review', 'approved');
    expect(cedar.startsWith('local.metafactory.code.pr.opened.')).toBe(true);
    expect(sage.startsWith('local.metafactory.code.pr.review.')).toBe(true);
  });

  it('produces stack-aware 6-segment subjects when stack is supplied (myelin#154)', () => {
    expect(verdictSubject('metafactory', 'review', 'approved', 'default')).toBe(
      'local.metafactory.default.code.pr.review.approved',
    );
    expect(verdictSubject('metafactory', 'review', 'changes-requested', 'research')).toBe(
      'local.metafactory.research.code.pr.review.changes-requested',
    );
  });

  it('throws when stack is not a valid namespace segment', () => {
    expect(() => verdictSubject('metafactory', 'review', 'approved', '*')).toThrow(/Invalid stack segment/);
    expect(() => verdictSubject('metafactory', 'review', 'approved', '>')).toThrow(/Invalid stack segment/);
    expect(() => verdictSubject('metafactory', 'review', 'approved', '')).toThrow(/Invalid stack segment/);
  });
});

describe('verdictWildcard', () => {
  it('parameterizes for sage (kind=review)', () => {
    expect(verdictWildcard('metafactory', 'review')).toBe(
      'local.metafactory.code.pr.review.>',
    );
  });

  it('parameterizes for cedar (kind=opened)', () => {
    expect(verdictWildcard('metafactory', 'opened')).toBe(
      'local.metafactory.code.pr.opened.>',
    );
  });

  it('pairs with the corresponding verdictSubject (verdictSubject ⊂ verdictWildcard kind-scoped)', () => {
    // A dispatcher subscribed to verdictWildcard receives every status for
    // that kind — the .> suffix replaces the status segment.
    const sub = verdictWildcard('metafactory', 'review');
    const pub = verdictSubject('metafactory', 'review', 'approved');
    expect(sub.endsWith('.>')).toBe(true);
    expect(pub.startsWith(sub.slice(0, -1))).toBe(true);
  });

  it('produces stack-aware 6-segment wildcards when stack is supplied (myelin#154)', () => {
    expect(verdictWildcard('metafactory', 'review', 'default')).toBe(
      'local.metafactory.default.code.pr.review.>',
    );
    expect(verdictWildcard('metafactory', 'opened', 'research')).toBe(
      'local.metafactory.research.code.pr.opened.>',
    );
  });

  it('stack-aware verdictWildcard pairs with stack-aware verdictSubject (matched stack only)', () => {
    // Cross-stack non-matching enforced — production verdict on `research`
    // must not be observable on `default` subscription, and vice versa.
    const subDefault = verdictWildcard('metafactory', 'review', 'default');
    const pubDefault = verdictSubject('metafactory', 'review', 'approved', 'default');
    const pubResearch = verdictSubject('metafactory', 'review', 'approved', 'research');
    const prefix = subDefault.slice(0, -1);
    expect(pubDefault.startsWith(prefix)).toBe(true);
    expect(pubResearch.startsWith(prefix)).toBe(false);
  });

  it('throws when stack is not a valid namespace segment', () => {
    expect(() => verdictWildcard('metafactory', 'review', '*')).toThrow(/Invalid stack segment/);
    expect(() => verdictWildcard('metafactory', 'review', '>')).toThrow(/Invalid stack segment/);
    expect(() => verdictWildcard('metafactory', 'review', '')).toThrow(/Invalid stack segment/);
  });
});

// Wildcard-injection guards (sage#139 cycle-2 Security lens).
// Each helper that interpolates a caller-supplied segment into a SUBSCRIBE-
// side subject validates that segment so a `*` / `>` / `.` token can't
// silently widen the subscription beyond the documented scope.
describe('agent-task helpers reject wildcard tokens (security boundary)', () => {
  const wildcardCases = ['*', '>', 'has.dot', 'tasks.>', 'Capability', ''];

  it('offerTaskSubject rejects wildcard org/capability', () => {
    for (const bad of wildcardCases) {
      expect(() => offerTaskSubject(bad, 'code-review')).toThrow(/Invalid org/);
      expect(() => offerTaskSubject('metafactory', bad)).toThrow(/Invalid capability/);
    }
  });

  it('directTaskSubject rejects wildcard org', () => {
    for (const bad of wildcardCases) {
      expect(() => directTaskSubject(bad, 'did:mf:cedar')).toThrow(/Invalid org/);
    }
  });

  it('taskSubject rejects wildcard org / capability path', () => {
    for (const bad of wildcardCases) {
      expect(() => taskSubject(bad, 'code-review')).toThrow(/Invalid org/);
    }
    // `taskSubject` accepts compound capabilities, so the per-token
    // validator passes `'has.dot'` (both tokens are legit segments).
    // Test capability-side rejection with strictly-illegal values only —
    // wildcards, empty, leading-digit, uppercase. Pathological compound
    // cases get their own coverage below.
    const capabilityWildcards = ['*', '>', 'Capability', ''];
    for (const bad of capabilityWildcards) {
      expect(() => taskSubject('metafactory', bad)).toThrow(/Invalid capability/);
    }
  });

  it('taskSubject rejects pathological compound capabilities (each token validated)', () => {
    // The per-token validator must reject any compound where ANY token is
    // wildcard / empty / malformed — leading/trailing dot, consecutive
    // dots, wildcard in any position. Cedar/sage's `code-review.typescript`
    // remains the canonical legitimate compound.
    const badCompounds = [
      'code-review.', // trailing dot → empty trailing token
      '.code-review', // leading dot → empty leading token
      'code-review..typescript', // consecutive dots → empty middle token
      'code-review.*', // wildcard tail
      '*.typescript', // wildcard head
      'code-review.TypeScript', // uppercase token
      'code-review.0bad', // token starts with digit
    ];
    for (const bad of badCompounds) {
      expect(() => taskSubject('metafactory', bad)).toThrow(/Invalid capability/);
    }
  });

  it('verdictSubject rejects wildcard org / kind / status', () => {
    for (const bad of wildcardCases) {
      expect(() => verdictSubject(bad, 'review', 'approved')).toThrow(/Invalid org/);
      expect(() => verdictSubject('metafactory', bad, 'approved')).toThrow(/Invalid kind/);
      expect(() => verdictSubject('metafactory', 'review', bad)).toThrow(/Invalid status/);
    }
  });

  it('verdictWildcard rejects wildcard org / kind', () => {
    for (const bad of wildcardCases) {
      expect(() => verdictWildcard(bad, 'review')).toThrow(/Invalid org/);
      expect(() => verdictWildcard('metafactory', bad)).toThrow(/Invalid kind/);
    }
  });

  it('the canonical sage/cedar vocabulary still passes validation', () => {
    // Locking in: the canonical kinds and statuses from cedar+sage's
    // existing per-repo helpers all satisfy STACK_SEGMENT_REGEX, so the
    // validation tightening above is purely additive against today's
    // wire usage.
    expect(() => verdictSubject('metafactory', 'review', 'approved')).not.toThrow();
    expect(() => verdictSubject('metafactory', 'review', 'changes-requested')).not.toThrow();
    expect(() => verdictSubject('metafactory', 'review', 'commented')).not.toThrow();
    expect(() => verdictSubject('metafactory', 'opened', 'success')).not.toThrow();
    expect(() => verdictSubject('metafactory', 'opened', 'failed')).not.toThrow();
    expect(() => verdictWildcard('metafactory', 'review')).not.toThrow();
    expect(() => verdictWildcard('metafactory', 'opened')).not.toThrow();
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
    // Agent-task vocabulary (myelin#134) joins the subpath surface.
    expect(typeof mod.encodeDidSegment).toBe('function');
    expect(typeof mod.offerTaskSubject).toBe('function');
    expect(typeof mod.directTaskSubject).toBe('function');
    expect(typeof mod.taskSubject).toBe('function');
    expect(typeof mod.taskSubjectAndType).toBe('function');
    expect(typeof mod.verdictSubject).toBe('function');
    expect(typeof mod.prVerdictSubjectAndType).toBe('function');
    expect(typeof mod.verdictWildcard).toBe('function');
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

// myelin#143 — subject+type pairing helpers. Consumers (cedar, sage, pilot,
// grove) previously carried a second source of truth for the envelope
// `type` field next to the subject; these helpers fold both into one call.
describe('taskSubjectAndType', () => {
  it('round-trips (subject, type) for a direct/terminal capability', () => {
    const pair = taskSubjectAndType('metafactory', 'code-review');
    expect(pair.subject).toBe(taskSubject('metafactory', 'code-review'));
    expect(pair.subject).toBe('local.metafactory.tasks.code-review');
    expect(pair.type).toBe('tasks.code-review');
  });

  it('round-trips (subject, type) for a compound capability', () => {
    const pair = taskSubjectAndType('metafactory', 'code-review.typescript');
    expect(pair.subject).toBe(taskSubject('metafactory', 'code-review.typescript'));
    expect(pair.subject).toBe('local.metafactory.tasks.code-review.typescript');
    expect(pair.type).toBe('tasks.code-review.typescript');
  });

  it('delegates validation to taskSubject (rejects wildcard org)', () => {
    expect(() => taskSubjectAndType('*', 'code-review')).toThrow(/Invalid org/);
    expect(() => taskSubjectAndType('metafactory', '>')).toThrow(/Invalid capability/);
  });
});

describe('prVerdictSubjectAndType', () => {
  it('round-trips (subject, type) for sage (family=review)', () => {
    const pair = prVerdictSubjectAndType('metafactory', 'review', 'approved');
    expect(pair.subject).toBe(verdictSubject('metafactory', 'review', 'approved'));
    expect(pair.subject).toBe('local.metafactory.code.pr.review.approved');
    expect(pair.type).toBe('code.pr.review.approved');
  });

  it('round-trips (subject, type) for cedar (family=opened)', () => {
    const pair = prVerdictSubjectAndType('metafactory', 'opened', 'success');
    expect(pair.subject).toBe(verdictSubject('metafactory', 'opened', 'success'));
    expect(pair.subject).toBe('local.metafactory.code.pr.opened.success');
    expect(pair.type).toBe('code.pr.opened.success');
  });

  it('handles sage statuses including changes-requested', () => {
    const pair = prVerdictSubjectAndType('metafactory', 'review', 'changes-requested');
    expect(pair.subject).toBe('local.metafactory.code.pr.review.changes-requested');
    expect(pair.type).toBe('code.pr.review.changes-requested');
  });

  it('delegates validation to verdictSubject (rejects wildcards)', () => {
    expect(() => prVerdictSubjectAndType('*', 'review', 'approved')).toThrow(/Invalid org/);
    expect(() => prVerdictSubjectAndType('metafactory', '*', 'approved')).toThrow(/Invalid kind/);
    expect(() => prVerdictSubjectAndType('metafactory', 'review', '>')).toThrow(/Invalid status/);
  });
});

// myelin#154 — backward-compat normalisation gate. The pure-string helper
// `deriveLegacySubjectPattern` derives the 5-segment counterpart of a
// stack-aware subscription pattern when the spec's MV-3 rule applies.
// `EnvelopeTransport.subscribe` consumes the helper to fire a dual
// subscription against legacy traffic during the migration window.
describe('deriveLegacySubjectPattern', () => {
  describe('happy path — default stack', () => {
    it('strips literal `default` stack from a wildcard pattern', () => {
      expect(deriveLegacySubjectPattern('local.metafactory.default.code.pr.>'))
        .toBe('local.metafactory.code.pr.>');
    });

    it('strips literal `default` stack from a fully-qualified subject', () => {
      expect(deriveLegacySubjectPattern('local.metafactory.default.code.pr.review.approved'))
        .toBe('local.metafactory.code.pr.review.approved');
    });

    it('strips literal `default` stack from a federated pattern', () => {
      expect(deriveLegacySubjectPattern('federated.acme.default.tasks.code-review.>'))
        .toBe('federated.acme.tasks.code-review.>');
    });

    it('strips literal `default` from a 4-seg pattern (single trailing segment)', () => {
      // Minimum-length 6-seg pattern is [prefix, org, stack, domain] = 4 segs.
      // Derived legacy: [prefix, org, domain] = 3 segs.
      expect(deriveLegacySubjectPattern('local.metafactory.default.tasks'))
        .toBe('local.metafactory.tasks');
    });
  });

  describe('happy path — `*` wildcard at stack slot', () => {
    it('treats `*` at stack slot as default-derivable', () => {
      // A subscriber listening across all stacks (`*` at position 2) wants
      // legacy traffic too — legacy maps to `default`, which `*` includes.
      expect(deriveLegacySubjectPattern('local.metafactory.*.code.pr.>'))
        .toBe('local.metafactory.code.pr.>');
    });

    it('treats `*` at stack slot for federated patterns', () => {
      expect(deriveLegacySubjectPattern('federated.acme.*.tasks.>'))
        .toBe('federated.acme.tasks.>');
    });
  });

  describe('null cases — no dual subscription warranted', () => {
    it('returns null for a non-`default` literal stack', () => {
      // Legacy publishers never addressed `research` — no traffic to bridge.
      expect(deriveLegacySubjectPattern('local.metafactory.research.code.pr.>'))
        .toBeNull();
      expect(deriveLegacySubjectPattern('local.metafactory.security.tasks.>'))
        .toBeNull();
    });

    it('returns null for the org-wide multi-segment wildcard', () => {
      // `local.{org}.>` already matches every shape under the org via NATS
      // `>` semantics; the derived dual would be identical and pointless.
      expect(deriveLegacySubjectPattern('local.metafactory.>')).toBeNull();
      expect(deriveLegacySubjectPattern('federated.acme.>')).toBeNull();
    });

    it('returns null for an already-legacy 5-segment pattern', () => {
      // No stack slot to strip — the pattern is already 5-seg.
      expect(deriveLegacySubjectPattern('local.metafactory.code.pr.>'))
        .toBeNull();
      expect(deriveLegacySubjectPattern('local.metafactory.tasks.code-review'))
        .toBeNull();
    });

    it('returns null for too-short subjects', () => {
      expect(deriveLegacySubjectPattern('local')).toBeNull();
      expect(deriveLegacySubjectPattern('local.metafactory')).toBeNull();
    });

    it('returns null for non-`local`/`federated` prefixes', () => {
      // `public.*` subjects never carry a stack.
      expect(deriveLegacySubjectPattern('public.broadcast.>')).toBeNull();
      expect(deriveLegacySubjectPattern('public.default.code.pr.>')).toBeNull();
    });
  });

  describe('NATS subject-matching invariants — dual-subscribe correctness', () => {
    it('derived pattern does not match the 6-segment subject form', () => {
      // The spec's correctness argument: 5-seg derived pattern catches
      // legacy publishes only; 6-seg traffic is unmatched by the derived
      // pattern (positional segment 3 differs). Demonstrate by construction.
      const stackAware = 'local.metafactory.default.code.pr.created';
      const derived = deriveLegacySubjectPattern('local.metafactory.default.code.pr.>');
      expect(derived).toBe('local.metafactory.code.pr.>');
      // Derived pattern segments: [local, metafactory, code, pr, >]
      // Stack-aware subject segments: [local, metafactory, default, code, pr, created]
      // Position 3 of the pattern is `pr` (literal); position 3 of the subject is
      // `code`. NATS requires positional literal segment equality up to the `>`
      // wildcard — no match.
      const patternSegs = derived!.split('.');
      const subjectSegs = stackAware.split('.');
      expect(patternSegs[2]).toBe('code');
      expect(subjectSegs[2]).toBe('default');
      expect(patternSegs[2]).not.toBe(subjectSegs[2]);
    });
  });
});
