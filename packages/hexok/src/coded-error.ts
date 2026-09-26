import type { StandardSchemaV1 } from './standard-schema.js';

/**
 * Code, message, and optional data. Schema checks throw this with code
 * `VALIDATION`. The application catches it where errors bubble.
 *
 * Application refusals use an {@link Errors} catalog.
 *
 * ```ts
 * new CodedError({
 *   code: 'VALIDATION',
 *   message: 'hexok: User validation failed',
 * })
 * ```
 */
export class CodedError<C extends string = string> extends Error {
  /** Machine-readable code. Schema checks use `VALIDATION`. */
  readonly code: C;
  /** Optional payload. Set only when the constructor received `data`. */
  readonly data?: unknown;

  /** `message` defaults to `code`. */
  constructor(args: {
    code: C;
    message?: string;
    data?: unknown;
  }) {
    super(args.message ?? args.code);
    this.name = 'CodedError';
    this.code = args.code;
    if ('data' in args) {
      this.data = args.data;
    }
  }
}

/** `VALIDATION` refusal. `data.issues` is the Standard Schema issue list when present. */
export function validationError(
  message: string,
  issues?: readonly StandardSchemaV1.Issue[],
): CodedError<'VALIDATION'> {
  return new CodedError({
    code: 'VALIDATION',
    message,
    ...(issues !== undefined ? { data: { issues } } : {}),
  });
}
