import { Event, EventCatalog } from 'hexok';
import { z } from 'zod';

/** What a customer's endpoint receives when a post goes live. */
export class PostPublishedWebhook extends Event(
  'post.published',
  z.object({ postId: z.string().min(1), title: z.string().min(1) }),
) {}

/** Events the blog offers to customer endpoints. Kept apart from `DomainEvents`, so internal fields such as `emailSubscribers` never leave. */
export class WebhookEvents extends EventCatalog('webhooks', {
  postPublished: PostPublishedWebhook,
}) {}
