import { EventHandler } from 'hexok';
import { PostPublishedEvent } from '../../../../domain/events/post-published.js';
import {
  BLOG_ORGANIZATION,
  PostPublishedWebhook,
} from '../../../../domain/events/webhook-events.js';
import type { WebhookPublisher } from '../../../ports/events/webhook-publisher.js';

export class PostPublishedWebhookHandler extends EventHandler(
  'webhooks.post-published',
  PostPublishedEvent,
) {
  constructor(private readonly deps: { webhooks: WebhookPublisher }) {
    super();
  }

  /**
   * A retried handler publishes again with the same `eventId`, so receivers see the same `webhook-id` and dedupe it.
   * The id follows the email idempotency keys, so a post published a second time also keeps its id.
   */
  async handle(event: PostPublishedEvent): Promise<void> {
    await this.deps.webhooks.publish({
      organizationId: BLOG_ORGANIZATION,
      eventId: `${PostPublishedWebhook.token}:${event.payload.postId}`,
      event: new PostPublishedWebhook({
        postId: event.payload.postId,
        title: event.payload.title,
      }),
    });
  }
}
