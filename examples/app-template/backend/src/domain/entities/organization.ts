import type { Infer } from 'hexok/core';
import { Entity } from 'hexok/domain';
import { z } from 'zod';

export const organizationSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export type OrganizationProps = Infer<typeof organizationSchema>;

export class Organization extends Entity<OrganizationProps> {
  static readonly key = 'Organization';
  static readonly schema = organizationSchema;
  static readonly errors = {} as const;
}
