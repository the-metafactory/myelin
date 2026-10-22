import type { ValidationError } from "../types";

const TIMESTAMP_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function closedObject(
  value: unknown,
  field: string,
  keys: readonly string[],
  errors: ValidationError[],
): value is Record<string, unknown> {
  if (!isRecord(value)) {
    // glossary-ignore: message
    // ValidationError diagnostic text, not an Envelope or Payload.
    errors.push({ field, message: "must be an object" });
    return false;
  }
  for (const key of Object.keys(value)) {
    // glossary-ignore: message
    // ValidationError diagnostic text, not an Envelope or Payload.
    if (!keys.includes(key)) errors.push({ field: `${field}.${key}`, message: "unknown field" });
  }
  return true;
}

export function nonEmptyString(value: unknown, field: string, errors: ValidationError[]): value is string {
  if (typeof value !== "string" || value.length === 0) {
    // glossary-ignore: message
    // ValidationError diagnostic text, not an Envelope or Payload.
    errors.push({ field, message: "must be a non-empty string" });
    return false;
  }
  return true;
}

export function enumValue(value: unknown, field: string, values: readonly string[], errors: ValidationError[]): void {
  if (nonEmptyString(value, field, errors) && !values.includes(value)) {
    // glossary-ignore: message
    // ValidationError diagnostic text, not an Envelope or Payload.
    errors.push({ field, message: `must be one of: ${values.join(", ")}` });
  }
}

export function timestamp(value: unknown, field: string, errors: ValidationError[]): number | undefined {
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
  // glossary-ignore: message
  // ValidationError diagnostic text, not an Envelope or Payload.
  errors.push({ field, message: "must be an ISO 8601 timestamp" });
  return undefined;
}

/** Format builder-side validation diagnostics into an exception prefixed by the envelope type. */
export function throwIfInvalid(type: string, errors: readonly ValidationError[]): void {
  if (errors.length) {
    // glossary-ignore: error, message
    // a ValidationError diagnostic and its text, not a Nak or Envelope.
    throw new Error(`${type}: ${errors.map(error => `${error.field}: ${error.message}`).join("; ")}`);
  }
}
