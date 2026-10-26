import { Schema } from 'hexok';
import { z } from 'zod';

export const notificationChannels = ['email', 'sms'] as const;

export const notificationChannelSchema = z.enum(notificationChannels);

export type NotificationChannel = z.infer<typeof notificationChannelSchema>;

export const subscriberSchema = z
  .object({
    id: z.string().min(1),
    email: z.string().email(),
    phone: z.string().min(1).optional(),
    channels: z.array(notificationChannelSchema).min(1),
  })
  .superRefine((value, ctx) => {
    if (new Set(value.channels).size !== value.channels.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'channels must be unique',
        path: ['channels'],
      });
    }
    if (
      value.channels.includes('sms') &&
      (value.phone === undefined || value.phone.trim() === '')
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'SMS requires a phone',
        path: ['phone'],
      });
    }
  });

export class SubscriberSchema extends Schema('Subscriber', subscriberSchema) {}
