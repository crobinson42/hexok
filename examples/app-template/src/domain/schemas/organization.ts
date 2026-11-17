import { Schema } from 'hexok';
import { z } from 'zod';

export const organizationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});

export class OrganizationSchema extends Schema(
  'Organization',
  organizationSchema,
) {}
