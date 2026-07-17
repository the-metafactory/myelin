import { detectSubjectForm } from "../../subjects";
import { subjectMatchesPattern } from "../../subject-matching";
import type { Classification } from "../../wire/generated/r/subject-namespace";
import {
  deriveSubject as wireDeriveSubject,
  subjectFor as wireSubjectFor,
  subjectPrefixAligns as wireSubjectPrefixAligns,
  transportMetricsSubject as wireTransportMetricsSubject,
  taskDeadLetterSubject as wireTaskDeadLetterSubject,
  validateCapabilityTag as wireValidateCapabilityTag,
  validatePublishedSubject,
  validateSubPattern,
  validateAtSegment,
  validateAppPublish,
  validateTaskRecipient,
  classifySubject,
  resolveStackForIdentity,
} from "../../wire/subjects";
import { type Adapter, type VectorResult } from "../types";

/**
 * Subject-namespace adapters (RFC-0002). Wired to the ./wire subject codec
 * (myelin#238): the full published-subject / subscription-pattern validators,
 * the @-address codec, the reserved-space classifier, and the corrected
 * derivation primitives (stackless-reject, uppercase-reject,
 * prefix-classification-mismatch token, stack-named-`tasks` de-misparse).
 *
 * `detectSubjectForm` and `matchSubscription` stay on the main-tree primitives —
 * their vectors pass today and are not part of the #238 surface.
 */

function asRecord(x: unknown): Record<string, unknown> {
  return (x ?? {}) as Record<string, unknown>;
}

function fromWire(r: { ok: true; value: unknown } | { ok: false; reason: string }): VectorResult {
  return r.ok ? { ok: true, value: r.value } : { ok: false, reason: r.reason };
}

export const subjectsAdapters: Record<string, Adapter> = {
  deriveSubject: (input): VectorResult => {
    const i = asRecord(input);
    const r = wireDeriveSubject({
      classification: i.classification as Classification,
      principal: i.principal as string | undefined,
      type: i.type as string,
      stack: i.stack as string | undefined,
      legacy: i.legacy as boolean | undefined,
    });
    return fromWire(r);
  },

  subjectFor: (input): VectorResult => {
    const i = asRecord(input);
    const r = wireSubjectFor({
      classification: i.classification as Classification,
      principal: i.principal as string | undefined,
      type: i.type as string,
      stack: i.stack as string | undefined,
      legacy: i.legacy as boolean | undefined,
    });
    return fromWire(r);
  },

  subjectPrefixAligns: (input): VectorResult => {
    const i = asRecord(input);
    const r = wireSubjectPrefixAligns(i.subject as string, i.classification as Classification);
    // Accept vectors assert value {aligned:true}; reject asserts the token.
    return fromWire(r);
  },

  detectSubjectForm: (input): VectorResult => {
    const i = asRecord(input);
    const r = detectSubjectForm(
      i.subject as string,
      i.envelopeType as string | undefined,
      i.stack as string | undefined,
    );
    return { ok: true, value: r };
  },

  taskDeadLetterSubject: (input): VectorResult => {
    return fromWire(wireTaskDeadLetterSubject(input as string));
  },

  transportMetricsSubject: (input): VectorResult => {
    const i = asRecord(input);
    return fromWire(wireTransportMetricsSubject(i.principal as string, i.source as string));
  },

  matchSubscription: (input): VectorResult => {
    const i = asRecord(input);
    const matches = subjectMatchesPattern(i.subject as string, i.pattern as string);
    return { ok: true, value: { matches } };
  },

  validateCapabilityTag: (input): VectorResult => {
    return fromWire(wireValidateCapabilityTag(input as string));
  },

  validatePublishedSubject: (input): VectorResult => {
    return fromWire(validatePublishedSubject(input as string));
  },

  validateSubPattern: (input): VectorResult => {
    return fromWire(validateSubPattern(input as string));
  },

  validateAtSegment: (input): VectorResult => {
    return fromWire(validateAtSegment(input as string));
  },

  validateAppPublish: (input): VectorResult => {
    return fromWire(validateAppPublish(input as string));
  },

  validateTaskRecipient: (input): VectorResult => {
    const i = asRecord(input);
    return fromWire(
      validateTaskRecipient({
        subject: i.subject as string,
        target_assistant: i.target_assistant as string,
      }),
    );
  },

  classifySubject: (input): VectorResult => {
    return fromWire(classifySubject(input as string));
  },

  resolveStackForIdentity: (input): VectorResult => {
    const i = asRecord(input);
    return fromWire(
      resolveStackForIdentity({
        subject: i.subject as string,
        signedStack: i.signedStack as string | undefined,
      }),
    );
  },
};
