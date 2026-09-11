import type { Infer } from 'plinth/core';
import { Entity } from 'plinth/domain';
import { z } from 'zod';

export const userSchema = z.object({
  id: z.string(),
  organizationIds: z.array(z.string()).min(1),
  name: z.string(),
  email: z.string(),
});

export type UserProps = Infer<typeof userSchema>;

export class User extends Entity<UserProps> {
  static readonly key = 'User';
  static readonly schema = userSchema;
  static readonly errors = {} as const;
}
