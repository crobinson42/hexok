import { Errors } from 'hexok';
import { z } from 'zod';

export class DomainError extends Errors('domain', {
  BlankName: { message: 'Name is blank' },
  UserExists: {
    message: 'User already exists',
    data: z.object({ id: z.string() }),
  },
}) {}
