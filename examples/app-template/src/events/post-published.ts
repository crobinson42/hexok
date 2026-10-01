import { Event } from 'hexok';
import { z } from 'zod';

export const postPublishedSchema = z.object({
  postId: z.string().min(1),
  title: z.string().min(1),
  emailSubscribers: z.boolean(),
});

export class PostPublishedEvent extends Event(
  'post.published',
  postPublishedSchema,
) {}
