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
  message?: string;
  data?: StandardSchemaV1;
}

export type ErrorMap = Record<string, ErrorDef>;
