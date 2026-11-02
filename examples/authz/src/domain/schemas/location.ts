import { Schema } from 'hexok';
import { z } from 'zod';
import { idSchema, textSchema } from './id.js';

export const locationParentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('region'), id: idSchema }),
  z.object({ type: z.literal('org'), id: idSchema }),
]);

export const locationSchema = z.object({
  id: idSchema,
  name: textSchema,
  parent: locationParentSchema,
});

export class LocationSchema extends Schema('Location', locationSchema) {}
