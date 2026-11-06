import { Schema } from 'hexok';
import { z } from 'zod';

export const notificationChannels = ['email', 'sms', 'webhook'] as const;

export const notificationChannelSchema = z.enum(notificationChannels);

export type NotificationChannel = z.infer<typeof notificationChannelSchema>;

export const subscriberSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(1).optional(),
  channels: z.array(notificationChannelSchema).min(1).readonly(),
  /** Set when `channels` includes `webhook`. A product encrypts this at rest. The queue never carries it. */
  webhookUrl: z.string().min(1).optional(),
  /** `whsec_` secret. Returned on subscribe. A product shows it once. */
  webhookSecret: z.string().min(1).optional(),
  /** Set when the endpoint answers 410. Delivery stops. */
  webhookDisabled: z.boolean().optional(),
});

export class SubscriberSchema extends Schema('Subscriber', subscriberSchema) {}
