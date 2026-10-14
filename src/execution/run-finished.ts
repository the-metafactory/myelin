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
const TIMESTAMP_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function closedObject(
  value: unknown,
  field: string,
  keys: readonly string[],
  errors: ValidationError[],
): value is Record<string, unknown> {
  if (!isRecord(value)) {
    errors.push({ field, message: "must be an object" });
    return false;
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) errors.push({ field: `${field}.${key}`, message: "unknown field" });
  }
  return true;
}

function nonEmptyString(value: unknown, field: string, errors: ValidationError[]): value is string {
  if (typeof value !== "string" || value.length === 0) {
    errors.push({ field, message: "must be a non-empty string" });
    return false;
  }
  return true;
}

function enumValue(value: unknown, field: string, values: readonly string[], errors: ValidationError[]): void {
  if (nonEmptyString(value, field, errors) && !values.includes(value)) {
    errors.push({ field, message: `must be one of: ${values.join(", ")}` });
  }
}

function timestamp(value: unknown, field: string, errors: ValidationError[]): number | undefined {
  if (!nonEmptyString(value, field, errors)) return undefined;
  const match = TIMESTAMP_RE.exec(value);
  const instant = Date.parse(value);
  if (match && Number.isFinite(instant)) {
    const [, year, month, day, hour, minute, second, offsetHour, offsetMinute] = match;
    const y = Number(year);
    const m = Number(month);
    const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (m >= 1 && m <= 12 && Number(day) >= 1 && Number(day) <= (days[m - 1] ?? 0)
      && Number(hour) <= 23 && Number(minute) <= 59 && Number(second) <= 59
      && Number(offsetHour ?? 0) <= 23 && Number(offsetMinute ?? 0) <= 59) {
      return instant;
    }
  }
  errors.push({ field, message: "must be an ISO 8601 timestamp" });
  return undefined;
}

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
  const errors = payloadErrors(options.payload, false);
  if (errors.length) {
    throw new Error(`${EXECUTION_RUN_FINISHED_TYPE}: ${errors.map(error => `${error.field}: ${error.message}`).join("; ")}`);
  }
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
