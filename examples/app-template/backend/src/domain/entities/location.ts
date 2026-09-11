import type { Infer } from 'kerf/core';
import { Entity } from 'kerf/domain';
import { z } from 'zod';

export const locationSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
});

export type LocationProps = Infer<typeof locationSchema>;

export class Location extends Entity<LocationProps> {
  static readonly key = 'Location';
  static readonly schema = locationSchema;
  static readonly errors = {} as const;
}
