import { generateCorrelationId } from "../correlation";
import { executionRunFinishedSubject } from "../subjects";
import {
  EXECUTION_RUN_FINISHED_TYPE,
  RUN_KINDS,
  RUN_OUTCOMES,
  type ExecutionRunEventType,
} from "../subject-vocabulary";
import type { EnvelopePublishInput } from "../transport/types";
import type { MyelinEnvelope, Sovereignty, ValidationError, ValidationResult } from "../types";
import { isValidUUID } from "../uuid";
import { closedObject, enumValue, isRecord, nonEmptyString, throwIfInvalid, timestamp } from "./payload-checks";
import type { ExecutionRunFinishedPayload, ExecutionRunFinishedPayloadInput } from "./types";

export interface CreateExecutionRunFinishedOptions {
  source: string;
  principal: string;
  stack: string;
  sovereignty: Partial<Sovereignty>;
  payload: ExecutionRunFinishedPayloadInput;
}

export interface ExecutionRunFinishedPublishInput extends EnvelopePublishInput {
  type: ExecutionRunEventType;
  payload: ExecutionRunFinishedPayload & Record<string, unknown>;
  economics: { actual: { duration_ms: number } };
}

export interface ExecutionRunFinishedEvent {
  subject: string;
  input: ExecutionRunFinishedPublishInput;
}

const PAYLOAD_KEYS = [
  "run_id", "producer", "ran", "outcome", "started_at", "ended_at",
  "serves", "state", "correlation_id", "detail_ref", "result_ref", "proposal_refs",
] as const;

function succeededOnly(outcome: unknown, field: string, errors: ValidationError[]): void {
  if (outcome !== "succeeded") errors.push({ field, message: "is only allowed when outcome is succeeded" });
}

/** The soma:relative/path rule every principal-facing ref follows; the reader enforces containment. */
function somaRef(value: unknown, field: string, errors: ValidationError[]): void {
  if (!nonEmptyString(value, field, errors)) return;
  const path = value.slice("soma:".length);
  if (!value.startsWith("soma:") || path.length === 0 || path.startsWith("/")
    || path.split("/").includes("..") || path.includes("\\") || path.includes("\0")) {
    errors.push({
      field,
      message: "must be a soma: ref with a non-empty relative path and no .. segment, backslash or NUL",
    });
  }
}

/** Shared by both public interfaces, including the closed nested objects. */
function payloadErrors(value: unknown, correlationRequired: boolean): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!closedObject(value, "payload", PAYLOAD_KEYS, errors)) return errors;
  for (const field of ["run_id", "producer"]) nonEmptyString(value[field], `payload.${field}`, errors);
  if (closedObject(value.ran, "payload.ran", ["kind", "ref"], errors)) {
    enumValue(value.ran.kind, "payload.ran.kind", RUN_KINDS, errors);
    nonEmptyString(value.ran.ref, "payload.ran.ref", errors);
  }
  enumValue(value.outcome, "payload.outcome", RUN_OUTCOMES, errors);
  const start = timestamp(value.started_at, "payload.started_at", errors);
  const end = timestamp(value.ended_at, "payload.ended_at", errors);
  if (start !== undefined && end !== undefined && end < start) {
    errors.push({ field: "payload.ended_at", message: "must not be before started_at" });
  }
  if (Object.hasOwn(value, "serves") && closedObject(value.serves, "payload.serves", ["goal", "node"], errors)) {
    for (const field of ["goal", "node"]) {
      if (Object.hasOwn(value.serves, field)) nonEmptyString(value.serves[field], `payload.serves.${field}`, errors);
    }
  }
  if (Object.hasOwn(value, "state") && closedObject(value.state, "payload.state", ["subject", "value"], errors)) {
    for (const field of ["subject", "value"]) nonEmptyString(value.state[field], `payload.state.${field}`, errors);
  }
  if (correlationRequired || Object.hasOwn(value, "correlation_id")) {
    nonEmptyString(value.correlation_id, "payload.correlation_id", errors);
  }
  if (Object.hasOwn(value, "detail_ref")) nonEmptyString(value.detail_ref, "payload.detail_ref", errors);
  if (Object.hasOwn(value, "result_ref")) {
    succeededOnly(value.outcome, "payload.result_ref", errors);
    somaRef(value.result_ref, "payload.result_ref", errors);
  }
  if (Object.hasOwn(value, "proposal_refs")) {
    succeededOnly(value.outcome, "payload.proposal_refs", errors);
    const refs: unknown = value.proposal_refs;
    if (!Array.isArray(refs) || refs.length === 0) {
      errors.push({ field: "payload.proposal_refs", message: "must be a non-empty array" });
    } else {
      // An indexed loop, not forEach: a sparse hole serializes to null, so it must fail here too.
      const seen = new Set<unknown>();
      for (let index = 0; index < refs.length; index++) {
        const field = `payload.proposal_refs[${index}]`;
        const ref: unknown = refs[index];
        somaRef(ref, field, errors);
        if (seen.has(ref)) errors.push({ field, message: "duplicates an earlier entry" });
        seen.add(ref);
      }
    }
  }
  return errors;
}

/** Validate producer data and construct the stack-aware publish subject/input. */
export function createExecutionRunFinished(options: CreateExecutionRunFinishedOptions): ExecutionRunFinishedEvent {
  throwIfInvalid(EXECUTION_RUN_FINISHED_TYPE, payloadErrors(options.payload, false));
  const correlation_id = options.payload.correlation_id ?? generateCorrelationId();
  return {
    subject: executionRunFinishedSubject(options.principal, options.stack),
    input: {
      source: options.source,
      type: EXECUTION_RUN_FINISHED_TYPE,
      sovereignty: options.sovereignty,
      payload: { ...options.payload, correlation_id },
      // Envelope correlation is UUID-only; Vigil reads payload.correlation_id.
      ...(isValidUUID(correlation_id) ? { correlation_id } : {}),
      economics: {
        actual: { duration_ms: Date.parse(options.payload.ended_at) - Date.parse(options.payload.started_at) },
      },
    },
  };
}

/** Check a received run-ledger envelope without throwing on malformed data. */
export function validateExecutionRunFinished(envelope: MyelinEnvelope): ValidationResult {
  if (!isRecord(envelope)) return { valid: false, errors: [{ field: "envelope", message: "must be an object" }] };
  const errors = payloadErrors(envelope.payload, true);
  if (envelope.type !== EXECUTION_RUN_FINISHED_TYPE) {
    errors.push({ field: "type", message: `must be ${EXECUTION_RUN_FINISHED_TYPE}` });
  }
  if (envelope.correlation_id !== undefined && !isValidUUID(envelope.correlation_id)) {
    errors.push({ field: "correlation_id", message: "must be a valid UUID when present" });
  }
  if (envelope.correlation_id !== undefined &&
    (!isRecord(envelope.payload) || envelope.correlation_id !== envelope.payload.correlation_id)) {
    errors.push({ field: "correlation_id", message: "must match payload.correlation_id when present" });
  }
  const duration = envelope.economics?.actual?.duration_ms;
  if (typeof duration !== "number" || !Number.isInteger(duration) || duration < 0) {
    errors.push({ field: "economics.actual.duration_ms", message: "must be a non-negative integer" });
  }
  return { valid: errors.length === 0, errors };
}
