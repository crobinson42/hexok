import { Errors } from 'hexok';
import { z } from 'zod';

export class DomainError extends Errors('domain', {
  AlreadyPublished: { message: 'Post is already published' },
  NotPublished: { message: 'Post is not published' },
  PostNotFound: {
    message: 'Post was not found',
    data: z.object({ id: z.string() }),
  },
  InternalCallerRequired: {
    message: 'This use case only runs from inside the application',
  },
  InvalidScheduleDate: {
    message: 'Schedule date is invalid',
    data: z.object({ value: z.string() }),
  },
  InvalidTimezone: {
    message: 'Schedule timezone is invalid',
    data: z.object({ timezone: z.string() }),
  },
}) {}
