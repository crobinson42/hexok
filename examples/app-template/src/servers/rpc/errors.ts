import type { Logger } from '@hexok/logger';
import { isPFError, PFError } from '@ts-pf/protocol';
import { CodedError, type StandardSchemaV1 } from 'hexok';
import { DomainError, domainErrorDefs } from '../../domain/errors/domain.js';

type DomainCode = keyof typeof domainErrorDefs;

/**
 * The HTTP status for each domain error. Every code needs an entry, so a new
 * `DomainError` code fails type-check here. `null` keeps the error from
 * clients: it is sent as `INTERNAL`.
 */
const statuses = {
  PostNotFound: 404,
  AlreadyPublished: 409,
  NotPublished: 409,
  NotScheduled: 409,
  PublishAtInvalid: 400,
  ChannelsRequired: 400,
  ChannelsInvalid: 400,
  SmsRequiresPhone: 400,
  Unauthenticated: 401,
  SignInRequired: 401,
  InternalCallerRequired: null,
} as const satisfies Record<DomainCode, number | null>;

type ClientCode = {
  [K in DomainCode]: (typeof statuses)[K] extends number ? K : never;
}[DomainCode];

type Declared<K extends ClientCode> = {
  [P in K]: (typeof domainErrorDefs)[P] & { status: (typeof statuses)[P] };
};

/**
 * Declared errors for a procedure: each domain definition with its status.
 * A client narrows on these codes and reads their typed `data`.
 */
export function declared<const K extends ClientCode>(
  ...codes: K[]
): Declared<K> {
  return Object.fromEntries(
    codes.map((code) => [
      code,
      { ...domainErrorDefs[code], status: statuses[code] },
    ]),
  ) as Declared<K>;
}

/**
 * The error a client receives. A domain error keeps its code, message,
 * data, and status. A hexok `VALIDATION` becomes the protocol's `VALIDATION`.
 * Anything else passes through, and ts-pf sends it as `INTERNAL`.
 */
export function toRpcError(error: unknown): unknown {
  if (DomainError.is(error)) {
    const status = statuses[error.code];
    if (status === null) return error;
    return new PFError({
      code: error.code,
      message: error.message,
      status,
      ...(error.data === undefined ? {} : { data: error.data }),
      cause: error,
    });
  }
  if (error instanceof CodedError && error.code === 'VALIDATION') {
    return new PFError({
      code: 'VALIDATION',
      message: error.message,
      data: { issues: issuesOf(error.data) },
      cause: error,
    });
  }
  return error;
}

/** Middleware for every procedure. Rethrows with {@link toRpcError}. */
export async function rpcErrors({
  next,
}: {
  next: () => Promise<unknown>;
}): Promise<unknown> {
  try {
    return await next();
  } catch (error) {
    throw toRpcError(error);
  }
}

/**
 * `onError` for the ts-pf handlers. Declared and protocol errors are
 * expected. Unknown throws and `INTERNAL` are logged.
 */
export function logUnexpected(logger: Logger): (error: unknown) => void {
  return (error) => {
    if (isPFError(error) && error.code !== 'INTERNAL') return;
    logger.error(error instanceof Error ? error : 'Internal error');
  };
}

/** Standard Schema issues as the protocol's `{ message, path }`. */
function issuesOf(data: unknown): { message: string; path: PropertyKey[] }[] {
  if (typeof data !== 'object' || data === null || !('issues' in data)) {
    return [];
  }
  const issues = data.issues as readonly StandardSchemaV1.Issue[];
  return issues.map((issue) => ({
    message: issue.message,
    path: (issue.path ?? []).map((segment) =>
      typeof segment === 'object' ? segment.key : segment,
    ),
  }));
}
