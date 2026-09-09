import type { StandardSchemaV1 } from './standard-schema.js';

/**
 * Wire metadata for one error code. Keys of an `ErrorMap` **are** the error union.
 *
 * ```ts
 * const errors = {
 *   NOT_FOUND: { status: 404, message: 'Incident not found' },
 * } as const satisfies ErrorMap
 * ```
 */
export interface ErrorDef {
  status?: number;
  message?: string;
  data?: StandardSchemaV1;
}

export type ErrorMap = Record<string, ErrorDef>;
