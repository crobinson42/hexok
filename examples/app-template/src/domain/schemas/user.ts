import { Schema } from 'hexok';
import { z } from 'zod';

export const userSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  organizationIds: z.array(z.string().min(1)).readonly(),
});

export class UserSchema extends Schema('User', userSchema) {}
