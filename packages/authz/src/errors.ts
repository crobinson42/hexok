import { Errors, type StandardSchemaV1 } from 'hexok';

/** Types an error payload. The `Errors` factory does not run the schema. */
function data<T>(): StandardSchemaV1<T> {
  return {
    '~standard': {
      version: 1,
      vendor: 'hexok-authz',
      validate: (value) => ({ value: value as T }),
    },
  };
}

export class AuthzError extends Errors('authz', {
  NotAMember: { message: 'Subject is not a member of the organization' },
  OrgRequired: { message: 'Subject has several organizations. Name one' },
  NotFound: { message: 'Not found', data: data<{ id: string }>() },
  Forbidden: { message: 'Forbidden', data: data<{ action: string }>() },
  Escalation: {
    message: 'Cannot give actions the actor does not hold here',
    data: data<{ missing: readonly string[] }>(),
  },
  UnknownAction: {
    message: 'Actions are not in the catalog',
    data: data<{ actions: readonly string[] }>(),
  },
  InUse: { message: 'A grant still uses this permission set' },
  ProtectedSet: { message: 'This permission set follows the catalog' },
  ParentNotPlaced: {
    message: 'Parent has no path yet',
    data: data<{ id: string }>(),
  },
  InvalidPath: {
    message: 'This placement or move is not possible',
    data: data<{ id: string }>(),
  },
}) {}
