import type { StandardSchemaV1 } from './standard-schema.js';

/**
 * One code in an {@link Errors} catalog. The key of an {@link ErrorMap} is the code.
 *
 * ```ts
 * const defs = {
 *   UserExists: { message: 'User already exists' },
 * }
 * ```
 */
export interface ErrorDef {
  /**
   * Default message. The factory uses the code when this is omitted.
   * A call may override it by passing a string first.
   */
  message?: string;
  /** Payload schema. The member factory requires this schema's output. */
  data?: StandardSchemaV1;
}

/** Definition map passed to {@link Errors}. Keys are the member codes. */
export type ErrorMap = Record<string, ErrorDef>;
