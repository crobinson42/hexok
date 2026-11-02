import { Schema } from 'hexok';
import { z } from 'zod';
import { idSchema, textSchema } from './id.js';

export const orgSchema = z.object({
  id: idSchema,
  name: textSchema,
});

export class OrgSchema extends Schema('Org', orgSchema) {}
