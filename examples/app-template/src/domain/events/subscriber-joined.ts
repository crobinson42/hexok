import { Event } from 'hexok';
import { z } from 'zod';
import { notificationChannelSchema } from '../schemas/subscriber.js';

export const subscriberJoinedSchema = z.object({
  subscriberId: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(1).optional(),
  channels: z.array(notificationChannelSchema).min(1).default(['email']),
});

export class SubscriberJoinedEvent extends Event(
  'subscriber.joined',
  subscriberJoinedSchema,
) {}
