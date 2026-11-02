import { Schema } from 'hexok';
import { z } from 'zod';
import { idSchema, textSchema } from './id.js';

export const regionSchema = z.object({
  id: idSchema,
  name: textSchema,
  orgId: idSchema,
});

export class RegionSchema extends Schema('Region', regionSchema) {}
