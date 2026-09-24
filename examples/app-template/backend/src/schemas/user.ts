import { Schema } from 'hexok';
import { z } from 'zod';

export const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
});

export class UserSchema extends Schema('User', userSchema) {}
