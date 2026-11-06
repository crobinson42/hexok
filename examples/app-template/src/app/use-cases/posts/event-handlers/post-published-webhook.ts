import type { Webhooks } from '@hexok/webhooks';
import { EventHandler } from 'hexok';
import { PostPublishedEvent } from '../../../../domain/events/post-published.js';
import { PostPublishedWebhook } from '../../../../domain/events/webhook-events.js';

/** The blog has one organization. A multi-tenant product passes the tenant that owns the post. */
export const BLOG_ORGANIZATION = 'blog';

export class PostPublishedWebhookHandler extends EventHandler(
  'webhooks.post-published',
  PostPublishedEvent,
) {
  constructor(
    private readonly deps: {
      webhooks: Pick<Webhooks<PostPublishedWebhook>, 'publish'>;
    },
  ) {
    super();
  }

  /**
   * A retried handler publishes again with the same `eventId`, so receivers see the same `webhook-id` and dedupe it.
   * The id follows the email idempotency keys, so a post published a second time also keeps its id.
   */
  async handle(event: PostPublishedEvent): Promise<void> {
    await this.deps.webhooks.publish({
      organizationId: BLOG_ORGANIZATION,
      eventId: `post.published:${event.payload.postId}`,
      event: new PostPublishedWebhook({
        postId: event.payload.postId,
        title: event.payload.title,
      }),
    });
  }
}
