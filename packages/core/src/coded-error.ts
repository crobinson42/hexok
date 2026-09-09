/**
 * Thrown by use-case error factories. HTTP status lives here, not on the entity.
 *
 * ```ts
 * throw new CodedError({ code: 'NOT_FOUND', status: 404, message: 'Incident not found' })
 * ```
 */
export class CodedError<C extends string = string> extends Error {
  readonly code: C;
  readonly status: number;
  readonly data?: unknown;

  constructor(args: {
    code: C;
    status?: number;
    message?: string;
    data?: unknown;
  }) {
    super(args.message ?? args.code);
    this.name = 'CodedError';
    this.code = args.code;
    this.status = args.status ?? 400;
    if ('data' in args) {
      this.data = args.data;
    }
  }
}
