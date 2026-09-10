/**
 * Success-or-code result. `validate` returns this; use cases may `unwrap` it.
 * Entity methods throw `CodedError` instead of returning a Result.
 *
 * ```ts
 * const parsed = validate(schema, value)
 * // Result<Output, 'VALIDATION'>
 * ```
 */
export type Result<T, E extends string = string> =
  | { ok: true; value: T }
  | { ok: false; code: E };

/** Wrap a value. The error arm is `never` so unions collapse from `ok`/`fail` branches. */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/** Wrap an error code. The value arm is `never` so unions collapse from `ok`/`fail` branches. */
export function fail<E extends string>(code: E): Result<never, E> {
  return { ok: false, code };
}
