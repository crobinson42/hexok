import { type ErrorMap, Errors } from 'hexok';
import { z } from 'zod';

/** Refusals a caller can act on. HTTP status lives in `servers/rpc/errors.ts`. */
export const domainErrorDefs = {
  Forbidden: { message: 'Forbidden.' },
  NotFound: {
    message: 'Not found.',
    data: z.object({ type: z.string(), id: z.string() }),
  },
  AlreadyExists: {
    message: 'Already exists.',
    data: z.object({ type: z.string(), id: z.string() }),
  },
  ShareRelationInvalid: {
    message: 'A share relation is viewer or editor.',
  },
  SubjectInvalid: { message: 'Invalid subject.' },
  MemberInvalid: { message: 'A member is a user or a group.' },
  ActorRequired: { message: 'Missing x-actor header.' },
  ActorInvalid: { message: 'Invalid x-actor header.' },
} satisfies ErrorMap;

export class DomainError extends Errors('domain', domainErrorDefs) {}
