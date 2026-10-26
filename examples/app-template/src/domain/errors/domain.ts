import { Errors } from 'hexok';
import { z } from 'zod';

export class DomainError extends Errors('domain', {
  AlreadyPublished: { message: 'Post is already published' },
  NotPublished: { message: 'Post is not published' },
  NotScheduled: { message: 'Post is not scheduled' },
  PublishAtInvalid: {
    message: 'publishAt must be a future UTC timestamp',
    data: z.object({ publishAt: z.string() }),
  },
  PostNotFound: {
    message: 'Post was not found',
    data: z.object({ id: z.string() }),
  },
  InternalCallerRequired: {
    message: 'This use case only runs from inside the application',
  },
  ChannelsRequired: { message: 'Choose email, sms, or both' },
  ChannelsInvalid: { message: 'channels must be email, sms, or both' },
  SmsRequiresPhone: { message: 'SMS requires a phone' },
}) {}
