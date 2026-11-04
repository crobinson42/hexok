import { Schema } from 'hexok';
import { z } from 'zod';

export const notificationChannels = ['email', 'sms'] as const;

export const notificationChannelSchema = z.enum(notificationChannels);

export type NotificationChannel = z.infer<typeof notificationChannelSchema>;

export const subscriberSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(1).optional(),
  channels: z.array(notificationChannelSchema).min(1).readonly(),
});

export class SubscriberSchema extends Schema('Subscriber', subscriberSchema) {}
