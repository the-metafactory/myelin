import type { ValidationError, ValidationResult } from "../types";
import { CAPABILITY_TAG_RE } from "../patterns";
import type { WorkflowDefinition, WorkflowStep } from "./types";

const STEP_ID_RE = /^[a-z][a-z0-9-]{0,62}[a-z0-9]$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const VALID_FAILURE_STRATEGIES = new Set(["abort", "skip-step", "continue"]);
const VALID_STEP_KINDS = new Set(["sequential", "fan-out", "fan-in"]);

/**
 * F-16: definition-load-time validation. Catches the cheap mistakes
 * before any runtime — duplicate step ids, unknown next-pointers,
 * incompatible adjacent schemas, bad grammar on capability/step ids.
 *
 * Strict semantic schema compatibility (full JSON Schema evaluation)
 * is out of scope here. We compare `compatibility_key` strings —
 * coarse but catches the common accidental-mismatch case.
 */
export function validateWorkflow(definition: WorkflowDefinition): ValidationResult {
  const errors: ValidationError[] = [];

  if (typeof definition.id !== "string" || definition.id.length === 0) {
    errors.push({ field: "id", message: "must be a non-empty string" });
  }
  if (typeof definition.name !== "string" || definition.name.length === 0) {
    errors.push({ field: "name", message: "must be a non-empty string" });
  }
  if (typeof definition.version !== "string" || !SEMVER_RE.test(definition.version)) {
    errors.push({ field: "version", message: "must be a semver string (e.g., 1.0.0)" });
  }
  if (definition.timeout_ms !== undefined) {
    if (!Number.isInteger(definition.timeout_ms) || definition.timeout_ms < 1) {
      errors.push({ field: "timeout_ms", message: "must be a positive integer (milliseconds)" });
    }
  }
  if (definition.on_failure !== undefined && !VALID_FAILURE_STRATEGIES.has(definition.on_failure)) {
    errors.push({ field: "on_failure", message: "must be 'abort' | 'skip-step' | 'continue'" });
  }
  if (!Array.isArray(definition.steps) || definition.steps.length === 0) {
    errors.push({ field: "steps", message: "must be a non-empty array" });
    return { valid: errors.length === 0, errors };
  }

  const seenIds = new Set<string>();
  definition.steps.forEach((step, idx) => {
    validateStep(step, idx, errors, seenIds);
  });

  // Resolve next-pointers + check schema compatibility on adjacent steps.
  const stepById = new Map(definition.steps.map((s) => [s.id, s]));
  for (let idx = 0; idx < definition.steps.length; idx++) {
    const step = definition.steps[idx];
    if (!step.next) continue;
    for (let n = 0; n < step.next.length; n++) {
      const nextId = step.next[n];
      const nextStep = stepById.get(nextId);
      if (!nextStep) {
        errors.push({ field: `steps[${idx}].next[${n}]`, message: `unknown step id '${nextId}'` });
        continue;
      }
      if (nextStep.id === step.id) {
        errors.push({ field: `steps[${idx}].next[${n}]`, message: `step '${step.id}' cannot point at itself` });
        continue;
      }
      if (step.output.compatibility_key !== nextStep.input.compatibility_key) {
        errors.push({
          field: `steps[${idx}].output.compatibility_key`,
          message: `output '${step.output.compatibility_key}' incompatible with input of step '${nextStep.id}' ('${nextStep.input.compatibility_key}')`,
        });
      }
    }
  }

  // Sequential-pairing fallback applies ONLY to workflows where no
  // step uses explicit `next`. Once any step declares an explicit
  // topology, the array order is metadata-only and pairing checks
  // would be wrong (e.g., fan-out branches share a parent but don't
  // chain to each other).
  const hasExplicitTopology = definition.steps.some((s) => s.next && s.next.length > 0);
  if (!hasExplicitTopology) {
    for (let idx = 0; idx < definition.steps.length - 1; idx++) {
      const step = definition.steps[idx];
      const next = definition.steps[idx + 1];
      if (step.output.compatibility_key !== next.input.compatibility_key) {
        errors.push({
          field: `steps[${idx}].output.compatibility_key`,
          message: `sequential output '${step.output.compatibility_key}' incompatible with input of step '${next.id}' ('${next.input.compatibility_key}')`,
        });
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

function validateStep(
  step: unknown,
  idx: number,
  errors: ValidationError[],
  seenIds: Set<string>,
): void {
  const path = `steps[${idx}]`;
  if (!step || typeof step !== "object" || Array.isArray(step)) {
    errors.push({ field: path, message: "must be an object" });
    return;
  }
  const s = step as WorkflowStep;
  if (typeof s.id !== "string" || !STEP_ID_RE.test(s.id)) {
    errors.push({ field: `${path}.id`, message: "must match /^[a-z][a-z0-9-]{0,62}[a-z0-9]$/" });
  } else if (seenIds.has(s.id)) {
    errors.push({ field: `${path}.id`, message: `duplicate step id '${s.id}'` });
  } else {
    seenIds.add(s.id);
  }
  if (typeof s.capability !== "string" || !CAPABILITY_TAG_RE.test(s.capability)) {
    errors.push({ field: `${path}.capability`, message: "must match capability-tag grammar" });
  }
  if (s.kind !== undefined && !VALID_STEP_KINDS.has(s.kind)) {
    errors.push({ field: `${path}.kind`, message: "must be 'sequential' | 'fan-out' | 'fan-in'" });
  }
  if (!s.input || typeof s.input !== "object" || typeof s.input.compatibility_key !== "string" || s.input.compatibility_key.length === 0) {
    errors.push({ field: `${path}.input.compatibility_key`, message: "must be a non-empty string" });
  }
  if (!s.output || typeof s.output !== "object" || typeof s.output.compatibility_key !== "string" || s.output.compatibility_key.length === 0) {
    errors.push({ field: `${path}.output.compatibility_key`, message: "must be a non-empty string" });
  }
  if (s.timeout_ms !== undefined) {
    if (!Number.isInteger(s.timeout_ms) || s.timeout_ms < 1) {
      errors.push({ field: `${path}.timeout_ms`, message: "must be a positive integer (milliseconds)" });
    }
  }
  if (s.on_failure !== undefined && !VALID_FAILURE_STRATEGIES.has(s.on_failure)) {
    errors.push({ field: `${path}.on_failure`, message: "must be 'abort' | 'skip-step' | 'continue'" });
  }
  if (s.next !== undefined) {
    if (!Array.isArray(s.next)) {
      errors.push({ field: `${path}.next`, message: "must be an array of step ids" });
    } else {
      const localSeen = new Set<string>();
      s.next.forEach((nid, ni) => {
        if (typeof nid !== "string" || !STEP_ID_RE.test(nid)) {
          errors.push({ field: `${path}.next[${ni}]`, message: "must be a valid step id" });
        } else if (localSeen.has(nid)) {
          errors.push({ field: `${path}.next[${ni}]`, message: `duplicate next id '${nid}'` });
        } else {
          localSeen.add(nid);
        }
      });
    }
  }
}

export function assertWorkflow(definition: unknown): asserts definition is WorkflowDefinition {
  const result = validateWorkflow(definition as WorkflowDefinition);
  if (!result.valid) {
    const detail = result.errors.map((e) => `${e.field}: ${e.message}`).join(", ");
    throw new Error(`invalid workflow definition: ${detail}`);
  }
}
