import { Event } from 'hexok';
import { z } from 'zod';

export const postPublishedClientSchema = z.object({
  postId: z.string().min(1),
  title: z.string().min(1),
});

export class PostPublishedClientEvent extends Event(
  'post.published',
  postPublishedClientSchema,
) {}
