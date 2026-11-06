import { type ErrorMap, Errors } from 'hexok';
import { z } from 'zod';

/** The definitions. The RPC layer maps each code to a status. */
export const domainErrorDefs = {
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
  ChannelsRequired: {
    message: 'Choose email, sms, webhook, or a combination',
  },
  ChannelsInvalid: {
    message: 'channels must be email, sms, webhook, or a combination',
  },
  SmsRequiresPhone: { message: 'SMS requires a phone' },
  WebhookRequiresUrl: { message: 'A webhook requires a url' },
  WebhookUrlRejected: {
    message: 'Webhook URL is not allowed',
    data: z.object({
      reason: z.enum(['invalid', 'scheme', 'blocked', 'unresolved']),
    }),
  },
  Unauthenticated: { message: 'The token is not valid' },
  SignInRequired: { message: 'This call needs a signed-in caller' },
} satisfies ErrorMap;

export class DomainError extends Errors('domain', domainErrorDefs) {}
