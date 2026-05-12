import Ajv2020 from "ajv/dist/2020";
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
 *      handing the payload to the downstream step.
 *
 *   2. **Load-time compatibility check** (`validateSchemaCompatibility`)
 *      — when a workflow is loaded, adjacent steps' schemas are
 *      checked for structural compatibility (every value matching the
 *      upstream `output_schema` should be acceptable to the
 *      downstream `input_schema`). Best-effort structural check, NOT
 *      a full subset proof — JSON Schema subset checking is undecidable
 *      in the general case.
 *
 * ## Ajv draft
 *
 * This file uses Ajv's draft-2020-12 build (`ajv/dist/2020`) so it
 * matches `schemas/envelope.schema.json` which declares
 * `"$schema": "https://json-schema.org/draft/2020-12/schema"`. The
 * non-2020 Ajv default would silently no-op on `prefixItems`,
 * `$dynamicRef`, `dependentSchemas`, and `unevaluatedProperties` —
 * the worst failure mode (passes that should fail).
 *
 * ## Ajv lifecycle
 *
 * Every entry point creates a FRESH Ajv instance scoped to the call
 * (or to the lifetime of the returned `CompiledValidator` for
 * `compileSchema`). No process-global instance. This is deliberate:
 * Ajv's internal schema cache grows monotonically per compiled
 * schema, and the orchestrator hot-reload path repeatedly compiles
 * fresh schema objects. A shared instance would leak under sustained
 * load. Cost: small per-call Ajv construction overhead — acceptable
 * for load-time use; performance-sensitive callers should bind
 * `compileSchema` once and reuse the returned closure.
 *
 * ## Schema trust
 *
 * `validateData` and `compileSchema` invoke Ajv on the caller-supplied
 * schema. Ajv compiles arbitrary schema input into JavaScript and
 * passes `pattern` keywords straight to V8 `RegExp` (vulnerable to
 * ReDoS). Schemas passed to these functions MUST be trusted (typically
 * operator-defined workflow `input_schema` / `output_schema` from a
 * known WorkflowDefinition). Do not pass user-supplied schemas through
 * this layer without an upstream depth + pattern audit.
 *
 * ## strict mode
 *
 * Ajv `strict: "log"` is used so schema-authoring typos
 * (`{ "minimun": 5 }` instead of `{ "minimum": 5 }`) surface as a
 * console warning at compile time without throwing. Strict-throw would
 * break too many existing inputs; strict-off would silently swallow
 * the typo. The middle setting catches the class of bug a load-time
 * check should report.
 */

export type JSONSchema = Record<string, unknown>;

export interface SchemaValidationError {
  /**
   * JSON Pointer (RFC 6901) to the offending value. Root is the
   * empty string `""`. `/items/0/name` points to nested data.
   */
  path: string;
  message: string;
  /** Ajv keyword that failed (e.g. "type", "required", "enum"). */
  keyword: string;
}

export type SchemaValidationResult =
  | { valid: true }
  | { valid: false; errors: SchemaValidationError[] };

export type CompiledValidator = (data: unknown) => SchemaValidationResult;

function newAjv(): Ajv2020 {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: "log",
    validateFormats: true,
  });
  addFormats(ajv);
  return ajv;
}

function toResult(errors: ErrorObject[] | null | undefined): SchemaValidationResult {
  if (!errors || errors.length === 0) return { valid: true };
  return {
    valid: false,
    errors: errors.map((err) => ({
      path: err.instancePath ?? "",
      message: err.message ?? "validation failed",
      keyword: err.keyword,
    })),
  };
}

/**
 * Validate `data` against `schema`. Returns `{ valid: true }` or a
 * list of structured errors with RFC 6901 JSON Pointers. Constructs
 * a fresh Ajv per call to avoid cross-call schema cache growth; use
 * `compileSchema` for hot-path reuse.
 */
export function validateData(data: unknown, schema: JSONSchema): SchemaValidationResult {
  const ajv = newAjv();
  const validate = ajv.compile(schema);
  const ok = validate(data);
  if (ok) return { valid: true };
  return toResult(validate.errors);
}

/**
 * Compile a schema once and return a reusable validator. The
 * returned closure captures its own Ajv instance — the cache is
 * scoped to the validator's lifetime and is freed when the closure
 * is dropped.
 */
