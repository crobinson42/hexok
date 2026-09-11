import type { Infer } from 'hexok/core';
import { Entity } from 'hexok/domain';
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
