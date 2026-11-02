import { Schema } from 'hexok';
import { z } from 'zod';
import { idSchema, textSchema } from './id.js';

export const noteParentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('scan'), id: idSchema }),
  z.object({ type: z.literal('location'), id: idSchema }),
]);

export const noteSchema = z.object({
  id: idSchema,
  body: textSchema,
  parent: noteParentSchema,
});

export class NoteSchema extends Schema('Note', noteSchema) {}
