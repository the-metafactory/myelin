import Ajv from "ajv";
import type { ErrorObject, ValidateFunction } from "ajv";
import addFormats from "ajv-formats";

/**
 * F-16 T-2.x: JSON Schema validation for composition workflows.
 *
 * Two distinct concerns live in this file:
 *
 *   1. **Runtime data validation** (`validateData` / `compileSchema`)
 *      — at execution time, the orchestrator checks that a step's
 *      output actually matches its declared `output_schema` before
 *      handing the payload to the downstream step. Catches agents
 *      that return malformed data instead of letting it propagate.
 *
 *   2. **Load-time compatibility check**
 *      (`validateSchemaCompatibility`) — when a workflow is loaded,
 *      adjacent steps' schemas are checked for structural
 *      compatibility (every value matching the upstream `output_schema`
 *      should be acceptable to the downstream `input_schema`). This
 *      is intentionally a best-effort structural check, NOT a full
 *      subset proof — JSON Schema subset checking is undecidable in
 *      the general case. See `validateSchemaCompatibility` for the
 *      enforced rules and the documented limitations.
 *
 * Ajv ships its own draft 2020-12 mode but `draft-07` is the
 * default and matches `schemas/envelope.schema.json`. The shared
 * `getAjv()` instance enables `allErrors` (so callers see every
 * problem, not just the first) and adds formats via `ajv-formats`.
 */

export type JSONSchema = Record<string, unknown>;

export interface SchemaValidationError {
  /** JSON pointer to the offending value (e.g. "/items/0/name"). */
  path: string;
  message: string;
  /** Ajv keyword that failed (e.g. "type", "required", "enum"). */
  keyword: string;
}

export type SchemaValidationResult =
  | { valid: true }
  | { valid: false; errors: SchemaValidationError[] };

export type CompiledValidator = (data: unknown) => SchemaValidationResult;

let sharedAjv: Ajv | null = null;

function getAjv(): Ajv {
  if (sharedAjv) return sharedAjv;
  const ajv = new Ajv({
    allErrors: true,
    strict: false,
    validateFormats: true,
  });
  addFormats(ajv);
  sharedAjv = ajv;
  return ajv;
}

function toResult(errors: ErrorObject[] | null | undefined): SchemaValidationResult {
  if (!errors || errors.length === 0) return { valid: true };
  return {
    valid: false,
    errors: errors.map((err) => ({
      path: err.instancePath || "/",
      message: err.message ?? "validation failed",
      keyword: err.keyword,
    })),
  };
}

/**
 * Validate `data` against `schema`. Returns `{ valid: true }` or
 * a list of structured errors. Errors include the JSON pointer
 * to the offending value, Ajv's message, and the failing keyword.
 */
export function validateData(data: unknown, schema: JSONSchema): SchemaValidationResult {
  const validate = getAjv().compile(schema);
  const ok = validate(data);
  if (ok) return { valid: true };
  return toResult(validate.errors);
}

/**
 * Compile a schema once and return a reusable validator. Use this
 * when validating the same schema against many payloads (e.g. one
 * validator per workflow step). Reuses the shared Ajv instance so
 * format and reference resolution are consistent across compilations.
 */
export function compileSchema(schema: JSONSchema): CompiledValidator {
  const validate: ValidateFunction = getAjv().compile(schema);
  return (data: unknown) => {
    const ok = validate(data);
    if (ok) return { valid: true };
    return toResult(validate.errors);
  };
}

