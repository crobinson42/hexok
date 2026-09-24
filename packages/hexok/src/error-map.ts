import type { StandardSchemaV1 } from './standard-schema.js';
import type { Infer } from './validate.js';

/**
 * Declared metadata for one error code. Keys of an `ErrorMap` **are** the error union.
 *
 * ```ts
 * const errors = {
 *   NOT_FOUND: { message: 'Incident not found' },
 * }
 * ```
 */
export interface ErrorDef {
  /** Human message. Factories fall back to the code when omitted. */
  message?: string;
  /** Optional payload schema for `errors.CODE(data)`. */
  data?: StandardSchemaV1;
}

/** `static errors` bag. Prefer `defineErrors({ ... })` so keys stay a finite union. */
export type ErrorMap = Record<string, ErrorDef>;

/** No declared codes. `error()` accepts nothing. */
export type EmptyErrors = Record<never, ErrorDef>;

/**
 * Argument list for `error(code, ...)`.
 * A code whose definition has `data` requires that schema's output.
 * A code without `data` takes no second argument.
 */
export type ErrorArgs<
  E extends ErrorMap,
  K extends keyof E & string,
> = E[K] extends { data: infer S extends StandardSchemaV1 }
  ? [data: Infer<S>]
  : [];

/** Infer error-code keys from an object literal. */
export function defineErrors<const M extends Record<string, ErrorDef>>(
  map: M,
): M {
  return map;
}
