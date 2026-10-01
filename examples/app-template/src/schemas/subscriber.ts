import { Schema } from 'hexok';
import { z } from 'zod';

export const subscriberSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
});

export class SubscriberSchema extends Schema('Subscriber', subscriberSchema) {}
