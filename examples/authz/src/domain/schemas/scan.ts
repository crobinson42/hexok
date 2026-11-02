import { Schema } from 'hexok';
import { z } from 'zod';
import { idSchema, textSchema } from './id.js';

export const scanSchema = z.object({
  id: idSchema,
  title: textSchema,
  locationId: idSchema,
});

export class ScanSchema extends Schema('Scan', scanSchema) {}
