import { Errors, type StandardSchemaV1 } from 'hexok';

const problems: StandardSchemaV1<{ problems: readonly string[] }> = {
  '~standard': {
    version: 1,
    vendor: 'hexok-auth',
    validate(value) {
      if (
        typeof value === 'object' &&
        value !== null &&
        'problems' in value &&
        Array.isArray(value.problems) &&
        value.problems.every((each) => typeof each === 'string')
      ) {
        return { value: value as { problems: readonly string[] } };
      }
      return { issues: [{ message: 'problems must be a list of strings' }] };
    },
  },
};

/**
 * `Unauthenticated` is for an edge that throws one error for every refusal.
 * `InvalidConfig` lists every bad setting at once, so a process that fails to
 * start says why.
 */
export class AuthError extends Errors('auth', {
  Unauthenticated: { message: 'The call did not prove who it is.' },
  InvalidConfig: {
    message: 'The auth config is not valid.',
    data: problems,
  },
}) {}

/** The `InvalidConfig` error for `list`, with every problem in the message. */
export function invalidConfig(list: readonly string[]) {
  return AuthError.InvalidConfig(
    `The auth config is not valid:\n  ${list.join('\n  ')}`,
    { problems: list },
  );
}
