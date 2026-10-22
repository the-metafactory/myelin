import { vigilAttentionResolvedSubject } from "../subjects";
import {
  ATTENTION_RESOLUTIONS,
  VIGIL_ATTENTION_RESOLVED_TYPE,
  type VigilAttentionEventType,
} from "../subject-vocabulary";
import type { EnvelopePublishInput } from "../transport/types";
import type { MyelinEnvelope, Sovereignty, ValidationError, ValidationResult } from "../types";
import { closedObject, enumValue, isRecord, nonEmptyString, throwIfInvalid, timestamp } from "./payload-checks";
import type { VigilAttentionResolvedPayload } from "./types";

export interface CreateVigilAttentionResolvedOptions {
  source: string;
  // glossary-ignore: principal
  // the Principal's Subject segment, not a general Identity.
  principal: string;
  stack: string;
  sovereignty: Partial<Sovereignty>;
  payload: VigilAttentionResolvedPayload;
}

export interface VigilAttentionResolvedPublishInput extends EnvelopePublishInput {
  type: VigilAttentionEventType;
  payload: VigilAttentionResolvedPayload & Record<string, unknown>;
}

export interface VigilAttentionResolvedEvent {
  subject: string;
  input: VigilAttentionResolvedPublishInput;
}

const PAYLOAD_KEYS = ["key", "kind", "resolution", "ran_ref", "resolved_at", "filed"] as const;
// glossary-ignore: owner
// GitHub account coordinate, not the Myelin Principal role.
/** owner/repo#N: a GitHub owner, a repo name other than . or .., and a positive issue number. */
const NODE_REF_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/(?!\.\.?#)[A-Za-z0-9._-]{1,100}#[1-9]\d*$/;

/** Shared by both public interfaces. */
function payloadErrors(value: unknown): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!closedObject(value, "payload", PAYLOAD_KEYS, errors)) return errors;
  for (const field of ["key", "kind", "ran_ref"]) nonEmptyString(value[field], `payload.${field}`, errors);
  enumValue(value.resolution, "payload.resolution", ATTENTION_RESOLUTIONS, errors);
  timestamp(value.resolved_at, "payload.resolved_at", errors);
  if (Object.hasOwn(value, "filed")) {
    if (value.resolution !== "approved") {
      // glossary-ignore: message
      // ValidationError diagnostic text, not an Envelope or Payload.
      errors.push({ field: "payload.filed", message: "is only allowed when resolution is approved" });
    }
    if (nonEmptyString(value.filed, "payload.filed", errors) && !NODE_REF_RE.test(value.filed)) {
      // glossary-ignore: message, owner
      // diagnostic text and a GitHub account coordinate.
      errors.push({ field: "payload.filed", message: "must be a node ref owner/repo#N" });
    }
  }
  return errors;
}

/** Validate Vigil's resolution record and construct the stack-aware publish subject/input. */
export function createVigilAttentionResolved(options: CreateVigilAttentionResolvedOptions): VigilAttentionResolvedEvent {
  throwIfInvalid(VIGIL_ATTENTION_RESOLVED_TYPE, payloadErrors(options.payload));
  return {
    subject: vigilAttentionResolvedSubject(options.principal, options.stack),
    input: {
      source: options.source,
      type: VIGIL_ATTENTION_RESOLVED_TYPE,
      sovereignty: options.sovereignty,
      payload: { ...options.payload },
    },
  };
}

/** Check a received resolution envelope without throwing on a malformed envelope or payload. */
export function validateVigilAttentionResolved(envelope: MyelinEnvelope): ValidationResult {
  // glossary-ignore: message
  // ValidationError diagnostic text, not an Envelope or Payload.
  if (!isRecord(envelope)) return { valid: false, errors: [{ field: "envelope", message: "must be an object" }] };
  const errors = payloadErrors(envelope.payload);
  if (envelope.type !== VIGIL_ATTENTION_RESOLVED_TYPE) {
    // glossary-ignore: message
    // ValidationError diagnostic text, not an Envelope or Payload.
    errors.push({ field: "type", message: `must be ${VIGIL_ATTENTION_RESOLVED_TYPE}` });
  }
  return { valid: errors.length === 0, errors };
}
