import { Errors } from 'hexok';
import { z } from 'zod';

export class DomainError extends Errors('domain', {
  Unauthorized: { message: 'Unauthorized' },
  BlankName: { message: 'Name is blank' },
  TraceIdMissing: { message: 'Trace ID is missing' },
  UserExists: {
    message: 'User already exists',
    data: z.object({ id: z.string() }),
  },
}) {}
