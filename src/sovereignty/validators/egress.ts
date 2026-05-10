import type { Classification, MyelinEnvelope } from "../../types";
import type { EgressRule, SovereigntyValidationResult } from "../types";
import { subjectMatchesPattern } from "../../subject-matching";

const CLASSIFICATION_PREFIX_BUDGET: Record<Classification, Classification[]> = {
  local: ["local"],
  federated: ["local", "federated"],
  public: ["local", "federated", "public"],
};

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
  const allowed = CLASSIFICATION_PREFIX_BUDGET[cls];
  if (!allowed.includes(subjectCls)) {
    return {
      valid: false,
      code: "compliance-block:classification-mismatch",
      reason: `${cls}-classified envelope cannot publish to ${subjectCls}.* subject '${targetSubject}'`,
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
  return { valid: true };
}

export function checkDataResidency(
  envelope: MyelinEnvelope,
  targetSubject: string,
  rule: EgressRule,
): SovereigntyValidationResult {
  if (!rule.data_residency_constraints) return { valid: true };
  const residency = envelope.sovereignty.data_residency;
  const constraints = rule.data_residency_constraints[residency];
  if (!constraints) return { valid: true };
  const ok = constraints.some((p) => subjectMatchesPattern(targetSubject, p));
  if (!ok) {
    return {
      valid: false,
      code: "compliance-block:residency-violation",
      reason: `residency '${residency}' constrains subject patterns; '${targetSubject}' not allowed`,
    };
  }
  return { valid: true };
}

export function validateEgress(
  envelope: MyelinEnvelope,
  targetSubject: string,
  rules: EgressRule[],
): SovereigntyValidationResult {
  const alignment = checkClassificationAlignment(envelope, targetSubject, rules);
  if (!alignment.valid) return alignment;
  const rule = rules.find((r) => r.classification === envelope.sovereignty.classification)!;
  return checkDataResidency(envelope, targetSubject, rule);
}
