import { z } from 'zod';
import { idSchema, textSchema } from '../../../domain/schemas/id.js';

export const resourceTypes = [
  'org',
  'region',
  'location',
  'scan',
  'note',
  'group',
] as const;

export const shareInput = z.object({
  type: z.enum(resourceTypes),
  id: idSchema,
  relation: textSchema,
  subject: textSchema,
});

export type ShareInput = z.infer<typeof shareInput>;