export function compileSchema(schema: JSONSchema): CompiledValidator {
  const ajv = newAjv();
  const validate: ValidateFunction = ajv.compile(schema);
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
 * of the downstream schema.
 *
 * ## What this enforces
 *
 * - **Type agreement (set-based).** Both schemas' `type` values are
 *   normalized to a Set (string scalar or array of strings, e.g.
 *   `type: ["string","null"]` for nullable). Compatible iff every
 *   upstream type is acceptable downstream (upstream-set ⊆
 *   downstream-set). Nullable upstream + non-null downstream
 *   rejects.
 * - **Required object fields.** Every field in `downstream.required`
 *   must be in `upstream.required`. Optional-with-matching-property
 *   in upstream is NOT sufficient: the upstream is allowed to omit
 *   the field, downstream would then fail at runtime. Strict by
 *   default; relax by declaring the field as `required` upstream.
 * - **Shared property recursion.** For each property name in BOTH
 *   `upstream.properties` and `downstream.properties`, the property
 *   schemas are checked recursively. Upstream-only properties pass.
 * - **Array `items` recursion.** When both declare an `items` schema,
 *   recurse. Tuple-form `items: [schemaA, schemaB]` is not recursed
 *   (documented limitation; would need a separate matcher).
 * - **Enum subset.**
 *   - Both have `enum`: upstream values must be a subset of downstream
 *     values.
 *   - Downstream-only `enum`: rejected — upstream is unconstrained,
 *     so it may emit a value not in downstream's enum.
 *   - Upstream-only `enum`: accepted — downstream has no enum
 *     constraint to fail.
 *
 * ## Documented limitations (do NOT trigger rejection)
 *
 * - `oneOf` / `anyOf` / `allOf` / `not` / `if`/`then`/`else` —
 *   treated as opaque (compatible if `type` matches).
 * - `$ref` is not resolved. Recursive schemas terminate via the
 *   opaque treatment — the walker recurses only into resolved
 *   `properties` / `items`, never into `$ref`.
 * - Tuple-form `items: [...]` is not recursed.
 * - `minimum`, `maximum`, `minLength`, `maxLength`, `pattern`,
 *   `multipleOf` — not compared.
 * - `additionalProperties: false` is not enforced against upstream
 *   extras.
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
  const upTypes = normalizeType(upstream);
  const downTypes = normalizeType(downstream);

  if (upTypes && downTypes) {
    for (const t of upTypes) {
      if (!downTypes.has(t)) {
        errors.push({
          path,
          message: `upstream type '${t}' not accepted by downstream types [${[...downTypes].join(", ")}]`,
          keyword: "type",
        });
      }
    }
    if (errors.some((e) => e.keyword === "type" && e.path === path)) return;
  }

  const upEnum = Array.isArray(upstream.enum) ? upstream.enum : null;
  const downEnum = Array.isArray(downstream.enum) ? downstream.enum : null;
  if (downEnum) {
    if (!upEnum) {
      errors.push({
        path,
        message: `upstream is unconstrained but downstream restricts to ${downEnum.length} enum value(s)`,
        keyword: "enum",
      });
    } else {
      const downSet = new Set(downEnum);
      const missing = upEnum.filter((v) => !downSet.has(v));
      if (missing.length > 0) {
        errors.push({
          path,
          message: `upstream enum value(s) ${JSON.stringify(missing)} not in downstream enum`,
          keyword: "enum",
        });
      }
    }
  }

  // For object/array recursion: take the effective type to be the
  // intersection. If neither schema specifies, default to recursing
  // into properties/items when they exist (best-effort).
  const recurseAsObject =
    (downTypes?.has("object") ?? false) ||
    (upTypes?.has("object") ?? false) ||
    (!downTypes && !upTypes && (isObject(upstream.properties) || isObject(downstream.properties)));
  const recurseAsArray =
    (downTypes?.has("array") ?? false) ||
    (upTypes?.has("array") ?? false) ||
    (!downTypes && !upTypes && (isObject(upstream.items) || isObject(downstream.items)));

  if (recurseAsObject) {
    const upRequired = toStringSet(upstream.required);
    const downRequired = toStringSet(downstream.required);
    const upProperties = (isObject(upstream.properties) ? upstream.properties : {}) as Record<
      string,
      JSONSchema
    >;
    const downProperties = (isObject(downstream.properties)
      ? downstream.properties
      : {}) as Record<string, JSONSchema>;

    for (const required of downRequired) {
      if (!upRequired.has(required)) {
        errors.push({
          path: joinPath(path, required),
          message: `downstream requires '${required}' but upstream does not (only required fields in upstream are guaranteed)`,
          keyword: "required",
        });
      }
    }

    for (const [name, downChild] of Object.entries(downProperties)) {
      const upChild = upProperties[name];
      if (!upChild) continue;
      walkCompatibility(upChild, downChild, joinPath(path, name), errors);
    }
  } else if (recurseAsArray) {
    const upItems = upstream.items;
    const downItems = downstream.items;
    if (isObject(upItems) && isObject(downItems)) {
      walkCompatibility(upItems as JSONSchema, downItems as JSONSchema, joinPath(path, "items"), errors);
    }
  }
}

function normalizeType(schema: JSONSchema): Set<string> | null {
  const t = schema.type;
  if (typeof t === "string") return new Set([t]);
  if (Array.isArray(t)) {
    const filtered = t.filter((v): v is string => typeof v === "string");
    if (filtered.length === 0) return null;
    return new Set(filtered);
  }
  return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStringSet(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set();
  return new Set(value.filter((v): v is string => typeof v === "string"));
}

function joinPath(parent: string, key: string): string {
  return `${parent}/${escapeJsonPointer(key)}`;
}

function escapeJsonPointer(key: string): string {
  return key.replace(/~/g, "~0").replace(/\//g, "~1");
}
