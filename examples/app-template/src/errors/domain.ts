import { Errors } from 'hexok';
import { z } from 'zod';

export class DomainError extends Errors('domain', {
  AlreadyPublished: { message: 'Post is already published' },
  NotPublished: { message: 'Post is not published' },
  PostNotFound: {
    message: 'Post was not found',
    data: z.object({ id: z.string() }),
  },
  IpAddressMissing: { message: 'IP address is missing' },
}) {}
