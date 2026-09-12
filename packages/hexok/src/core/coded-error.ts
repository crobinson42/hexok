/**
 * Thrown by entity refusals and use-case error factories.
 * Carries `code`, optional `message`, and optional `data`.
 *
 * ```ts
 * throw new CodedError({ code: 'NOT_FOUND', message: 'Incident not found' })
 * ```
 */
export class CodedError<C extends string = string> extends Error {
  /** Machine-readable refusal code. Catch and switch on this; HTTP maps it to a status. */
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
