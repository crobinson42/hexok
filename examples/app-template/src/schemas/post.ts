import { Schema } from 'hexok';
import { z } from 'zod';

export const postSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  body: z.string(),
  status: z.enum(['draft', 'published']),
});

export class PostSchema extends Schema('Post', postSchema) {}
