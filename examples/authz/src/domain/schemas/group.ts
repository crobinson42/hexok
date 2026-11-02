import { Schema } from 'hexok';
import { z } from 'zod';
import { idSchema, textSchema } from './id.js';

export const groupSchema = z.object({
  id: idSchema,
  name: textSchema,
});

export class GroupSchema extends Schema('Group', groupSchema) {}
