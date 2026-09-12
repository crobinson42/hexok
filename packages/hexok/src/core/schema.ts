import { fail, ok, type Result } from './result.js';
import type { StandardSchemaV1 } from './standard-schema.js';

/** Output type of a Standard Schema V1 schema. */
export type Infer<S extends StandardSchemaV1> = NonNullable<
  S['~standard']['types']
>['output'];

/**
 * Validate `value` with a Standard Schema. Sync only.
 *
 * Failures are `'VALIDATION'` plus Standard Schema `issues`. Entity
 * `create` / `parse` / `set` / `validate()` throw that as `CodedError`.
 * `restore` does not run the schema.
 * Async schemas belong at the RPC boundary and throw.
 *
 * ```ts
 * const parsed = validate(Incident.schema, body)
 * if (!parsed.ok) return parsed
 * ```
 */
export function validate<S extends StandardSchemaV1>(
  schema: S,
  value: unknown,
): Result<Infer<S>, 'VALIDATION'> {
  const result = schema['~standard'].validate(value);
  if (isPromise(result)) {
    throw new Error('hexok: async schemas belong at the RPC boundary');
  }
  if (result.issues) {
    return fail('VALIDATION', result.issues);
  }
  return ok(result.value as Infer<S>);
}

function isPromise(
  value:
    | StandardSchemaV1.Result<unknown>
    | Promise<StandardSchemaV1.Result<unknown>>,
): value is Promise<StandardSchemaV1.Result<unknown>> {
  return typeof (value as Promise<unknown>).then === 'function';
}
