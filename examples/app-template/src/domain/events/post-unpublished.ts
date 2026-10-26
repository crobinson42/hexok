import { Event } from 'hexok';
import { z } from 'zod';

export const postUnpublishedSchema = z.object({
  postId: z.string().min(1),
  title: z.string().min(1),
});

export class PostUnpublishedEvent extends Event(
  'post.unpublished',
  postUnpublishedSchema,
) {}
