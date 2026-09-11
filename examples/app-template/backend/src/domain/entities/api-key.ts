import type { Infer } from 'kerf/core';
import { Entity } from 'kerf/domain';
import { z } from 'zod';

export const apiKeySchema = z.object({
  id: z.string(),
  userId: z.string(),
  key: z.string(),
  organizationIds: z.array(z.string()).min(1),
});

export type ApiKeyProps = Infer<typeof apiKeySchema>;

export class ApiKey extends Entity<ApiKeyProps> {
  static readonly key = 'ApiKey';
  static readonly schema = apiKeySchema;
  static readonly errors = {} as const;
}
