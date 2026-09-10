/**
 * Thrown by entity refusals and use-case error factories.
 * Carries `code`, optional `message`, and optional `data`.
 *
 * ```ts
 * throw new CodedError({ code: 'NOT_FOUND', message: 'Incident not found' })
 * ```
 */
export class CodedError<C extends string = string> extends Error {
  readonly code: C;
  readonly data?: unknown;

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
