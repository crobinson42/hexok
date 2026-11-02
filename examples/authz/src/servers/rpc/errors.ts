import { AuthzError } from '@hexok/authz';
import { isPFError, PFError } from '@ts-pf/protocol';
import { CodedError, type StandardSchemaV1 } from 'hexok';
import { DomainError, domainErrorDefs } from '../../domain/errors/domain.js';

type DomainCode = keyof typeof domainErrorDefs;

/**
 * The HTTP status for each domain error. Every code needs an entry, so a new
 * `DomainError` code fails type-check here.
 */
const statuses = {
  Forbidden: 403,
  NotFound: 404,
  AlreadyExists: 409,
  ShareRelationInvalid: 400,
  SubjectInvalid: 400,
  MemberInvalid: 400,
  ActorRequired: 401,
  ActorInvalid: 400,
} as const satisfies Record<DomainCode, number>;

type Declared<K extends DomainCode> = {
  [P in K]: (typeof domainErrorDefs)[P] & { status: (typeof statuses)[P] };
};

/**
 * Declared errors for a procedure: each domain definition with its status.
 * A client narrows on these codes and reads their typed `data`.
 */
export function declared<const K extends DomainCode>(
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
 * An `AuthzError` is a bad ref or action at status 400.
 */
export function toRpcError(error: unknown): unknown {
  if (DomainError.is(error)) {
    return new PFError({
      code: error.code,
      message: error.message,
      status: statuses[error.code],
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
  if (error instanceof AuthzError) {
    return new PFError({
      code: 'Authz',
      message: error.message,
      status: 400,
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
 * `onError` for the ts-pf handler. Declared and protocol errors are expected.
 * Unknown throws and `INTERNAL` are logged.
 */
export function logUnexpected(error: unknown): void {
  if (isPFError(error) && error.code !== 'INTERNAL') return;
  console.error(error instanceof Error ? error : 'Internal error');
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
