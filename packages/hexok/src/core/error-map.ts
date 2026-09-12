import type { StandardSchemaV1 } from './standard-schema.js';

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

/** `static errors` bag. Declare `as const satisfies ErrorMap` so keys stay a finite union. */
export type ErrorMap = Record<string, ErrorDef>;