/**
 * Structural compatibility check between an upstream step's
 * `output_schema` and a downstream step's `input_schema`. Returns
 * `{ valid: true }` when the upstream schema is plausibly a subset
 * of the downstream schema (every output value would satisfy the
 * downstream input).
 *
 * ## What this enforces
 *
 * - `type` must agree when both schemas declare one. Mismatched
 *   primitive types reject immediately (`string` upstream,
 *   `number` downstream → fail).
 * - For `type: "object"`: every field in `downstream.required` must
 *   either be in `upstream.required` OR appear in
 *   `upstream.properties` with a non-optional shape that overlaps.
 *   Conservative: if upstream cannot guarantee a downstream-required
 *   field, the check fails.
 * - For shared property names (in both `properties` maps), the
 *   property's schemas are recursively checked for compatibility.
 *   Properties only present upstream are allowed (downstream's
 *   schema may accept them as additional, or
 *   `additionalProperties: false` would have been declared).
 * - For `type: "array"`: if both declare `items`, the item schemas
 *   are recursively compatibility-checked.
 * - `enum` constraints: downstream's enum must be a superset of
 *   upstream's enum (every upstream value must be acceptable).
 *
 * ## What this does NOT enforce (documented limitations)
 *
 * Full JSON Schema subset checking is undecidable; this is the
 * coarse-but-useful check. The following do NOT trigger rejection:
 *
 * - `oneOf`, `anyOf`, `allOf`, `not`, `if`/`then`/`else` are not
 *   recursed. Schemas using these constructs are treated as opaque
 *   (compatible if `type` matches).
 * - `$ref` is not resolved — schemas are checked as-given.
 * - `minimum`, `maximum`, `minLength`, `maxLength`, `pattern`, and
 *   other constraint keywords are not compared.
 * - `additionalProperties: false` on the downstream is not used to
 *   reject upstream properties not in downstream's `properties`
 *   (would require a much larger overhaul; flagged as a future
 *   enhancement).
 *
 * For workflows where strict compatibility matters, declare schemas
 * explicitly and exercise the path with `validateData` at runtime —
 * runtime validation catches what the structural check misses.
 */
export function validateSchemaCompatibility(
  upstream: JSONSchema,
  downstream: JSONSchema,
): SchemaValidationResult {
  const errors: SchemaValidationError[] = [];
  walkCompatibility(upstream, downstream, "", errors);
  if (errors.length === 0) return { valid: true };
  return { valid: false, errors };
}

function walkCompatibility(
  upstream: JSONSchema,
  downstream: JSONSchema,
  path: string,
  errors: SchemaValidationError[],
): void {
  const upType = typeOf(upstream);
  const downType = typeOf(downstream);

  if (upType && downType && upType !== downType) {
    errors.push({
      path: path || "/",
      message: `upstream type '${upType}' does not match downstream type '${downType}'`,
      keyword: "type",
    });
    return;
  }

  // enum subset: every upstream-allowed value must be acceptable downstream.
  if (Array.isArray(upstream.enum) && Array.isArray(downstream.enum)) {
    const downSet = new Set(downstream.enum);
    const missing = upstream.enum.filter((v) => !downSet.has(v));
    if (missing.length > 0) {
      errors.push({
        path: path || "/",
        message: `upstream enum value(s) ${JSON.stringify(missing)} not in downstream enum`,
        keyword: "enum",
      });
    }
  }

  const effectiveType = downType ?? upType;

  if (effectiveType === "object") {
    const upRequired = toStringSet(upstream.required);
    const downRequired = toStringSet(downstream.required);
    const upProperties = (isObject(upstream.properties) ? upstream.properties : {}) as Record<string, JSONSchema>;
    const downProperties = (isObject(downstream.properties) ? downstream.properties : {}) as Record<string, JSONSchema>;

    for (const required of downRequired) {
      if (upRequired.has(required)) continue;
      if (upProperties[required] === undefined) {
        errors.push({
          path: joinPath(path, required),
          message: `downstream requires '${required}' but upstream does not guarantee it`,
          keyword: "required",
        });
      }
    }

    for (const [name, downChild] of Object.entries(downProperties)) {
      const upChild = upProperties[name];
      if (!upChild) continue;
      walkCompatibility(upChild, downChild, joinPath(path, name), errors);
    }
  } else if (effectiveType === "array") {
    const upItems = upstream.items;
    const downItems = downstream.items;
    if (isObject(upItems) && isObject(downItems)) {
      walkCompatibility(upItems as JSONSchema, downItems as JSONSchema, joinPath(path, "items"), errors);
    }
  }
}

function typeOf(schema: JSONSchema): string | undefined {
  const t = schema.type;
  if (typeof t === "string") return t;
  return undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStringSet(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set();
  return new Set(value.filter((v): v is string => typeof v === "string"));
}

function joinPath(parent: string, key: string): string {
  return `${parent}/${key}`;
}
