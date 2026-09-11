import type { Infer } from 'plinth/core';
import { z } from 'zod';

export const actorSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('user'),
    userId: z.string(),
    organizationIds: z.array(z.string()).min(1),
  }),
  z.object({
    type: z.literal('apiKey'),
    apiKeyId: z.string(),
    userId: z.string(),
    organizationIds: z.array(z.string()).min(1),
  }),
]);

export type Actor = Infer<typeof actorSchema>;
