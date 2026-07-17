import type { Classification, MyelinEnvelope } from "../../types";
import type { EgressRule, SovereigntyValidationResult } from "../types";
import { subjectMatchesPattern } from "../../subject-matching";

const ALLOW: SovereigntyValidationResult = Object.freeze({ valid: true });

function subjectClassification(subject: string): Classification | null {
  const head = subject.split(".", 1)[0];
  if (head === "local" || head === "federated" || head === "public") return head;
  return null;
}

export function checkClassificationAlignment(
  envelope: MyelinEnvelope,
  targetSubject: string,
  rules: EgressRule[],
): SovereigntyValidationResult {
  const cls = envelope.sovereignty.classification;
  const subjectCls = subjectClassification(targetSubject);
  if (subjectCls === null) {
    return {
      valid: false,
      code: "compliance-block:classification-mismatch",
      reason: `subject '${targetSubject}' has no classification prefix`,
    };
  }
  // RFC-0005 §4.2/§5.2 (grill D4, closes OD-3): prefix↔classification is STRICT
  // EQUALITY, per ratified RFC-0002 §8.3 (binding vectors prefix/aligns-local,
  // prefix/mismatch-rejected). The prior downward-superset reachability budget
  // (public→local.* allowed) is the named conformance defect; the internal-copy
  // use case is served by re-publishing a distinct local-classified envelope,
  // not by carrying one envelope onto a lower-classified subject.
  if (subjectCls !== cls) {
    return {
      valid: false,
      code: "compliance-block:classification-mismatch",
      reason: `${cls}-classified envelope cannot publish to ${subjectCls}.* subject '${targetSubject}' (prefix must equal classification)`,
    };
  }
  const rule = rules.find((r) => r.classification === cls);
  if (!rule) {
    return {
      valid: false,
      code: "compliance-block:classification-mismatch",
      reason: `no egress rule for classification '${cls}'`,
    };
  }
  const subjectAllowed = rule.allowed_subjects.some((p) => subjectMatchesPattern(targetSubject, p));
  if (!subjectAllowed) {
    return {
      valid: false,
      code: "compliance-block:classification-mismatch",
      reason: `subject '${targetSubject}' not in allowed_subjects for ${cls}`,
    };
  }
  return ALLOW;
}

export function checkDataResidency(
  envelope: MyelinEnvelope,
  targetSubject: string,
  rule: EgressRule,
): SovereigntyValidationResult {
  if (!rule.data_residency_constraints) return ALLOW;
  const residency = envelope.sovereignty.data_residency;
  // Absent residency key is undefined at runtime (now enforced by
  // noUncheckedIndexedAccess) — keep the guard.
  const constraints = rule.data_residency_constraints[residency];
  if (!constraints) return ALLOW;
  const ok = constraints.some((p) => subjectMatchesPattern(targetSubject, p));
  if (!ok) {
    return {
      valid: false,
      code: "compliance-block:residency-violation",
      reason: `residency '${residency}' constrains subject patterns; '${targetSubject}' not allowed`,
    };
  }
  return ALLOW;
}

export function validateEgress(
  envelope: MyelinEnvelope,
  targetSubject: string,
  rules: EgressRule[],
): SovereigntyValidationResult {
  const alignment = checkClassificationAlignment(envelope, targetSubject, rules);
  if (!alignment.valid) return alignment;
  // Alignment validity above implies a rule matched the classification — TS
  // can't see the cross-call invariant.
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const rule = rules.find((r) => r.classification === envelope.sovereignty.classification)!;
  return checkDataResidency(envelope, targetSubject, rule);
}
