import type { Infer } from 'kerf/core';
import { Entity } from 'kerf/domain';
import { z } from 'zod';

export const userCredentialsSchema = z.object({
  id: z.string(),
  userId: z.string(),
  passwordHash: z.string(),
});

export type UserCredentialsProps = Infer<typeof userCredentialsSchema>;

export class UserCredentials extends Entity<UserCredentialsProps> {
  static readonly key = 'UserCredentials';
  static readonly schema = userCredentialsSchema;
  static readonly errors = {} as const;

  updatePasswordHash(passwordHash: string): this {
    return this.set((draft) => {
      draft.passwordHash = passwordHash;
    });
  }
}
