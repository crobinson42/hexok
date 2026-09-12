import type { StandardSchemaV1 } from './standard-schema.js';

/**
 * Success-or-code result. `validate` returns this; use cases may `unwrap` it.
 * Entity methods throw `CodedError` instead of returning a Result.
 *
 * ```ts
 * const parsed = validate(schema, value)
 * // Result<Output, 'VALIDATION'> — fail may include `issues`
 * ```
 */
export type Result<T, E extends string = string> =
  | { ok: true; value: T }
  | {
      ok: false;
      code: E;
      issues?: readonly StandardSchemaV1.Issue[];
    };

/** Wrap a value. The error arm is `never` so unions collapse from `ok`/`fail` branches. */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/** Wrap an error code. Pass `issues` from a Standard Schema fail so callers can show field errors. */
export function fail<E extends string>(
  code: E,
  issues?: readonly StandardSchemaV1.Issue[],
): Result<never, E> {
  return issues !== undefined
    ? { ok: false, code, issues }
    : { ok: false, code };
}
